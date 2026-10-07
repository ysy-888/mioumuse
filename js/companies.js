/** Companies list view — search, sort, pagination, and row rendering. */

const COMPANY_COLUMNS = ["Company", "Owner", "Location", "Payroll", "Payroll Tax", "Sales Tax", "Services", "Notes"];

/** Columns the toolbar search scans. */
const COMPANY_SEARCH_COLUMNS = ["Company", "Owner", "Location", "Payroll", "Payroll Tax", "Sales Tax", "Notes"];

/** Applied when no explicit sort is chosen, and as a tiebreaker. */
const COMPANY_DEFAULT_SORT_COLUMN = "Company";

const COMPANY_PAGE_SIZE_STORAGE_BASE = "companiesPageSize";
const DEFAULT_PAGE_SIZE = "60";

let filteredCompanies = [];
let companySortCol = null;
let companySortDir = 1;
let companyPageSize = 60;
let companyCurrentPage = 1;

// ── Column access ────────────────────────────────────────────────────────────

/** Columns that hold a list rather than a single value. */
const COMPANY_MULTI_VALUE_COLUMNS = new Set(["Payroll"]);

function isCompanyMultiValueColumn(col) {
  return COMPANY_MULTI_VALUE_COLUMNS.has(col);
}

/**
 * The service a schedule column belongs to. A schedule is only meaningful
 * when the client actually buys that service, so the columns read blank when
 * it is switched off — the stored value is kept for when it comes back.
 */
const COMPANY_COLUMN_SERVICE = {
  "Payroll": "payroll",
  "Payroll Tax": "payroll",
  "Sales Tax": "salesTax",
};

/**
 * Which colour family a column's values belong to — a finer split than the
 * service above, because pay schedules and tax deposits are both sold as
 * "payroll" but read as different work. They share values too ("Monthly" is
 * a pay cadence in one column and a depositor status in the other), so the
 * value alone can never pick the colour.
 */
const COMPANY_COLUMN_COLOR_GROUP = {
  "Payroll": "payroll",
  "Payroll Tax": "payrollTax",
  "Sales Tax": "salesTax",
};

function isCompanyColumnServiceActive(company, col) {
  const service = COMPANY_COLUMN_SERVICE[col];
  return !service || company.services?.[service] === true;
}

/** Always an array — the uniform shape filters and rendering work against. */
function getCompanyColumnValues(company, col) {
  if (!isCompanyColumnServiceActive(company, col)) return [];
  if (col === "Payroll") return company.payrollSchedules ?? [];
  const single = getCompanyColumnValue(company, col);
  return single ? [single] : [];
}

/**
 * Canonical accessor: column label → a single string, for search and display.
 * Multi-value columns collapse to a comma-joined list; use
 * getCompanyColumnValues when the individual values matter.
 */
function getCompanyColumnValue(company, col) {
  switch (col) {
    case "Company":     return company.name;
    case "Owner":       return getCompanyOwnerName(company);
    case "Location":    return getCompanyLocationDisplay(company);
    case "Payroll":
      return isCompanyColumnServiceActive(company, col)
        ? (company.payrollSchedules ?? []).join(", ")
        : "";
    case "Payroll Tax": return isCompanyColumnServiceActive(company, col) ? company.payrollTax : "";
    case "Sales Tax":   return isCompanyColumnServiceActive(company, col) ? company.salesTax : "";
    // Collapse newlines — the cell is a single line, and a raw break would
    // just render as a space mid-sentence anyway.
    case "Notes":       return String(company.notes ?? "").replace(/\s+/g, " ").trim();
    default:            return "";
  }
}

/** The fixed option list for a schedule column, or null for free-text columns. */
function getScheduleOptionsForColumn(col) {
  switch (col) {
    case "Payroll":     return PAYROLL_SCHEDULES;
    case "Payroll Tax": return PAYROLL_TAX_SCHEDULES;
    case "Sales Tax":   return SALES_TAX_SCHEDULES;
    default:            return null;
  }
}

// ── Sorting ──────────────────────────────────────────────────────────────────

function compareCompaniesByColumn(col, a, b) {
  const options = getScheduleOptionsForColumn(col);
  if (options) {
    // Multi-value columns sort on their earliest cadence.
    const first = company => getCompanyColumnValues(company, col)[0] ?? "";
    return compareByOptionOrder(first(a), first(b), options);
  }
  return compareTextFieldValues(getCompanyColumnValue(a, col), getCompanyColumnValue(b, col));
}

function compareCompaniesForSort(a, b) {
  if (companySortCol) {
    const primary = compareCompaniesByColumn(companySortCol, a, b) * companySortDir;
    if (primary !== 0) return primary;
    if (companySortCol !== COMPANY_DEFAULT_SORT_COLUMN) {
      return compareCompaniesByColumn(COMPANY_DEFAULT_SORT_COLUMN, a, b);
    }
    return 0;
  }
  return compareCompaniesByColumn(COMPANY_DEFAULT_SORT_COLUMN, a, b);
}

