const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "twclid",
  "mc_eid", "mc_cid", "ref", "_ga", "_gl", "igshid", "s_cid", "yclid", "zanpid"
];

const FIXED_WHITELIST = ['paypal', 'stripe', 'checkout'];
let sanitizerEnabled = true;
let allowlist = []; 

async function syncState() {
  const result = await chrome.storage.local.get({
    enabled: true,
    allowlist: [],
  });
  sanitizerEnabled = result.enabled;
  allowlist = result.allowlist;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled != null)   sanitizerEnabled = changes.enabled.newValue;
  if (changes.allowlist != null) allowlist = changes.allowlist.newValue ?? [];
});

syncState();

function normaliseDomain(raw) {
  return raw.trim().toLowerCase().replace(/^www\./, "");
}

function isAllowlisted(rawUrl) {
  let hostname;
  try {
    const url = new URL(rawUrl);
    const fullUrlString = url.href.toLowerCase();
    
    if (FIXED_WHITELIST.some(keyword => fullUrlString.includes(keyword))) return true;

    hostname = normaliseDomain(url.hostname);
  } catch {
    return false;
  }
  
  if (allowlist.length === 0) return false;
  return allowlist.some((entry) => {
    const norm = normaliseDomain(entry);
    return hostname === norm || hostname.endsWith("." + norm);
  });
}

function sanitizeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { cleanUrl: rawUrl, removed: [] };
  }

  const removed = [];
  for (const param of TRACKING_PARAMS) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      removed.push(param);
    }
  }

  return { cleanUrl: url.toString(), removed };
}

/* ── Unico Listener di Navigazione ───────────────────────────────────────── */

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Intercettiamo il cambio di URL solo se l'estensione è attiva e l'URL esiste
  if (!sanitizerEnabled || !changeInfo.url) return;
  
  // Se il sito è in whitelist, usciamo IMMEDIATAMENTE senza fare nulla
  if (isAllowlisted(changeInfo.url)) {
    // Rimuove eventuali badge rimasti da schede precedenti su questo tab
    chrome.action.setBadgeText({ text: '', tabId: tabId });
    return;
  }

  const { cleanUrl, removed } = sanitizeUrl(changeInfo.url);
  if (removed.length === 0) return;

  // Aggiorna la memoria e mostra il badge prima di aggiornare la scheda
  chrome.storage.local.get({ cleanedCount: 0 }, (result) => {
    const newTotal = result.cleanedCount + removed.length;
    chrome.storage.local.set({ cleanedCount: newTotal }, () => {
      
      // Imposta il numeretto sul quadratino verde
      chrome.action.setBadgeBackgroundColor({ color: '#00ff9d', tabId: tabId });
      chrome.action.setBadgeText({ text: removed.length.toString(), tabId: tabId });
      chrome.action.setBadgeTextColor({ color: '#000000', tabId: tabId });

      // Cambia l'URL con quello pulito
      chrome.tabs.update(tabId, { url: cleanUrl });
    });
  });
});

/* ── Message handler ─────────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_STATE") {
    chrome.storage.local.get({ cleanedCount: 0, enabled: true, allowlist: [] }).then(sendResponse);
    return true;
  }
  if (message.type === "SET_ENABLED") {
    sanitizerEnabled = Boolean(message.enabled);
    chrome.storage.local.set({ enabled: sanitizerEnabled }).then(() => sendResponse({ success: true }));
    return true;
  }
  if (message.type === "ALLOWLIST_ADD") {
    const domain = normaliseDomain(message.domain ?? "");
    if (!domain) { sendResponse({ success: false, reason: "empty" }); return; }
    const updated = Array.from(new Set([...allowlist, domain]));
    allowlist = updated;
    chrome.storage.local.set({ allowlist: updated }).then(() => sendResponse({ success: true, allowlist: updated }));
    return true;
  }
  if (message.type === "ALLOWLIST_REMOVE") {
    const domain = normaliseDomain(message.domain ?? "");
    const updated = allowlist.filter((d) => normaliseDomain(d) !== domain);
    allowlist = updated;
    chrome.storage.local.set({ allowlist: updated }).then(() => sendResponse({ success: true, allowlist: updated }));
    return true;
  }
  if (message.type === "RESET_COUNT") {
    chrome.storage.local.set({ cleanedCount: 0 }).then(() => sendResponse({ success: true }));
    return true;
  }
});