/**
 * Companies table filtering.
 *
 * Two layers, same as the source app:
 *   - a toolbar filter (which service a company is signed up for)
 *   - per-column checkbox filters driven by a shared header popover
 */

const COMPANY_FILTER_COLS = ["Company", "Owner", "Location", "Payroll", "Payroll Tax", "Sales Tax"];

const SERVICE_FILTER_ALL = "";

/** null = no filter on that column; otherwise a Set of allowed value keys. */
const companyColumnFilters = Object.fromEntries(COMPANY_FILTER_COLS.map(col => [col, null]));

let companyActiveServiceFilter = SERVICE_FILTER_ALL;
let companyOpenFilterCol = null;
let companyFilterDraft = new Set();

// ── Toolbar: service filter ──────────────────────────────────────────────────

function syncCompanyServiceFilterToolbar() {
  document.querySelectorAll("#companyServiceFilters .filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.service === companyActiveServiceFilter);
  });
}

function setCompanyServiceFilter(service) {
  companyActiveServiceFilter = service;
  syncCompanyServiceFilterToolbar();
  applyCompanyFilters();
}

function initCompanyToolbarFilters() {
  const group = document.getElementById("companyServiceFilters");
  if (!group) return;

  const makeBtn = (label, value) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn";
    btn.dataset.service = value;
    btn.textContent = label;
    btn.addEventListener("click", () => setCompanyServiceFilter(value));
    return btn;
  };

  group.replaceChildren(
    makeBtn("All", SERVICE_FILTER_ALL),
    ...SERVICES.map(s => makeBtn(s.label, s.key))
  );
  syncCompanyServiceFilterToolbar();
}

function rowPassesCompanyServiceFilter(company) {
  if (companyActiveServiceFilter === SERVICE_FILTER_ALL) return true;
  return company.services[companyActiveServiceFilter] === true;
}

// ── Column filters ───────────────────────────────────────────────────────────

/**
 * Value keys a company contributes to a column's filter list. Single-value
 * columns yield one; multi-value columns (Payroll) yield one per entry, so a
 * company running two schedules appears under both.
 */
function getCompanyFilterValueKeys(col, company) {
  const values = getCompanyColumnValues(company, col)
    .map(v => String(v ?? "").trim())
    .filter(Boolean);
  return values.length === 0 ? [BLANK_FILTER_LABEL] : values;
}

