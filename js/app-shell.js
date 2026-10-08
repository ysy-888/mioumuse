/**
 * View switching and the header menu.
 *
 * Views: "home" (calendar + upcoming tasks), "tradeShows" (list) →
 * "tradeShow" (full-page detail) → back.
 * The detail page is a real view swap, not a modal, so the whole frame
 * (toolbar included) hides with it.
 */

const APP_VIEWS = ["home", "tradeShows", "tradeShow"];

let currentAppView = "home";

/**
 * Where the header's back button goes. Only view changes are recorded, so
 * moving between two shows stays one entry — going back from a show lands on
 * whatever you were looking at before you opened one.
 */
const appViewHistory = [];
let navigatingBack = false;

function getCurrentAppView() {
  return currentAppView;
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
    tradeShowsToolbar: view === "tradeShows",
    tradeShowsTableWrap: view === "tradeShows",
    tradeShowDetailView: view === "tradeShow",
    calendarWrap: view === "home",
  };
  Object.entries(panes).forEach(([id, visible]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible;
  });

  // The Trade Shows tab stays selected while a show's page is open — the
  // detail is a drill-down within that section.
  const tabs = {
    navLogoHome: view === "home",
    navTabTradeShows: view === "tradeShows" || view === "tradeShow",
  };
  Object.entries(tabs).forEach(([id, active]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-selected", active ? "true" : "false");
  });

  // The grid needs real layout to size its rows, so render on entry.
  if (view === "home") renderCalendar();
  if (view === "tradeShows") applyTradeShowFilters();
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
    exportTradeShowsCsv();
  });

  document.getElementById("headerMenuResetData")?.addEventListener("click", async () => {
    closeHeaderMenu();
    if (!confirm("Permanently delete every trade show and completed task? This cannot be undone.")) return;
    setAppLoading(true, "Clearing…");
    try {
      await clearAllData();
      switchAppView("tradeShows");
      showIndicator("All data cleared", "success");
    } catch (err) {
      showIndicator(err.message || "Could not clear data.", "error");
    } finally {
      setAppLoading(false);
    }
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

/** Every trade show with its email dates and whether each one is done. */
function exportTradeShowsCsv() {
  const rows = [...getAllTradeShows()].sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!rows.length) {
    showIndicator("Nothing to export", "error");
    return;
  }

  const header = [
    "Show", "Start", "End",
    ...TRADE_SHOW_EMAIL_TASKS.flatMap(email => [email.label, `${email.label} done`]),
    "Notes",
  ];
  const lines = [header.map(csvCell).join(",")];

  rows.forEach(tradeShow => {
    lines.push([
      getTradeShowLabel(tradeShow.show),
      tradeShow.startDate,
      tradeShow.endDate,
      ...buildTradeShowEmailTasks(tradeShow).flatMap(task => [task.dueDate, isTaskComplete(task.id) ? "Yes" : "No"]),
      tradeShow.notes,
    ].map(csvCell).join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trade-shows-${todayYmd()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showIndicator(`Exported ${rows.length} trade shows`, "success");
}

// ── Nav ──────────────────────────────────────────────────────────────────────

function initAppNav() {
  document.getElementById("navTabTradeShows")?.addEventListener("click", () => switchAppView("tradeShows"));
  document.getElementById("navLogoHome")?.addEventListener("click", () => switchAppView("home"));
  document.getElementById("appBackBtn")?.addEventListener("click", () => goBackAppView("home"));

  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    setAppLoading(true, "Refreshing…");
    try {
      await loadAppData();
      // Re-enter the current view so it renders from the fresh data. A show
      // that was deleted elsewhere falls back to the list.
      if (getCurrentAppView() === "tradeShow" && !getTradeShowById(currentTradeShowId)) {
        goBackAppView("tradeShows");
      } else {
        switchAppView(getCurrentAppView());
        refreshTradeShowDetailIfActive();
      }
      showIndicator("Refreshed", "success");
    } catch (err) {
      showIndicator(err.message || "Could not refresh.", "error");
    } finally {
      setAppLoading(false);
    }
  });

  document.getElementById("saveIndicatorDismiss")?.addEventListener("click", clearIndicator);
}
