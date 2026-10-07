/** Shared display, comparison, and status-message helpers. */

const EMPTY_DISPLAY = "–";
const EN_DASH = "–";
const ELLIPSIS = "…";
const BLANK_FILTER_LABEL = "(Blank)";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isEmptyValue(v) {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  if (s === "") return true;
  return /^[—–−-]+$/.test(s);
}

// ── Sorting ──────────────────────────────────────────────────────────────────

/** Blanks always sort last, regardless of direction. */
function compareTextFieldValues(aVal, bVal) {
  const a = String(aVal ?? "").trim();
  const b = String(bVal ?? "").trim();
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Compare by a fixed option order (e.g. Monthly < Bi-Monthly < Semi-Weekly)
 * rather than alphabetically, so schedule columns sort by cadence.
 */
function compareByOptionOrder(aVal, bVal, options) {
  const a = String(aVal ?? "").trim();
  const b = String(bVal ?? "").trim();
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const ai = options.indexOf(a);
  const bi = options.indexOf(b);
  if (ai === -1 && bi === -1) return compareTextFieldValues(a, b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

// ── Search highlighting ──────────────────────────────────────────────────────

let activeSearchQuery = "";

function setActiveSearchQuery(q) {
  activeSearchQuery = String(q ?? "").trim();
}

function getActiveSearchQuery() {
  return activeSearchQuery;
}

function setDisplayText(el, text) {
  el.textContent = text;
  el.classList.toggle("empty-display", text === EMPTY_DISPLAY);
}

function buildSearchHighlightedHtml(text, query) {
  const str = String(text ?? "");
  const q = String(query ?? "").trim();
  if (!q) return escapeHtml(str);

  const lowerStr = str.toLowerCase();
  const lowerQ = q.toLowerCase();
  if (!lowerStr.includes(lowerQ)) return escapeHtml(str);

  let html = "";
  let start = 0;
  let idx = lowerStr.indexOf(lowerQ, start);
  while (idx !== -1) {
    html += escapeHtml(str.slice(start, idx));
    html += `<mark class="search-match">${escapeHtml(str.slice(idx, idx + q.length))}</mark>`;
    start = idx + q.length;
    idx = lowerStr.indexOf(lowerQ, start);
  }
  html += escapeHtml(str.slice(start));
  return html;
}

/** Write `text` into `el`, marking the active search query if it matches. */
function mountSearchHighlightedText(el, text) {
  if (isEmptyValue(text)) {
    setDisplayText(el, EMPTY_DISPLAY);
    return;
  }
  const display = String(text);
  const q = getActiveSearchQuery();
  if (!q || !display.toLowerCase().includes(q.toLowerCase())) {
    setDisplayText(el, display);
    return;
  }
  el.classList.remove("empty-display");
  el.innerHTML = buildSearchHighlightedHtml(display, q);
}

// ── App-level status messages ────────────────────────────────────────────────

let appLoadingActive = true;
let indicatorTimer;

function setAppLoading(active, message = "Loading...") {
  appLoadingActive = active;
  document.body.setAttribute("aria-busy", active ? "true" : "false");

  const overlay = document.getElementById("appSavingOverlay");
  const msgEl = document.getElementById("appSavingMessage");
  if (overlay) {
    overlay.hidden = !active;
    overlay.setAttribute("aria-hidden", active ? "false" : "true");
  }
  if (msgEl && active) msgEl.textContent = message;
}

function clearIndicator() {
  const wrap = document.getElementById("saveIndicatorWrap");
  const el = document.getElementById("saveIndicator");
  if (wrap) wrap.hidden = true;
  if (el) el.className = "save-indicator";
}

/** type: "" | "success" | "error". Success auto-dismisses; errors persist. */
function showIndicator(msg, type = "") {
  const el = document.getElementById("saveIndicator");
  const wrap = document.getElementById("saveIndicatorWrap");
  const dismiss = document.getElementById("saveIndicatorDismiss");
  if (!el) return;

  el.textContent = msg;
  if (wrap) wrap.hidden = false;
  el.className = "save-indicator visible" + (type ? ` ${type}` : "");
  clearTimeout(indicatorTimer);

  if (dismiss) dismiss.hidden = type !== "error";
  if (type === "success" || !type) {
    indicatorTimer = setTimeout(clearIndicator, 2500);
  }
}
