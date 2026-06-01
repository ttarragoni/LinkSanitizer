/**
 * LinkSanitizer — popup.js (v2 with i18n)
 */

/* ── i18n helper ─────────────────────────────────────────────────────────── */
const i18n = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

function applyI18n() {
  document.getElementById("toggleStatus").textContent    = i18n("statusActive");
  document.getElementById("counterLabel").textContent    = i18n("counterLabel");
  document.getElementById("counterUnit").textContent     = i18n("counterUnit");
  document.getElementById("paramsTitle").textContent     = i18n("paramsBeingStripped");
  document.getElementById("cleanTabBtn").textContent     = i18n("cleanCurrentTab");
  document.getElementById("resetBtn").textContent        = i18n("resetCounter");
  document.getElementById("allowlistTitle").textContent  = i18n("allowlistTitle");
  document.getElementById("allowlistHint").textContent   = i18n("allowlistHint");
  document.getElementById("allowlistInput").placeholder  = i18n("allowlistPlaceholder");
  document.getElementById("allowlistAddBtn").textContent = i18n("allowlistAdd");
}

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const counterEl       = document.getElementById("counterValue");
const toggleInput     = document.getElementById("enabledToggle");
const toggleStatus    = document.getElementById("toggleStatus");
const container       = document.getElementById("container");
const cleanTabBtn     = document.getElementById("cleanTabBtn");
const resetBtn        = document.getElementById("resetBtn");
const cleanFeedback   = document.getElementById("cleanFeedback");
const allowlistInput  = document.getElementById("allowlistInput");
const allowlistAddBtn = document.getElementById("allowlistAddBtn");
const allowlistItems  = document.getElementById("allowlistItems");

/* ── Counter ─────────────────────────────────────────────────────────────── */
function animateCounter(target) {
  const raw   = counterEl.textContent.replace(/[^0-9]/g, "");
  const start = parseInt(raw, 10) || 0;
  if (start === target) return;

  const duration = Math.min(900, Math.max(200, Math.abs(target - start) * 5));
  const startTs  = performance.now();

  function step(ts) {
    const elapsed  = ts - startTs;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3);
    counterEl.textContent = Math.round(start + (target - start) * eased).toLocaleString();
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      counterEl.textContent = target.toLocaleString();
      bump();
    }
  }
  requestAnimationFrame(step);
}

function bump() {
  counterEl.classList.add("bump");
  setTimeout(() => counterEl.classList.remove("bump"), 320);
}

function setLoading(on) {
  if (on) { counterEl.classList.add("loading"); counterEl.textContent = "—"; }
  else      counterEl.classList.remove("loading");
}

/* ── Toggle ──────────────────────────────────────────────────────────────── */
function applyEnabledState(enabled) {
  toggleInput.checked = enabled;
  if (enabled) {
    container.classList.remove("is-disabled");
    toggleStatus.textContent = i18n("statusActive");
    toggleStatus.className   = "active";
  } else {
    container.classList.add("is-disabled");
    toggleStatus.textContent = i18n("statusPaused");
    toggleStatus.className   = "paused";
  }
}

/* ── Feedback ────────────────────────────────────────────────────────────── */
let feedbackTimer = null;

function showFeedback(text, type = "success") {
  clearTimeout(feedbackTimer);
  cleanFeedback.textContent = text;
  cleanFeedback.className   = `clean-feedback visible ${type}`;
  feedbackTimer = setTimeout(() => cleanFeedback.classList.remove("visible"), 2800);
}

/* ── Allowlist ───────────────────────────────────────────────────────────── */
function normaliseDomain(raw) {
  return raw.trim().toLowerCase().replace(/^www\./, "");
}