/** Columns that carry a sortable value. "Services" is a glyph column. */
const COMPANY_SORTABLE_COLUMNS = new Set(COMPANY_SEARCH_COLUMNS);

/** Cycle: unsorted → ascending → descending → unsorted. */
function sortCompaniesBy(col) {
  if (!COMPANY_SORTABLE_COLUMNS.has(col)) return;
  if (companySortCol === col) {
    if (companySortDir === 1) {
      companySortDir = -1;
    } else {
      companySortCol = null;
      companySortDir = 1;
    }
  } else {
    companySortCol = col;
    companySortDir = 1;
  }
  updateCompanySortHeaders();
  applyCompanyFilters();
}

function updateCompanySortHeaders() {
  document.querySelectorAll("#companiesTable thead th[data-col]").forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (companySortCol && th.dataset.col === companySortCol) {
      th.classList.add(companySortDir === 1 ? "sorted-asc" : "sorted-desc");
    }
  });
}

// ── Filter + search pipeline ─────────────────────────────────────────────────

function applyCompanyFilters() {
  const q = (document.getElementById("companySearchInput")?.value ?? "").trim().toLowerCase();
  setActiveSearchQuery(q);

  filteredCompanies = getAllCompanies().filter(company => {
    if (!rowPassesCompanyServiceFilter(company)) return false;
    if (!rowPassesCompanyColumnFilters(company)) return false;
    if (!q) return true;
    const haystack = COMPANY_SEARCH_COLUMNS
      .map(col => String(getCompanyColumnValue(company, col) ?? ""))
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  filteredCompanies.sort(compareCompaniesForSort);
  companyCurrentPage = 1;

  renderCompaniesTable();
  updateCompaniesRowCounter();
  updateCompaniesPaginationUI();
  updateCompanyClearAllFiltersButton();
}

// ── Pagination ───────────────────────────────────────────────────────────────

function normalizePageSizeValue(value) {
  const s = String(value ?? "").trim();
  if (s === "all") return "all";
  return ["30", "60", "120"].includes(s) ? s : DEFAULT_PAGE_SIZE;
}

function isCompanyPageSizeAll() {
  return !Number.isFinite(companyPageSize);
}

function getCompaniesTotalPages() {
  if (isCompanyPageSizeAll() || filteredCompanies.length === 0) return 1;
  return Math.ceil(filteredCompanies.length / companyPageSize);
}

function getPagedCompanies() {
  if (isCompanyPageSizeAll()) return filteredCompanies;
  const totalPages = getCompaniesTotalPages();
  companyCurrentPage = Math.min(Math.max(1, companyCurrentPage), totalPages);
  const start = (companyCurrentPage - 1) * companyPageSize;
  return filteredCompanies.slice(start, start + companyPageSize);
}

function getCompaniesRowCounterText() {
  const total = filteredCompanies.length;
  if (total === 0) return "0 companies";
  if (isCompanyPageSizeAll()) return total === 1 ? "1 company" : `${total} companies`;
  const start = (companyCurrentPage - 1) * companyPageSize + 1;
  const end = Math.min(companyCurrentPage * companyPageSize, total);
  return `${start}${EN_DASH}${end} of ${total}`;
}

function updateCompaniesRowCounter() {
  const el = document.getElementById("companiesRowCounter");
  if (el) el.textContent = getCompaniesRowCounterText();
}

function updateCompaniesPaginationUI() {
  const nav = document.getElementById("paginationNav");
  if (!nav) return;

  const totalPages = getCompaniesTotalPages();
  const show = !isCompanyPageSizeAll() && filteredCompanies.length > companyPageSize;
  nav.hidden = !show;
  if (!show) return;

  const indicator = document.getElementById("pageIndicator");
  if (indicator) indicator.textContent = `${companyCurrentPage} / ${totalPages}`;

  const onFirst = companyCurrentPage <= 1;
  const onLast = companyCurrentPage >= totalPages;
  const set = (id, disabled) => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  };
  set("pageFirst", onFirst);
  set("pagePrev", onFirst);
  set("pageNext", onLast);
  set("pageLast", onLast);
}

function goToCompaniesPage(page) {
  const totalPages = getCompaniesTotalPages();
  const next = Math.min(Math.max(1, page), totalPages);
  if (next === companyCurrentPage) return;
  companyCurrentPage = next;
  renderCompaniesTable();
  updateCompaniesRowCounter();
  updateCompaniesPaginationUI();
  document.getElementById("companiesTableWrap")?.scrollTo({ top: 0 });
}

function loadCompanyPageSizePreference() {
  try {
    return normalizePageSizeValue(
      localStorage.getItem(scopedStorageKey(COMPANY_PAGE_SIZE_STORAGE_BASE)) ?? DEFAULT_PAGE_SIZE
    );
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

function applyCompanyPageSize(value) {
  const normalized = normalizePageSizeValue(value);
  companyPageSize = normalized === "all" ? Infinity : Number(normalized);
  companyCurrentPage = 1;
  const select = document.getElementById("pageSizeSelect");
  if (select) select.value = normalized;
}

function setCompanyPageSize(value) {
  const normalized = normalizePageSizeValue(value);
  try {
    localStorage.setItem(scopedStorageKey(COMPANY_PAGE_SIZE_STORAGE_BASE), normalized);
  } catch {
    /* preference is best-effort */
  }
  applyCompanyPageSize(normalized);
  renderCompaniesTable();
  updateCompaniesRowCounter();
  updateCompaniesPaginationUI();
}

function initCompaniesPagination() {
  applyCompanyPageSize(loadCompanyPageSizePreference());

  document.getElementById("pageFirst")?.addEventListener("click", () => goToCompaniesPage(1));
  document.getElementById("pagePrev")?.addEventListener("click", () => goToCompaniesPage(companyCurrentPage - 1));
  document.getElementById("pageNext")?.addEventListener("click", () => goToCompaniesPage(companyCurrentPage + 1));
  document.getElementById("pageLast")?.addEventListener("click", () => goToCompaniesPage(getCompaniesTotalPages()));
  document.getElementById("pageSizeSelect")?.addEventListener("change", e => setCompanyPageSize(e.target.value));

  document.addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (!isCompaniesViewActive()) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? "")) return;
    if (isCompanyPageSizeAll() || filteredCompanies.length <= companyPageSize) return;

    e.preventDefault();
    goToCompaniesPage(companyCurrentPage + (e.key === "ArrowLeft" ? -1 : 1));
  });
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderScheduleCell(td, values, group = "") {
  const list = (Array.isArray(values) ? values : [values])
    .map(v => String(v ?? "").trim())
    .filter(Boolean);

  if (list.length === 0) {
    setDisplayText(td, EMPTY_DISPLAY);
    return;
  }

  td.classList.remove("empty-display");
  td.replaceChildren(...list.map(value => {
    const pill = document.createElement("span");
    pill.className = "schedule-pill";
    pill.dataset.schedule = value;
    // "Monthly" means different things under payroll and sales tax, so the
    // colour comes from the pair, not the value alone.
    if (group) pill.dataset.group = group;
    // Column widths are tight, so long cadences show their short form with
    // the full name on hover.
    const short = getScheduleAbbreviation(value);
    if (short !== value) pill.title = value;
    mountSearchHighlightedText(pill, short);
    return pill;
  }));
}

