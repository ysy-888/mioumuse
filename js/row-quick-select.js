/**
 * Quick select — spreadsheet-style row picking on any table with row tick
 * boxes (Styles, Need to Shoot, Magento Products and Orders). From PO-App's
 * mini-selection.
 *
 *   Click         that row (it still opens the side pane as before)
 *   Ctrl-click    add or take out one row (Cmd on a Mac)
 *   Shift-click   every row from the last one clicked to this one
 *                 (Ctrl+Shift adds the range to what's picked)
 *   Drag          down or up the rows, from one row to another
 *   ↑ / ↓         move a single picked row
 *   Space         tick the picked rows' boxes, or untick them all if they're
 *                 all ticked (mostly ticked: the rest get ticked; mostly
 *                 not: the ticked ones are unticked)
 *   Esc           drop the quick selection
 *
 * Clicking anywhere outside the table drops it too. Ticking goes through
 * each box's own change handler, so each table's selection bar and header
 * box keep up. A redraw (filter, page, sort) starts over.
 */

const QUICK_SELECT_BLOCKED = "input, textarea, select, button, a, label, [contenteditable='true'], .shoot-picker, .ihd-input, .style-notes-input";
const QUICK_SELECT_DRAG_PX = 6;

let quickBody = null; // the tbody the picked rows are in
let quickRows = new Set(); // <tr> elements
let quickAnchor = null; // where Shift ranges start
let quickDrag = null; // { tr, x, y, dragging, additive, base }
let quickSuppressClick = false;

/** The rows of a tbody that have a tick box, top to bottom. */
function quickSelectableRows(tbody) {
  return [...tbody.rows].filter(tr => tr.querySelector("input.row-select"));
}

function quickRowFromEvent(e) {
  if (!(e.target instanceof Element) || e.target.closest(QUICK_SELECT_BLOCKED)) return null;
  const tr = e.target.closest("tbody > tr");
  return tr?.querySelector("input.row-select") ? tr : null;
}

function paintQuickSelection() {
  document.querySelectorAll("tr.row-quick-selected").forEach(tr => {
    if (!quickRows.has(tr)) tr.classList.remove("row-quick-selected");
  });
  quickRows.forEach(tr => tr.classList.add("row-quick-selected"));
}

/** Rows a redraw has replaced no longer count. */
function pruneQuickSelection() {
  quickRows.forEach(tr => { if (!tr.isConnected) quickRows.delete(tr); });
  if (quickAnchor && !quickAnchor.isConnected) quickAnchor = null;
  if (!quickRows.size) quickBody = null;
}

function clearQuickSelection() {
  if (!quickRows.size && !quickAnchor) return;
  quickRows = new Set();
  quickAnchor = null;
  quickBody = null;
  paintQuickSelection();
}

/** Start over in another table. */
function useQuickBody(tbody) {
  if (quickBody === tbody) return;
  clearQuickSelection();
  quickBody = tbody;
}

