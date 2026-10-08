/**
 * View switching and the header menu.
 *
 * Views: "home" (calendar + upcoming tasks), "campaigns" and "tradeShows"
 * (lists), and "platforms" (banners). A record opens in a side pane over
 * whichever view is showing (js/item-pane.js, js/banners.js), not as a view
 * of its own.
 */

const APP_VIEWS = ["home", "campaigns", "tradeShows", "platforms"];

let currentAppView = "home";

/** Where the header's back button goes. Only view changes are recorded. */
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
  // The pane belongs to what you opened it from; a different section
  // starts clean.
  if (currentAppView !== view) {
    closeItemPane();
    closeBannerPane();
  }
  currentAppView = view;

  const panes = {
    campaignsToolbar: view === "campaigns",
    campaignsTableWrap: view === "campaigns",
    tradeShowsToolbar: view === "tradeShows",
    tradeShowsTableWrap: view === "tradeShows",
    platformsToolbar: view === "platforms",
    bannersTableWrap: view === "platforms",
    calendarWrap: view === "home",
  };
  Object.entries(panes).forEach(([id, visible]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible;
  });

  const tabs = {
    navLogoHome: view === "home",
    navTabCampaigns: view === "campaigns",
    navTabTradeShows: view === "tradeShows",
    navTabPlatforms: view === "platforms",
  };
  Object.entries(tabs).forEach(([id, active]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-selected", active ? "true" : "false");
  });

  // The grid needs real layout to size its rows, so render on entry.
  if (view === "home") renderCalendar();
  RECORD_LISTS[view]?.apply();
  if (view === "platforms") applyBannerFilters();
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
    exportScheduleCsv();
  });

  document.getElementById("headerMenuResetData")?.addEventListener("click", async () => {
    closeHeaderMenu();
    if (!confirm("Permanently delete every campaign, trade show, banner (with its image), and completed task? This cannot be undone.")) return;
    setAppLoading(true, "Clearing…");
    try {
      await clearAllData();
      switchAppView("home");
      refreshItemPane();
      refreshBannerViews();
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

/**
 * One row per task across every campaign and trade show — what it belongs
 * to, when it's due, and whether it's done. An item with no tasks still
 * gets a row, so nothing scheduled goes missing from the export.
 */
function exportScheduleCsv() {
  const items = getAllScheduleItems().sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!items.length) {
    showIndicator("Nothing to export", "error");
    return;
  }

  const header = ["Section", "Name", "Type", "Start", "End", "Task", "Due", "Done", "Notes"];
  const lines = [header.map(csvCell).join(",")];

  items.forEach(item => {
    const base = [
      item.type === ITEM_TYPE_CAMPAIGN ? "Campaign" : "Trade Show",
      item.title,
      item.type === ITEM_TYPE_CAMPAIGN ? getCampaignTypeLabel(item.record.type) : getTradeShowLabel(item.record.show),
      item.startDate,
      item.endDate,
    ];
    const tasks = item.tasks.length ? item.tasks : [null];
    tasks.forEach(task => {
      lines.push([
        ...base,
        task?.label ?? "",
        task?.dueDate ?? "",
        task ? (isTaskComplete(task.id) ? "Yes" : "No") : "",
        item.record.notes,
      ].map(csvCell).join(","));
    });
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mioumuse-schedule-${todayYmd()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showIndicator(`Exported ${items.length} campaigns and shows`, "success");
}

// ── Nav ──────────────────────────────────────────────────────────────────────

function initAppNav() {
  document.getElementById("navTabCampaigns")?.addEventListener("click", () => switchAppView("campaigns"));
  document.getElementById("navTabTradeShows")?.addEventListener("click", () => switchAppView("tradeShows"));
  document.getElementById("navTabPlatforms")?.addEventListener("click", () => switchAppView("platforms"));
  document.getElementById("navLogoHome")?.addEventListener("click", () => switchAppView("home"));
  document.getElementById("appBackBtn")?.addEventListener("click", () => goBackAppView("home"));

  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    setAppLoading(true, "Refreshing…");
    try {
      await loadAppData();
      syncMailchimp();
      // Re-render from the fresh data. A record in the pane that was deleted
      // elsewhere closes the pane.
      switchAppView(getCurrentAppView());
      refreshItemPane();
      refreshBannerViews();
      showIndicator("Refreshed", "success");
    } catch (err) {
      showIndicator(err.message || "Could not refresh.", "error");
    } finally {
      setAppLoading(false);
    }
  });

  document.getElementById("saveIndicatorDismiss")?.addEventListener("click", clearIndicator);
}
