/**
 * View switching and the header menu.
 *
 * Views: "home" (calendar + upcoming tasks), "companies" (list) → "company"
 * (full-page detail) → back.
 * The detail page is a real view swap, not a modal, so the whole frame
 * (toolbar, footer pagination) hides with it.
 */

const APP_VIEWS = ["home", "companies", "company", "bookkeeping"];

let currentAppView = "home";

/**
 * Where the header's back button goes. Only view changes are recorded, so
 * moving between two companies stays one entry — going back from a company
 * lands on whatever you were looking at before you opened one, whether that
 * was the list, the calendar, or the bookkeeping grid.
 */
const appViewHistory = [];
let navigatingBack = false;

function getCurrentAppView() {
  return currentAppView;
}

function isCompaniesViewActive() {
  return currentAppView === "companies";
}

function updateAppBackButton() {
  const btn = document.getElementById("appBackBtn");
  if (btn) btn.disabled = appViewHistory.length === 0;
}

/** Step back one view. `fallback` covers arriving with nothing behind you. */
function goBackAppView(fallback = "") {
  const previous = appViewHistory.pop();
  const target = previous ?? fallback;
  if (!target) return;

  navigatingBack = true;
  switchAppView(target);
  navigatingBack = false;
  updateAppBackButton();
}

function switchAppView(view) {
  if (!APP_VIEWS.includes(view)) return;

  if (!navigatingBack && currentAppView !== view) {
    appViewHistory.push(currentAppView);
    // A session's worth of back steps is plenty; don't grow without bound.
    if (appViewHistory.length > 50) appViewHistory.shift();
  }
  currentAppView = view;

  const panes = {
    companiesToolbar: view === "companies",
    companiesTableWrap: view === "companies",
    companyDetailView: view === "company",
    calendarWrap: view === "home",
    bookkeepingView: view === "bookkeeping",
    // Pagination belongs to the list only.
    appFooterEnd: view === "companies",
  };
  Object.entries(panes).forEach(([id, visible]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible;
  });

  // The Companies tab stays selected while a company detail page is open —
  // the detail is a drill-down within that section.
  const tabs = {
    navLogoHome: view === "home",
    navTabCompanies: view === "companies" || view === "company",
    navTabBookkeeping: view === "bookkeeping",
  };
  Object.entries(tabs).forEach(([id, active]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-selected", active ? "true" : "false");
  });

  if (view === "companies" && typeof updateCompaniesPaginationUI === "function") {
    updateCompaniesPaginationUI();
  }
  // The grid needs real layout to size its rows, so render on entry.
  if (view === "home" && typeof renderCalendar === "function") renderCalendar();
  if (view === "bookkeeping" && typeof renderBookkeepingView === "function") renderBookkeepingView();
  updateAppBackButton();
}

// ── Header menu ──────────────────────────────────────────────────────────────

function closeHeaderMenu() {
  const dropdown = document.getElementById("headerMenuDropdown");
  const btn = document.getElementById("headerMenuBtn");
  if (dropdown) dropdown.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function initHeaderMenu() {
  const btn = document.getElementById("headerMenuBtn");
  const dropdown = document.getElementById("headerMenuDropdown");
  if (!btn || !dropdown) return;

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const open = dropdown.hidden;
    dropdown.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  document.addEventListener("click", e => {
    if (dropdown.hidden) return;
    if (dropdown.contains(e.target) || btn.contains(e.target)) return;
    closeHeaderMenu();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeHeaderMenu();
  });

  document.getElementById("headerMenuExportCsv")?.addEventListener("click", () => {
    closeHeaderMenu();
    exportCompaniesCsv();
  });

  document.getElementById("headerMenuResetData")?.addEventListener("click", async () => {
    closeHeaderMenu();
    if (!confirm("Permanently delete every company, owner, and completed task? This cannot be undone.")) return;
    setAppLoading(true, "Clearing…");
    await clearAllData();
    applyCompanyFilters();
    switchAppView("companies");
    setAppLoading(false);
    showIndicator("All data cleared", "success");
  });

  document.getElementById("headerMenuSignOut")?.addEventListener("click", async () => {
    closeHeaderMenu();
    // The auth listener in main.js reloads the page once the sign-out
    // actually lands, so there's nothing else to unwind here.
    await signOut();
  });
}

// ── CSV export ───────────────────────────────────────────────────────────────

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export whatever the current filters/search have narrowed the list to. */
function exportCompaniesCsv() {
  const rows = typeof filteredCompanies !== "undefined" ? filteredCompanies : getAllCompanies();
  if (!rows.length) {
    showIndicator("Nothing to export", "error");
    return;
  }

  const header = [
    "Company Name", "Owner", "Location", "Payroll", "Payroll Tax", "Sales Tax",
    ...SERVICES.map(s => s.label), "Notes",
  ];
  const lines = [header.map(csvCell).join(",")];

  rows.forEach(company => {
    lines.push([
      company.name,
      getCompanyOwnerName(company),
      getCompanyLocationDisplay(company),
      // The schedule columns read the same as the table: blank when the
      // service is off, so an inactive client's retained settings don't
      // export as if they were live.
      ...["Payroll", "Payroll Tax", "Sales Tax"].map(col => getCompanyColumnValue(company, col)),
      ...SERVICE_KEYS.map(key => (company.services[key] ? "Yes" : "No")),
      company.notes,
    ].map(csvCell).join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `companies-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showIndicator(`Exported ${rows.length} companies`, "success");
}

// ── Nav ──────────────────────────────────────────────────────────────────────

function initAppNav() {
  document.getElementById("navTabCompanies")?.addEventListener("click", () => switchAppView("companies"));
  document.getElementById("navLogoHome")?.addEventListener("click", () => switchAppView("home"));
  document.getElementById("navTabBookkeeping")?.addEventListener("click", () => switchAppView("bookkeeping"));
  document.getElementById("appBackBtn")?.addEventListener("click", () => goBackAppView("home"));

  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    setAppLoading(true, "Refreshing…");
    await loadAppData();
    applyCompanyFilters();
    setAppLoading(false);
    showIndicator("Refreshed", "success");
  });

  document.getElementById("saveIndicatorDismiss")?.addEventListener("click", clearIndicator);
}