function isValidDomain(raw) {
  const d = normaliseDomain(raw);
  if (!d) return false;
  return /^[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?$/.test(d) && d.includes(".");
}

function renderAllowlist(domains) {
  allowlistItems.innerHTML = "";

  if (!domains || domains.length === 0) {
    const li = document.createElement("li");
    li.className   = "allowlist-empty";
    li.textContent = i18n("allowlistEmpty");
    allowlistItems.appendChild(li);
    return;
  }

  domains.forEach((domain) => {
    const li = document.createElement("li");
    li.className      = "allowlist-item";
    li.dataset.domain = domain;

    const span = document.createElement("span");
    span.className   = "allowlist-domain";
    span.textContent = domain;

    const rmBtn = document.createElement("button");
    rmBtn.className   = "allowlist-remove";
    rmBtn.title       = i18n("allowlistRemoveLabel");
    rmBtn.textContent = "×";
    rmBtn.addEventListener("click", () => removeDomain(domain, li));

    li.appendChild(span);
    li.appendChild(rmBtn);
    allowlistItems.appendChild(li);
  });
}

async function addDomain() {
  const raw = allowlistInput.value.trim();
  if (!isValidDomain(raw)) {
    allowlistInput.classList.add("shake");
    setTimeout(() => allowlistInput.classList.remove("shake"), 350);
    allowlistInput.focus();
    return;
  }

  // Always write to storage first — this is the authoritative source.
  const stored  = await chrome.storage.local.get({ allowlist: [] });
  const domain  = normaliseDomain(raw);
  const updated = Array.from(new Set([...stored.allowlist, domain]));
  await chrome.storage.local.set({ allowlist: updated });
  allowlistInput.value = "";
  renderAllowlist(updated);

  // Also notify background to sync its in-memory copy. Fire-and-forget.
  chrome.runtime.sendMessage({ type: "ALLOWLIST_ADD", domain }).catch(() => {});
}

async function removeDomain(domain, liEl) {
  liEl.classList.add("removing");
  await new Promise((r) => setTimeout(r, 180));

  // Step 1: always write to storage directly — this is the authoritative source.
  // The content script reads storage directly (v2.1), so this alone is enough
  // to make the next page load behave correctly.
  const stored  = await chrome.storage.local.get({ allowlist: [] });
  const norm    = normaliseDomain(domain);
  const updated = stored.allowlist.filter((d) => normaliseDomain(d) !== norm);
  await chrome.storage.local.set({ allowlist: updated });

  // Step 2: also notify the background so its in-memory copy stays in sync
  // (used by CLEAN_TAB). Fire-and-forget — UI doesn't depend on the response.
  chrome.runtime.sendMessage({ type: "ALLOWLIST_REMOVE", domain }).catch(() => {});

  // Step 3: re-render the popup list from the value we just wrote
  renderAllowlist(updated);
}

/* ── Load state ──────────────────────────────────────────────────────────── */
async function loadState() {
  setLoading(true);
  try {
    const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    setLoading(false);
    applyEnabledState(state?.enabled ?? true);
    animateCounter(state?.cleanedCount ?? 0);
    renderAllowlist(state?.allowlist ?? []);
  } catch {
    setLoading(false);
    const result = await chrome.storage.local.get({ cleanedCount: 0, enabled: true, allowlist: [] });
    applyEnabledState(result.enabled);
    animateCounter(result.cleanedCount);
    renderAllowlist(result.allowlist);
  }
}

/* ── Storage live updates ────────────────────────────────────────────────── */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.cleanedCount != null) {
    const newVal  = changes.cleanedCount.newValue ?? 0;
    const current = parseInt(counterEl.textContent.replace(/[^0-9]/g, ""), 10) || 0;
    if (newVal !== current) animateCounter(newVal);
  }
  if (changes.enabled  != null) applyEnabledState(changes.enabled.newValue ?? true);
  if (changes.allowlist != null) renderAllowlist(changes.allowlist.newValue ?? []);
});

/* ── Clean current tab ───────────────────────────────────────────────────── */
async function cleanCurrentTab() {
  cleanTabBtn.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "CLEAN_TAB" });
    switch (response?.status) {
      case "cleaned":
        showFeedback(i18n("cleanTabDone", [String(response.count)]), "success");
        const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
        animateCounter(state?.cleanedCount ?? 0);
        break;
      case "already_clean":
        showFeedback(i18n("cleanTabAlreadyClean"), "neutral");
        break;
      case "allowlisted":
        showFeedback(i18n("cleanTabAllowlisted"), "warning");
        break;
      case "hard_blocked":
        showFeedback(i18n("cleanTabHardBlocked"), "warning");
        break;
      case "disabled":
        showFeedback(i18n("cleanTabDisabled"), "neutral");
        break;
      default:
        showFeedback(i18n("cleanTabAlreadyClean"), "neutral");
    }
  } catch {
    showFeedback(i18n("cleanTabAlreadyClean"), "neutral");
  } finally {
    cleanTabBtn.disabled = false;
  }
}

/* ── Reset counter ───────────────────────────────────────────────────────── */
async function resetCount() {
  resetBtn.disabled    = true;
  resetBtn.textContent = i18n("resetting");
  try {
    await chrome.runtime.sendMessage({ type: "RESET_COUNT" });
  } catch {
    await chrome.storage.local.set({ cleanedCount: 0 });
  }
  counterEl.textContent = "0";
  bump();
  setTimeout(() => {
    resetBtn.disabled    = false;
    resetBtn.textContent = i18n("resetCounter");
  }, 700);
}

/* ── Events ──────────────────────────────────────────────────────────────── */
toggleInput.addEventListener("change", async () => {
  const enabled = toggleInput.checked;
  applyEnabledState(enabled);
  try {
    await chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled });
  } catch {
    await chrome.storage.local.set({ enabled });
  }
});

cleanTabBtn.addEventListener("click", cleanCurrentTab);
resetBtn.addEventListener("click", resetCount);
allowlistAddBtn.addEventListener("click", addDomain);
allowlistInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addDomain(); });

/* ── Init ────────────────────────────────────────────────────────────────── */
applyI18n();
loadState();