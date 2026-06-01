/**
 * LinkSanitizer — background service worker (Manifest V3 v2.2)
 *
 * FIX v2.2: resolves the race condition on ultra-fast pages (Wikipedia etc.).
 *
 * ROOT CAUSE:
 *   On fast pages the content script context is destroyed before
 *   chrome.runtime.sendMessage() can be fully processed by the SW.
 *   The counter write was lost in transit.
 *
 * SOLUTION — dual-path badge update:
 *   • Counter: now written atomically by content.js directly to storage.
 *     No message passing needed for the critical persist operation.
 *   • Badge:   PRIMARY path → BADGE_UPDATE message (arrives on normal pages).
 *              FALLBACK path → storage.onChanged fires on cleanedCount change,
 *              which is reliable even when the message never arrives.
 *              The fallback uses a per-tab "pending" registry to know which
 *              tab to badge, populated by tabs.onUpdated("loading").
 *
 * All allowlist, hard-block, and CLEAN_TAB logic unchanged from v2.1.
 */

/* ── Badge config ─────────────────────────────────────────────────────────── */
const BADGE_BG = "#00ff9d";
const BADGE_FG = "#000000";

/** Per-tab accumulated badge count (in-memory, resets on SW restart) */
const tabCounts = {};

/**
 * Registry of tabs that started loading but haven't yet received a BADGE_UPDATE.
 * Key: tabId. Value: { windowId, badgedViaMessage: bool }
 * Used by the storage.onChanged fallback to find the right tab.
 */
const pendingBadge = {}; // tabId → { badgedViaMessage: boolean }

function updateBadge(tabId, delta) {
  tabCounts[tabId] = (tabCounts[tabId] ?? 0) + delta;
  const count = tabCounts[tabId];
  const text  = count > 0 ? String(count) : "";
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_BG, tabId });
  chrome.action.setBadgeTextColor({ color: BADGE_FG, tabId });
}

// When a tab starts loading a new URL: reset its badge and register it
// as "pending" so the storage.onChanged fallback can find it.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    tabCounts[tabId] = 0;
    chrome.action.setBadgeText({ text: "", tabId });
    // Register as pending — will be resolved via BADGE_UPDATE or storage fallback
    pendingBadge[tabId] = { badgedViaMessage: false };
  }
  // Once the page is fully loaded, clean up the pending entry after a short
  // grace period (badge may still arrive slightly after "complete")
  if (changeInfo.status === "complete") {
    setTimeout(() => { delete pendingBadge[tabId]; }, 3000);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabCounts[tabId];
  delete pendingBadge[tabId];
});

/* ── In-memory state ─────────────────────────────────────────────────────── */
let sanitizerEnabled = true;
let allowlist        = [];

async function syncState() {
  const result = await chrome.storage.local.get({ enabled: true, allowlist: [] });
  sanitizerEnabled = result.enabled;
  allowlist        = result.allowlist;
}

/**
 * storage.onChanged listener — two jobs:
 *  1. Keep in-memory enabled/allowlist in sync.
 *  2. BADGE FALLBACK: when cleanedCount rises, badge the most recently
 *     loaded tab that hasn't already been badged via a direct message.
 *     This fires reliably even when the BADGE_UPDATE message was lost.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.enabled   != null) sanitizerEnabled = changes.enabled.newValue;
  if (changes.allowlist != null) allowlist         = changes.allowlist.newValue ?? [];

  if (changes.cleanedCount != null) {
    const prev  = changes.cleanedCount.oldValue ?? 0;
    const next  = changes.cleanedCount.newValue ?? 0;
    const delta = next - prev;
    if (delta <= 0) return;

    // Find pending tabs that haven't been badged via the direct message yet
    const waiting = Object.entries(pendingBadge)
      .filter(([, v]) => !v.badgedViaMessage);

    if (waiting.length > 0) {
      // Badge the last one registered (most recently navigated tab)
      const tabId = Number(waiting[waiting.length - 1][0]);
      updateBadge(tabId, delta);
      pendingBadge[tabId].badgedViaMessage = true; // mark as resolved
    }
  }
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

async function isAllowlistedFresh(rawUrl) {
  let hostname;
  try { hostname = new URL(rawUrl).hostname; } catch { return false; }
  const { allowlist: stored } = await chrome.storage.local.get({ allowlist: [] });
  allowlist = stored;
  if (stored.length === 0) return false;
  return stored.some((entry) => domainMatchesEntry(hostname, entry));
}

async function incrementCounter(count) {
  if (count <= 0) return;
  const { cleanedCount = 0 } = await chrome.storage.local.get({ cleanedCount: 0 });
  await chrome.storage.local.set({ cleanedCount: cleanedCount + count });
}

/* ── Tracking params (CLEAN_TAB only) ───────────────────────────────────── */
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

  /**
   * BADGE_UPDATE — sent by content script after a successful clean.
   * Counter is already written to storage by content.js directly.
   * This message only drives the badge (best-effort, fast path).
   */
  if (message.type === "BADGE_UPDATE") {
    const tabId = sender.tab?.id;
    const count = message.count ?? 0;
    if (tabId && count > 0) {
      updateBadge(tabId, count);
      // Mark as resolved so storage.onChanged fallback doesn't double-badge
      if (pendingBadge[tabId]) {
        pendingBadge[tabId].badgedViaMessage = true;
      }
    }
    sendResponse({ ok: true });
    return false;
  }

  /* Popup: read full state */
  if (message.type === "GET_STATE") {
    chrome.storage.local
      .get({ cleanedCount: 0, enabled: true, allowlist: [] })
      .then((result) => {
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
    chrome.storage.local.get({ allowlist: [] }).then(({ allowlist: stored }) => {
      const updated = Array.from(new Set([...stored, domain]));
      allowlist = updated;
      chrome.storage.local.set({ allowlist: updated })
        .then(() => sendResponse({ success: true, allowlist: updated }));
    });
    return true;
  }

  /* Popup: remove domain */
  if (message.type === "ALLOWLIST_REMOVE") {
    const domain = normaliseDomain(message.domain ?? "");
    chrome.storage.local.get({ allowlist: [] }).then(({ allowlist: stored }) => {
      const updated = stored.filter((d) => normaliseDomain(d) !== domain);
      allowlist = updated;
      chrome.storage.local.set({ allowlist: updated })
        .then(() => sendResponse({ success: true, allowlist: updated }));
    });
    return true;
  }

  /* Popup: clean current tab on demand */
  if (message.type === "CLEAN_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.url)              { sendResponse({ status: "no_url" });      return; }
      if (isHardBlocked(tab.url)) { sendResponse({ status: "hard_blocked" }); return; }

      const { enabled } = await chrome.storage.local.get({ enabled: true });
      if (!enabled)               { sendResponse({ status: "disabled" });    return; }
      if (await isAllowlistedFresh(tab.url)) {
        sendResponse({ status: "allowlisted" }); return;
      }

      const { cleanUrl, removed } = sanitizeUrl(tab.url);
      if (removed.length === 0)   { sendResponse({ status: "already_clean" }); return; }

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