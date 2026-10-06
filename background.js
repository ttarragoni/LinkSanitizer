/**
 * LinkSanitizer — background service worker (Manifest V3 v2.2)
 */

/* ── Badge config ─────────────────────────────────────────────────────────── */
const BADGE_BG = "#00ff9d";
const BADGE_FG = "#000000";

const tabCounts = {};
const pendingBadge = {};

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
    pendingBadge[tabId] = { badgedViaMessage: false };
  }
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.enabled   != null) sanitizerEnabled = changes.enabled.newValue;
  if (changes.allowlist != null) allowlist         = changes.allowlist.newValue ?? [];

  if (changes.cleanedCount != null) {
    const prev  = changes.cleanedCount.oldValue ?? 0;
    const next  = changes.cleanedCount.newValue ?? 0;
    const delta = next - prev;
    if (delta <= 0) return;

    const waiting = Object.entries(pendingBadge)
      .filter(([, v]) => !v.badgedViaMessage);

    if (waiting.length > 0) {
      const tabId = Number(waiting[waiting.length - 1][0]);
      updateBadge(tabId, delta);
      pendingBadge[tabId].badgedViaMessage = true;
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

/* ── Tracking params (Allineati con content.js) ───────────────────────────── */
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid",
  "msclkid", "twclid", "mc_eid", "mc_cid", "ref",
  "_ga", "_gl", "igshid", "s_cid", "yclid", "zanpid",
  "si", "igsh", "ttclid", "li_fat_id", "rdt_cid", "_hsenc"
]);

const HARD_BLOCK_KEYWORDS = ["paypal", "stripe", "checkout"];

function isHardBlocked(url) {
  return HARD_BLOCK_KEYWORDS.some((kw) => url.toLowerCase().includes(kw));
}

function isTrackingKey(key) {
  const lower = key.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

function sanitizeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { cleanUrl: rawUrl, removed: [] };
  }

  const removed = [];
  const keys = Array.from(url.searchParams.keys());

  for (const key of keys) {
    if (isTrackingKey(key)) {
      url.searchParams.delete(key);
      removed.push(key);
    }
  }

  let cleanUrl = url.toString();
  if (cleanUrl.endsWith("?")) {
    cleanUrl = cleanUrl.slice(0, -1);
  }

  return { cleanUrl, removed };
}

/* ── Message handler ─────────────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "BADGE_UPDATE") {
    const tabId = sender.tab?.id;
    const count = message.count ?? 0;
    if (tabId && count > 0) {
      updateBadge(tabId, count);
      if (pendingBadge[tabId]) {
        pendingBadge[tabId].badgedViaMessage = true;
      }
    }
    sendResponse({ ok: true });
    return false;
  }

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

  if (message.type === "SET_ENABLED") {
    const newVal     = Boolean(message.enabled);
    sanitizerEnabled = newVal;
    chrome.storage.local.set({ enabled: newVal })
      .then(() => sendResponse({ success: true }));
    return true;
  }

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

  if (message.type === "CLEAN_CLIPBOARD_TEXT") {
    const rawText = message.text || "";
    let urlObj;
    try {
      urlObj = new URL(rawText.trim());
      if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
        sendResponse({ status: "invalid_url" });
        return;
      }
    } catch {
      sendResponse({ status: "invalid_url" });
      return;
    }

    const { cleanUrl, removed } = sanitizeUrl(urlObj.toString());
    if (removed.length > 0) {
      incrementCounter(removed.length).then(() => {
        sendResponse({ status: "cleaned", cleanUrl, count: removed.length });
      });
    } else {
      sendResponse({ status: "already_clean", cleanUrl });
    }
    return true;
  }

  if (message.type === "RESET_COUNT") {
    chrome.storage.local.set({ cleanedCount: 0 })
      .then(() => sendResponse({ success: true }));
    return true;
  }
});