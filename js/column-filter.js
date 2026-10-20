/**
 * Header filters — the PO app's design: click a column's label to sort, or
 * the rest of the header (the funnel) to pick which values to show. One
 * popover serves every table.
 *
 *   initColumnFilter("stylesTable", "ihd", {
 *     options: () => [{ key, label, count }],   // what can be ticked
 *     onChange: () => applyStyleFilters(),      // redraw after OK
 *   });
 *   columnFilterPasses("stylesTable", "ihd", key)  // in the table's filter
 *
 * Used for IHD by month (monthFilterKey / monthFilterOptions below), and
 * for the Magento products table, where the ticked keys go to Magento
 * (getColumnFilterSelection) instead of filtering rows here.
 */

const columnFilters = new Map(); // "table:col" → { selected: Set | null, options, onChange, th }
let openColumnFilter = null;     // the entry being edited
let columnFilterDraft = new Set();

function columnFilterId(tableId, col) {
  return `${tableId}:${col}`;
}

/** null selection = everything shown. */
function columnFilterPasses(tableId, col, key) {
  const entry = columnFilters.get(columnFilterId(tableId, col));
  return !entry?.selected || entry.selected.has(key);
}

function isColumnFilterActive(tableId, col) {
  return Boolean(columnFilters.get(columnFilterId(tableId, col))?.selected);
}

/** The ticked keys, or null when the column isn't filtered. */
function getColumnFilterSelection(tableId, col) {
  const selected = columnFilters.get(columnFilterId(tableId, col))?.selected;
  return selected ? [...selected] : null;
}

/** Set a filter from code (null shows everything). Doesn't call onChange. */
function setColumnFilterSelection(tableId, col, keys) {
  const entry = columnFilters.get(columnFilterId(tableId, col));
  if (!entry) return;
  entry.selected = keys ? new Set(keys) : null;
  entry.th.classList.toggle("filter-active", Boolean(entry.selected));
}

function clearColumnFilter(tableId, col) {
  const entry = columnFilters.get(columnFilterId(tableId, col));
  if (!entry?.selected) return;
  entry.selected = null;
  entry.th.classList.remove("filter-active");
  entry.onChange();
}

/** `width` (px) widens the popover for long option lists, e.g. category paths. */
function initColumnFilter(tableId, col, { options, onChange, width = null }) {
  const th = document.querySelector(`#${tableId} thead th[data-col="${col}"]`);
  if (!th) return;
  const entry = { selected: null, options, onChange, th, width };
  columnFilters.set(columnFilterId(tableId, col), entry);

  th.classList.add("th-filterable");
  th.classList.remove("th-no-sort");
  if (!th.querySelector(".th-label")) {
    const label = document.createElement("span");
    label.className = "th-label";
    label.append(...th.childNodes);
    th.appendChild(label);
  }
  // The funnel, right after the label; the popover opens under it.
  const hit = document.createElement("span");
  hit.className = "th-filter-hit";
  hit.setAttribute("aria-hidden", "true");
  th.appendChild(hit);
  entry.hit = hit;

  // Capture phase, so a click outside the label opens the filter instead of
  // reaching the table's sort handler.
  th.addEventListener("click", e => {
    if (e.target.closest(".th-label")) return;
    e.stopImmediatePropagation();
    if (openColumnFilter === entry) closeColumnFilterPopover();
    else openColumnFilterPopover(entry);
  }, true);
}

// ── The popover ──────────────────────────────────────────────────────────────

function openColumnFilterPopover(entry) {
  const pop = document.getElementById("columnFilterPopover");
  if (!pop) return;
  openColumnFilter?.hit?.classList.remove("is-open");
  openColumnFilter = entry;
  const all = entry.options().map(o => o.key);
  columnFilterDraft = new Set(entry.selected ? all.filter(k => entry.selected.has(k)) : all);
  renderColumnFilterList();
  pop.style.width = entry.width ? `${entry.width}px` : "";
  pop.style.maxWidth = entry.width ? `min(${entry.width}px, calc(100vw - 16px))` : "";
  entry.hit?.classList.add("is-open");
  pop.hidden = false;
  // Right away — reading its width lays it out — so it never shows misplaced.
  positionColumnFilterPopover(entry);
}

function closeColumnFilterPopover() {
  const pop = document.getElementById("columnFilterPopover");
  if (pop) pop.hidden = true;
  openColumnFilter?.hit?.classList.remove("is-open");
  openColumnFilter = null;
}