function quickRange(from, to) {
  const rows = quickSelectableRows(quickBody);
  const a = rows.indexOf(from);
  const b = rows.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return rows.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function setQuickRows(rows) {
  quickRows = new Set(rows);
  paintQuickSelection();
}

function onQuickPointerDown(e) {
  if (e.button !== 0) return;
  const tr = quickRowFromEvent(e);
  if (!tr) {
    // Outside the table: drop it — unless it's a menu or popover over it.
    if (quickRows.size && !e.target.closest?.("tbody, .header-menu-dropdown, .column-filter-popover, #shootMenu")) clearQuickSelection();
    return;
  }
  pruneQuickSelection();
  useQuickBody(tr.parentElement);
  const additive = e.ctrlKey || e.metaKey;

  if (e.shiftKey) {
    e.preventDefault(); // no text highlighting
    const anchor = quickAnchor ?? tr;
    const range = quickRange(anchor, tr);
    setQuickRows(additive ? [...quickRows, ...range] : range);
    quickAnchor = anchor;
    quickSuppressClick = true; // not a pane-opening click
    return;
  }
  if (additive) {
    e.preventDefault();
    if (quickRows.has(tr)) quickRows.delete(tr); else quickRows.add(tr);
    paintQuickSelection();
    quickAnchor = tr;
    quickSuppressClick = true;
    return;
  }
  quickDrag = { tr, x: e.clientX, y: e.clientY, dragging: false };
  quickAnchor = tr;
  setQuickRows([tr]);
}

function onQuickPointerMove(e) {
  if (!quickDrag || !(e.buttons & 1)) return;
  if (!quickDrag.dragging) {
    if (Math.hypot(e.clientX - quickDrag.x, e.clientY - quickDrag.y) < QUICK_SELECT_DRAG_PX) return;
    quickDrag.dragging = true;
    document.body.classList.add("row-drag-selecting");
    window.getSelection()?.removeAllRanges();
  }
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest("tbody > tr");
  if (!over || over.parentElement !== quickBody || !over.querySelector("input.row-select")) return;
  setQuickRows(quickRange(quickDrag.tr, over));
}

function onQuickPointerUp() {
  if (!quickDrag) return;
  if (quickDrag.dragging) quickSuppressClick = true; // a drag isn't a click on the last row
  quickDrag = null;
  document.body.classList.remove("row-drag-selecting");
}

/** Ctrl / Shift clicks and drags pick rows; they don't also open the pane. */
function onQuickClickCapture(e) {
  if (!quickSuppressClick) return;
  quickSuppressClick = false;
  if (e.target instanceof Element && e.target.closest("tbody > tr")) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function quickSelectBlockedByUi(e) {
  const t = e.target;
  if (t instanceof Element && t.closest("input, textarea, select, [contenteditable='true']")) return true;
  if (document.querySelector(".modal-backdrop.open")) return true;
  return false;
}

/** All ticked → untick; none → tick; otherwise follow the majority. */
function toggleQuickSelectedBoxes() {
  const boxes = [...quickRows].map(tr => tr.querySelector("input.row-select")).filter(cb => cb && !cb.disabled);
  if (!boxes.length) return;
  const ticked = boxes.filter(cb => cb.checked).length;
  const target = ticked === boxes.length ? false : ticked === 0 ? true : ticked > boxes.length / 2;
  boxes.forEach(cb => {
    if (cb.checked === target) return;
    cb.checked = target;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function onQuickKeyDown(e) {
  pruneQuickSelection();
  if (!quickRows.size || e.altKey || e.ctrlKey || e.metaKey) return;
  if (quickSelectBlockedByUi(e)) return;

  if (e.key === " " || e.code === "Space") {
    if (e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation(); // before the Space-to-search shortcut
    toggleQuickSelectedBoxes();
  } else if (e.key === "Escape") {
    // An open menu or pane closes first; the selection goes on the next Esc.
    if ([...document.querySelectorAll(".header-menu-dropdown, .column-filter-popover")].some(el => !el.hidden)) return;
    clearQuickSelection();
  } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && quickRows.size === 1 && !e.shiftKey) {
    const rows = quickSelectableRows(quickBody);
    const next = rows[rows.indexOf([...quickRows][0]) + (e.key === "ArrowUp" ? -1 : 1)];
    if (!next) return;
    e.preventDefault();
    setQuickRows([next]);
    quickAnchor = next;
    next.scrollIntoView({ block: "nearest" });
  }
}

function initRowQuickSelect() {
  document.addEventListener("pointerdown", onQuickPointerDown);
  document.addEventListener("pointermove", onQuickPointerMove);
  document.addEventListener("pointerup", onQuickPointerUp);
  document.addEventListener("pointercancel", onQuickPointerUp);
  document.addEventListener("click", onQuickClickCapture, true);
  // Capture: ahead of the page shortcuts (Space = search, Esc).
  document.addEventListener("keydown", onQuickKeyDown, true);
}