function renderServicesCell(td, company) {
  const wrap = document.createElement("span");
  wrap.className = "service-dots";

  const enabled = SERVICES.filter(s => company.services[s.key]);
  SERVICES.forEach(service => {
    const dot = document.createElement("span");
    dot.className = "service-dot" + (company.services[service.key] ? " is-on" : "");
    dot.dataset.service = service.key;
    wrap.appendChild(dot);
  });

  wrap.title = enabled.length
    ? enabled.map(s => s.label).join(", ")
    : "No services enabled";
  td.replaceChildren(wrap);
}

function renderCompaniesTable() {
  const tbody = document.getElementById("companiesTableBody");
  if (!tbody) return;

  if (filteredCompanies.length === 0) {
    const msg = getAllCompanies().length === 0
      ? "No companies yet."
      : "No companies match the current filters.";
    tbody.innerHTML = `<tr class="state-row"><td colspan="${COMPANY_COLUMNS.length}">${escapeHtml(msg)}</td></tr>`;
    return;
  }

  tbody.replaceChildren();
  getPagedCompanies().forEach(company => {
    const tr = document.createElement("tr");
    tr.className = "clickable-row";
    tr.dataset.companyId = company.id;

    COMPANY_COLUMNS.forEach(col => {
      const td = document.createElement("td");
      td.dataset.col = col;

      if (col === "Services") {
        renderServicesCell(td, company);
      } else if (getScheduleOptionsForColumn(col)) {
        renderScheduleCell(td, getCompanyColumnValues(company, col), COMPANY_COLUMN_COLOR_GROUP[col]);
      } else {
        const value = getCompanyColumnValue(company, col);
        mountSearchHighlightedText(td, value);
        // Notes is the one column that routinely overflows its cell.
        if (col === "Notes" && value) td.title = company.notes;
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initCompaniesView() {
  initCompanyToolbarFilters();
  initCompanyColumnFilterHeaders();
  initCompaniesPagination();

  // Non-filterable headers sort on a plain click, unless opted out.
  document.querySelectorAll("#companiesTable thead th[data-col]:not(.th-filterable):not(.th-no-sort)").forEach(th => {
    th.addEventListener("click", () => sortCompaniesBy(th.dataset.col));
  });

  document.getElementById("companySearchInput")?.addEventListener("input", applyCompanyFilters);

  // Single click opens the company — this is the app's primary drill-down.
  document.getElementById("companiesTableBody")?.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-company-id]");
    if (!tr) return;
    const company = getCompanyById(tr.dataset.companyId);
    if (company) openCompanyDetail(company.id);
  });

  updateCompanySortHeaders();
  updateCompanyColumnFilterHeaderStates();
}
