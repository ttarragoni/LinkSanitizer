/**
 * LinkSanitizer — content script (v2.1)
 *
 * FIX v2.1: reads state directly from chrome.storage.local instead of asking
 * the background via sendMessage. This means the allowlist check always uses
 * the authoritative persisted value — no stale in-memory copy can interfere.
 *
 * Hard-blocked keywords: paypal, stripe, checkout — exits immediately.
 */

(function () {
  "use strict";

  /* ── Hard-block check (synchronous, no storage needed) ───────────────── */
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

  /* ── Main: read state directly from storage (always fresh) ───────────── */
  chrome.storage.local.get({ enabled: true, allowlist: [] }, (state) => {
    if (chrome.runtime.lastError) return;
    if (!state.enabled) return;

    // Allowlist check against the live persisted value
    const hostname = window.location.hostname;
    if ((state.allowlist ?? []).some((entry) => hostMatches(hostname, entry))) return;

    // Strip params
    const { cleanUrl, removed } = stripParams(window.location.href);
    if (removed.length === 0) return;

    // Rewrite URL without reloading
    try {
      history.replaceState(history.state, "", cleanUrl);
    } catch {
      return; // sandboxed page
    }

    // Tell background to increment counter and update badge
    chrome.runtime.sendMessage({ type: "PARAMS_CLEANED", count: removed.length });
  });
})();