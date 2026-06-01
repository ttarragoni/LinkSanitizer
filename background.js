/**
 * LinkSanitizer — background service worker (Manifest V3 v2.1)
 *
 * FIX v2.1: allowlist is always read fresh from storage before every check.
 * This eliminates "ghost" entries caused by the MV3 service worker being
 * suspended and waking up with a stale in-memory allowlist array.
 *
 * The in-memory copy is still kept for the syncState() boot path and for
 * operations that modify the list, but isAllowlisted() now reads storage
 * directly so it is always authoritative.
 */

/* ── Badge config ─────────────────────────────────────────────────────────── */
const BADGE_BG = "#00ff9d";
const BADGE_FG = "#000000";

/** Per-tab cleaned count (in-memory, resets on SW restart — intentional) */
const tabCounts = {};

function updateBadge(tabId, delta) {
  tabCounts[tabId] = (tabCounts[tabId] ?? 0) + delta;
  const count = tabCounts[tabId];
  const text  = count > 0 ? String(count) : "";
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_BG, tabId });
  chrome.action.setBadgeTextColor({ color: BADGE_FG, tabId });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    tabCounts[tabId] = 0;
    chrome.action.setBadgeText({ text: "", tabId });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabCounts[tabId];
});

/* ── In-memory state ─────────────────────────────────────────────────────── */
let sanitizerEnabled = true;
let allowlist        = [];

async function syncState() {
  const result = await chrome.storage.local.get({ enabled: true, allowlist: [] });
  sanitizerEnabled = result.enabled;
  allowlist        = result.allowlist;
}

// Keep in-memory copy in sync whenever storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled   != null) sanitizerEnabled = changes.enabled.newValue;
  if (changes.allowlist != null) allowlist         = changes.allowlist.newValue ?? [];
});

syncState();

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function normaliseDomain(raw) {
  return raw.trim().toLowerCase().replace(/^www\./, "");
}

function domainMatchesEntry(hostname, entry) {
  const norm = normaliseDomain(entry);
  const host = normaliseDomain(hostname);
  return host === norm || host.endsWith("." + norm);
}

/**
 * Always reads allowlist fresh from storage.
 * This is the key fix: the SW may wake from suspension with a stale
 * in-memory array, so we never trust it for the actual gate check.
 */
async function isAllowlistedFresh(rawUrl) {
  let hostname;
  try { hostname = new URL(rawUrl).hostname; } catch { return false; }

  const { allowlist: stored } = await chrome.storage.local.get({ allowlist: [] });
  // Also sync in-memory copy while we're here
  allowlist = stored;

  if (stored.length === 0) return false;
  return stored.some((entry) => domainMatchesEntry(hostname, entry));
}

async function incrementCounter(count) {
  if (count <= 0) return;
  const { cleanedCount = 0 } = await chrome.storage.local.get({ cleanedCount: 0 });
  await chrome.storage.local.set({ cleanedCount: cleanedCount + count });
}

/* ── Tracking params (for on-demand CLEAN_TAB only) ─────────────────────── */
const TRACKING_PARAMS = [
  "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
  "utm_id","utm_source_platform","utm_creative_format","utm_marketing_tactic",
  "fbclid","gclid","gclsrc","dclid","gbraid","wbraid",
  "msclkid","twclid","mc_eid","mc_cid","ref",
  "_ga","_gl","igshid","s_cid","yclid","zanpid",
];

const HARD_BLOCK_KEYWORDS = ["paypal", "stripe", "checkout"];

function isHardBlocked(url) {
  return HARD_BLOCK_KEYWORDS.some((kw) => url.toLowerCase().includes(kw));
}

function sanitizeUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return { cleanUrl: rawUrl, removed: [] }; }
  const removed = [];
  for (const param of TRACKING_PARAMS) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      removed.push(param);
    }
  }
  return { cleanUrl: url.toString(), removed };
}

/* ── Message handler ─────────────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  /* Content script: params were cleaned on a page */
  if (message.type === "PARAMS_CLEANED") {
    const count = message.count ?? 0;
    incrementCounter(count);
    if (sender.tab?.id) updateBadge(sender.tab.id, count);
    sendResponse({ ok: true });
    return false;
  }

  /* Popup: read full state */
  if (message.type === "GET_STATE") {
    chrome.storage.local
      .get({ cleanedCount: 0, enabled: true, allowlist: [] })
      .then((result) => {
        // Sync in-memory state while we're at it
        sanitizerEnabled = result.enabled;
        allowlist        = result.allowlist;
        sendResponse(result);
      });
    return true;
  }

  /* Popup: toggle on/off */
  if (message.type === "SET_ENABLED") {
    const newVal     = Boolean(message.enabled);
    sanitizerEnabled = newVal;
    chrome.storage.local.set({ enabled: newVal })
      .then(() => sendResponse({ success: true }));
    return true;
  }

  /* Popup: add domain */
  if (message.type === "ALLOWLIST_ADD") {
    const domain = normaliseDomain(message.domain ?? "");
    if (!domain) { sendResponse({ success: false, reason: "empty" }); return false; }

    // Always read from storage first to avoid race conditions
    chrome.storage.local.get({ allowlist: [] }).then(({ allowlist: stored }) => {
      const updated = Array.from(new Set([...stored, domain]));
      allowlist = updated; // sync in-memory
      chrome.storage.local.set({ allowlist: updated })
        .then(() => sendResponse({ success: true, allowlist: updated }));
    });
    return true;
  }

  /* Popup: remove domain — reads storage first, writes back, syncs memory */
  if (message.type === "ALLOWLIST_REMOVE") {
    const domain = normaliseDomain(message.domain ?? "");

    chrome.storage.local.get({ allowlist: [] }).then(({ allowlist: stored }) => {
      const updated = stored.filter((d) => normaliseDomain(d) !== domain);
      allowlist = updated; // sync in-memory immediately
      chrome.storage.local.set({ allowlist: updated })
        .then(() => sendResponse({ success: true, allowlist: updated }));
    });
    return true;
  }

  /* Popup: clean current tab on demand */
  if (message.type === "CLEAN_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.url)           { sendResponse({ status: "no_url" });      return; }
      if (isHardBlocked(tab.url)) { sendResponse({ status: "hard_blocked" }); return; }

      // Re-read enabled flag fresh from storage
      const { enabled } = await chrome.storage.local.get({ enabled: true });
      if (!enabled)            { sendResponse({ status: "disabled" });    return; }

      if (await isAllowlistedFresh(tab.url)) {
        sendResponse({ status: "allowlisted" });
        return;
      }

      const { cleanUrl, removed } = sanitizeUrl(tab.url);
      if (removed.length === 0) { sendResponse({ status: "already_clean" }); return; }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (url) => { history.replaceState(history.state, "", url); },
          args: [cleanUrl],
        });
        await incrementCounter(removed.length);
        updateBadge(tab.id, removed.length);
        sendResponse({ status: "cleaned", count: removed.length });
      } catch (err) {
        sendResponse({ status: "error", message: err.message });
      }
    });
    return true;
  }

  /* Popup: reset counter */
  if (message.type === "RESET_COUNT") {
    chrome.storage.local.set({ cleanedCount: 0 })
      .then(() => sendResponse({ success: true }));
    return true;
  }
});