function compareCompanyFilterValues(a, b, col) {
  if (a === BLANK_FILTER_LABEL) return 1;
  if (b === BLANK_FILTER_LABEL) return -1;
  const options = getScheduleOptionsForColumn(col);
  if (options) return compareByOptionOrder(a, b, options);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function getCompanyUniqueColumnValues(col) {
  const values = new Set();
  getAllCompanies().forEach(company => {
    getCompanyFilterValueKeys(col, company).forEach(key => values.add(key));
  });
  return [...values].sort((a, b) => compareCompanyFilterValues(a, b, col));
}

function isCompanyColumnFilterActive(col) {
  return companyColumnFilters[col] != null;
}

function hasActiveCompanyFilters() {
  return companyActiveServiceFilter !== SERVICE_FILTER_ALL ||
    COMPANY_FILTER_COLS.some(isCompanyColumnFilterActive);
}

function updateCompanyClearAllFiltersButton() {
  const btn = document.getElementById("companiesClearAllFiltersBtn");
  if (btn) btn.hidden = !hasActiveCompanyFilters();
}

function clearAllCompanyFilters() {
  companyActiveServiceFilter = SERVICE_FILTER_ALL;
  COMPANY_FILTER_COLS.forEach(col => { companyColumnFilters[col] = null; });
  closeCompanyColumnFilterPopover();
  syncCompanyServiceFilterToolbar();
  updateCompanyColumnFilterHeaderStates();
  applyCompanyFilters();
}

function rowPassesCompanyColumnFilters(company) {
  for (const col of COMPANY_FILTER_COLS) {
    const selected = companyColumnFilters[col];
    if (selected == null) continue;
    if (selected.size === 0) return false;
    // A multi-value company matches if any one of its values is selected.
    const keys = getCompanyFilterValueKeys(col, company);
    if (!keys.some(key => selected.has(key))) return false;
  }
  return true;
}

/** Opening a popover with no filter set should show everything ticked. */
function getCompanyEffectiveFilterSelection(col) {
  const selected = companyColumnFilters[col];
  if (selected == null) return new Set(getCompanyUniqueColumnValues(col));
  return new Set(selected);
}

function updateCompanyColumnFilterHeaderStates() {
  document.querySelectorAll("#companiesTable th.th-filterable").forEach(th => {
    th.classList.toggle("filter-active", isCompanyColumnFilterActive(th.dataset.col));
  });
}

// ── Popover ──────────────────────────────────────────────────────────────────

function createCompanyFilterOption(value) {
  const label = document.createElement("label");
  label.className = "column-filter-option";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.value = value;
  cb.checked = companyFilterDraft.has(value);
  cb.addEventListener("change", () => {
    if (cb.checked) companyFilterDraft.add(value);
    else companyFilterDraft.delete(value);
  });

  const span = document.createElement("span");
  span.textContent = value;

  label.appendChild(cb);
  label.appendChild(span);
  return label;
}

function renderCompanyColumnFilterList() {
  const list = document.getElementById("columnFilterList");
  if (!list || !companyOpenFilterCol) return;
  list.replaceChildren(
    ...getCompanyUniqueColumnValues(companyOpenFilterCol).map(createCompanyFilterOption)
  );
}

function positionCompanyColumnFilterPopover(anchorTh) {
  const pop = document.getElementById("columnFilterPopover");
  if (!pop || !anchorTh) return;

  const rect = anchorTh.getBoundingClientRect();
  const maxLeft = window.innerWidth - pop.offsetWidth - 8;
  const left = Math.min(Math.max(8, rect.left), maxLeft);

  pop.style.top = `${rect.bottom + 4}px`;
  pop.style.left = `${left}px`;
}

function openCompanyColumnFilterPopover(col, anchorTh) {
  const pop = document.getElementById("columnFilterPopover");
  if (!pop) return;

  companyOpenFilterCol = col;
  companyFilterDraft = getCompanyEffectiveFilterSelection(col);
  pop.hidden = false;
  renderCompanyColumnFilterList();
  // Position now so the popover never paints at 0,0, then again after layout
  // settles in case the list changed its width.
  positionCompanyColumnFilterPopover(anchorTh);
  requestAnimationFrame(() => positionCompanyColumnFilterPopover(anchorTh));
}

function closeCompanyColumnFilterPopover() {
  const pop = document.getElementById("columnFilterPopover");
  if (pop) pop.hidden = true;
  companyOpenFilterCol = null;
}

function setCompanyFilterDraftSelectAll(selectAll) {
  if (!companyOpenFilterCol) return;
  companyFilterDraft = selectAll
    ? new Set(getCompanyUniqueColumnValues(companyOpenFilterCol))
    : new Set();
  renderCompanyColumnFilterList();
}

function applyCompanyColumnFilterFromPopover() {
  const col = companyOpenFilterCol;
  if (!col) return;

  const allValues = getCompanyUniqueColumnValues(col);
  // Everything ticked means "no filter", so the header stays clean.
  if (companyFilterDraft.size === allValues.length) companyColumnFilters[col] = null;
  else companyColumnFilters[col] = new Set(companyFilterDraft);

  closeCompanyColumnFilterPopover();
  updateCompanyColumnFilterHeaderStates();
  applyCompanyFilters();
}

function initCompanyColumnFilterHeaders() {
  document.querySelectorAll("#companiesTable th.th-filterable").forEach(th => {
    const col = th.dataset.col;
    if (!COMPANY_FILTER_COLS.includes(col)) return;

    if (!th.querySelector(".th-filter-hit")) {
      const hit = document.createElement("span");
      hit.className = "th-filter-hit";
      hit.setAttribute("aria-hidden", "true");
      th.appendChild(hit);
    }

    // Clicking the label sorts; clicking anywhere else opens the filter.
    th.querySelector(".th-label")?.addEventListener("click", e => {
      e.stopPropagation();
      sortCompaniesBy(col);
    });

    th.addEventListener("click", e => {
      if (e.target.closest(".th-label")) return;
      openCompanyColumnFilterPopover(col, th);
    });
  });

  document.getElementById("columnFilterSelectAll")?.addEventListener("click", () => setCompanyFilterDraftSelectAll(true));
  document.getElementById("columnFilterClearAll")?.addEventListener("click", () => setCompanyFilterDraftSelectAll(false));
  document.getElementById("columnFilterOk")?.addEventListener("click", applyCompanyColumnFilterFromPopover);
  document.getElementById("columnFilterCancel")?.addEventListener("click", closeCompanyColumnFilterPopover);
  document.getElementById("companiesClearAllFiltersBtn")?.addEventListener("click", clearAllCompanyFilters);

  document.addEventListener("click", e => {
    const pop = document.getElementById("columnFilterPopover");
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target) || e.target.closest("#companiesTable th.th-filterable")) return;
    closeCompanyColumnFilterPopover();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeCompanyColumnFilterPopover();
  });

  window.addEventListener("resize", () => {
    if (!companyOpenFilterCol) return;
    const th = document.querySelector(
      `#companiesTable th.th-filterable[data-col="${CSS.escape(companyOpenFilterCol)}"]`
    );
    if (th) positionCompanyColumnFilterPopover(th);
  });
}
