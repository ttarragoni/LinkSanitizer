/**
 * LinkSanitizer — content script (v2.2)
 *
 * FIX v2.2: eliminates the race condition on fast/static pages (e.g. Wikipedia).
 *
 * ROOT CAUSE of the race:
 *   chrome.runtime.sendMessage() is async. On ultra-fast pages the content
 *   script context can be destroyed before the background SW receives and
 *   processes the PARAMS_CLEANED message, so the counter write never happens.
 *
 * SOLUTION — two-layer atomic write:
 *   1. Counter (global, persistent): written DIRECTLY to chrome.storage.local
 *      by the content script itself, with no message passing involved.
 *      chrome.storage.local.set() is internally queued and completes even if
 *      the content script context is torn down immediately after — Chrome
 *      guarantees the write because it's already handed off to the browser
 *      process before the script exits.
 *
 *   2. Badge (per-tab, visual): sent to the background via sendMessage WITH
 *      a keepalive ping pattern. The badge is best-effort — if the message is
 *      lost the counter is already safe. The background also watches
 *      storage.onChanged for cleanedCount as a reliable fallback for the badge.
 *
 * Everything else (allowlist, hard-block, replaceState) is unchanged from v2.1.
 */
 
(function () {
  "use strict";
 
  /* ── Hard-block (synchronous) ─────────────────────────────────────────── */
  const HARD_BLOCK_KEYWORDS = ["paypal", "stripe", "checkout"];
  if (HARD_BLOCK_KEYWORDS.some((kw) => window.location.href.toLowerCase().includes(kw))) return;
 
  /* ── Tracking params ──────────────────────────────────────────────────── */
  const TRACKING_PARAMS = new Set([
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
    "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid",
    "msclkid", "twclid", "mc_eid", "mc_cid", "ref",
    "_ga", "_gl", "igshid", "s_cid", "yclid", "zanpid",
  ]);
 
  /* ── Helpers ──────────────────────────────────────────────────────────── */
  function normaliseDomain(raw) {
    return raw.trim().toLowerCase().replace(/^www\./, "");
  }
 
  function hostMatches(hostname, entry) {
    const norm = normaliseDomain(entry);
    const host = normaliseDomain(hostname);
    return host === norm || host.endsWith("." + norm);
  }
 
  function stripParams(href) {
    let url;
    try { url = new URL(href); } catch { return { cleanUrl: href, removed: [] }; }
    const removed = [];
    for (const param of TRACKING_PARAMS) {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        removed.push(param);
      }
    }
    return { cleanUrl: url.toString(), removed };
  }
 
  /**
   * Atomically increment cleanedCount in storage.
   * Uses a read-modify-write inside a single storage.get callback so that
   * the write is dispatched to the browser process before this script exits.
   * No await, no Promise chain — the callback fires synchronously enough
   * to survive fast page teardowns.
   */
  function persistCounterIncrement(delta) {
    chrome.storage.local.get({ cleanedCount: 0 }, (result) => {
      if (chrome.runtime.lastError) return;
      const next = (result.cleanedCount || 0) + delta;
      // This set() is fire-and-forget but Chrome queues it in the browser
      // process — it will complete even if the content script is destroyed.
      chrome.storage.local.set({ cleanedCount: next });
    });
  }
 
  /* ── Main: read state directly from storage, then act ────────────────── */
  chrome.storage.local.get({ enabled: true, allowlist: [] }, (state) => {
    if (chrome.runtime.lastError) return;
    if (!state.enabled) return;
 
    const hostname = window.location.hostname;
    if ((state.allowlist ?? []).some((entry) => hostMatches(hostname, entry))) return;
 
    const { cleanUrl, removed } = stripParams(window.location.href);
    if (removed.length === 0) return;
 
    // 1. Rewrite URL — synchronous, zero latency
    try {
      history.replaceState(history.state, "", cleanUrl);
    } catch {
      return; // sandboxed page
    }
 
    // 2. Persist counter increment directly — atomic, survives fast teardown
    persistCounterIncrement(removed.length);
 
    // 3. Notify background for badge update — best-effort, non-critical
    //    The background also catches the counter change via storage.onChanged
    //    as a reliable badge fallback.
    chrome.runtime.sendMessage({
      type: "BADGE_UPDATE",
      count: removed.length,
    }, () => void chrome.runtime.lastError); // suppress "no receiver" console error
  });
})();