function renderColumnFilterList() {
  const list = document.getElementById("columnFilterList");
  if (!list || !openColumnFilter) return;
  const options = openColumnFilter.options();
  if (!options.length) {
    list.innerHTML = '<div class="column-filter-empty">Nothing to filter yet</div>';
    return;
  }
  list.replaceChildren(...options.map(({ key, label, count }) => {
    const row = document.createElement("label");
    row.className = "column-filter-option";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = columnFilterDraft.has(key);
    cb.addEventListener("change", () => {
      if (cb.checked) columnFilterDraft.add(key); else columnFilterDraft.delete(key);
    });
    const text = document.createElement("span");
    text.className = "column-filter-option-label";
    text.textContent = label;
    row.append(cb, text);
    if (count != null) {
      const n = document.createElement("span");
      n.className = "column-filter-count";
      n.textContent = count.toLocaleString();
      row.appendChild(n);
    }
    return row;
  }));
}

/** Under the funnel — centred on it, kept inside the window — just below the header. */
function positionColumnFilterPopover(entry) {
  const pop = document.getElementById("columnFilterPopover");
  if (!pop || !entry?.th) return;
  const header = entry.th.getBoundingClientRect();
  const icon = (entry.hit ?? entry.th).getBoundingClientRect();
  const centre = icon.left + icon.width / 2;
  const left = Math.min(Math.max(8, centre - pop.offsetWidth / 2), window.innerWidth - pop.offsetWidth - 8);
  pop.style.top = `${header.bottom + 4}px`;
  pop.style.left = `${left}px`;
}

function applyColumnFilterFromPopover() {
  const entry = openColumnFilter;
  if (!entry) return;
  const all = entry.options().map(o => o.key);
  // Everything ticked is the same as no filter.
  entry.selected = all.every(k => columnFilterDraft.has(k)) ? null : new Set(columnFilterDraft);
  entry.th.classList.toggle("filter-active", Boolean(entry.selected));
  closeColumnFilterPopover();
  entry.onChange();
}

function setColumnFilterDraftAll(on) {
  if (!openColumnFilter) return;
  columnFilterDraft = on ? new Set(openColumnFilter.options().map(o => o.key)) : new Set();
  renderColumnFilterList();
}

function initColumnFilterPopover() {
  document.getElementById("columnFilterSelectAll")?.addEventListener("click", () => setColumnFilterDraftAll(true));
  document.getElementById("columnFilterClearAll")?.addEventListener("click", () => setColumnFilterDraftAll(false));
  document.getElementById("columnFilterOk")?.addEventListener("click", applyColumnFilterFromPopover);
  document.getElementById("columnFilterCancel")?.addEventListener("click", closeColumnFilterPopover);

  document.addEventListener("click", e => {
    const pop = document.getElementById("columnFilterPopover");
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target) || e.target.closest("th.th-filterable")) return;
    closeColumnFilterPopover();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeColumnFilterPopover();
    if (e.key === "Enter" && openColumnFilter && document.getElementById("columnFilterPopover")?.contains(document.activeElement)) {
      e.preventDefault();
      applyColumnFilterFromPopover();
    }
  });
  window.addEventListener("resize", () => {
    if (openColumnFilter) positionColumnFilterPopover(openColumnFilter);
  });
  // The tables scroll under a fixed popover — close it rather than leave it floating.
  document.addEventListener("scroll", e => {
    if (openColumnFilter && !document.getElementById("columnFilterPopover")?.contains(e.target)) closeColumnFilterPopover();
  }, true);
}

// ── Months ───────────────────────────────────────────────────────────────────

/** "2026-10-28" → "2026-10"; no date → "(Blank)". */
function monthFilterKey(ymdValue) {
  return /^\d{4}-\d{2}/.test(ymdValue ?? "") ? ymdValue.slice(0, 7) : BLANK_FILTER_LABEL;
}

/** One option per month present, oldest first, then (Blank) — with counts. */
function monthFilterOptions(dates) {
  const counts = new Map();
  dates.forEach(d => {
    const key = monthFilterKey(d);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.keys()]
    .sort((a, b) => (a === BLANK_FILTER_LABEL) - (b === BLANK_FILTER_LABEL) || a.localeCompare(b))
    .map(key => ({
      key,
      count: counts.get(key),
      label: key === BLANK_FILTER_LABEL
        ? "No IHD"
        : new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" }),
    }));
}
