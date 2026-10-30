/**
 * View switching and the header menu.
 *
 * Views: "home" (calendar + upcoming tasks), "campaigns" and "tradeShows"
 * (lists), "platforms" (banners), "styles" (the style database),
 * "photoshoots" (the shoots), "needToShoot" (styles waiting for one), and "magento" (the store's
 * products and categories, live). A record opens in a side pane over
 * whichever view is showing (js/item-pane.js, js/banners.js,
 * js/photoshoots.js, js/magento.js), not as a view of its own.
 */

const APP_VIEWS = ["home", "campaigns", "tradeShows", "platforms", "styles", "photoshoots", "needToShoot", "magento"];

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
  // An unsaved Magento edit isn't dropped without asking.
  if (currentAppView !== view && !closeMagentoPane({ force: false })) return;

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
    closeShootPane();
    closeMgSalesPane();
  }
  currentAppView = view;

  const panes = {
    campaignsToolbar: view === "campaigns",
    campaignsTableWrap: view === "campaigns",
    tradeShowsToolbar: view === "tradeShows",
    tradeShowsTableWrap: view === "tradeShows",
    platformsToolbar: view === "platforms",
    bannersTableWrap: view === "platforms",
    stylesToolbar: view === "styles",
    stylesTableWrap: view === "styles",
    photoshootsToolbar: isPhotoshootView(view),
    magentoToolbar: view === "magento",
    calendarWrap: view === "home",
  };
  Object.entries(panes).forEach(([id, visible]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible;
  });

  syncAppNav();

  // The grid needs real layout to size its rows, so render on entry.
  if (view === "home") renderCalendar();
  RECORD_LISTS[view]?.apply();
  if (view === "platforms") applyBannerFilters();
  if (view === "styles") applyStyleFilters();
  if (isPhotoshootView(view)) renderPhotoshootsView();
  if (view === "magento") enterMagentoView();
  // The photoshoot and Magento tables show and hide with their page, but
  // none of them belongs anywhere else.
  if (!isPhotoshootView(view)) {
    document.getElementById("needTableWrap").hidden = true;
    document.getElementById("shootsTableWrap").hidden = true;
  }
  if (view !== "magento") {
    document.getElementById("mgProductsWrap").hidden = true;
    document.getElementById("mgCategoriesWrap").hidden = true;
    document.getElementById("mgOrdersWrap").hidden = true;
    document.getElementById("mgCustomersWrap").hidden = true;
    document.getElementById("mgPager").hidden = true; // in the app footer
  }
  updateAppBackButton();
}

// ── Header menus ─────────────────────────────────────────────────────────────
//
// Home, then three menus — Marketing (Campaigns, Trade Shows, Platforms),
// Photoshoots (Photoshoots, Need to Shoot, Styles), Magento (Products, Categories). Each
// opens on hover or focus; the page you're on is ticked, and its menu is
// underlined.

/** Tick the page you're on, and underline its menu. */
function syncAppNav() {
  const home = document.getElementById("navLogoHome");
  if (home) {
    home.classList.toggle("is-active", currentAppView === "home");
    home.setAttribute("aria-selected", currentAppView === "home" ? "true" : "false");
  }
  document.querySelectorAll(".app-title-tab-dropdown-item[data-view]").forEach(item => {
    const active = item.dataset.view === currentAppView
      && (!item.dataset.subview || item.dataset.subview === mgSubview);
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  document.querySelectorAll(".app-title-tab-dropdown-wrap").forEach(wrap => {
    const active = Boolean(wrap.querySelector(".app-title-tab-dropdown-item.active"));
    wrap.querySelector(".app-title-tab--dropdown-trigger")?.classList.toggle("is-active", active);
  });
}

function initNavMenus() {
  document.querySelectorAll(".app-title-tab-dropdown-wrap").forEach(wrap => {
    // After a choice the menu stays shut until the pointer leaves it.
    wrap.addEventListener("mouseleave", () => wrap.classList.remove("is-dropdown-closed"));
    wrap.querySelectorAll(".app-title-tab-dropdown-item[data-view]").forEach(item => {
      item.addEventListener("click", () => {
        wrap.classList.add("is-dropdown-closed");
        item.blur();
        if (item.dataset.subview) showMagentoSubview(item.dataset.subview);
        else switchAppView(item.dataset.view);
      });
    });
    // Focusing the menu again (keyboard, a tap) reopens it.
    wrap.querySelector(".app-title-tab--dropdown-trigger")?.addEventListener("focus", () => wrap.classList.remove("is-dropdown-closed"));
  });
}

// ── Header menu ──────────────────────────────────────────────────────────────

function closeHeaderMenu() {
  const dropdown = document.getElementById("headerMenuDropdown");
  const btn = document.getElementById("headerMenuBtn");
  if (dropdown) dropdown.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

/** The page the menu is for: a view, or Magento's "magento:products" and the like. */
function currentMenuPage() {
  const view = getCurrentAppView();
  return view === "magento" ? `magento:${mgSubview}` : view;
}

/**
 * Fit the menu to the page it's opened on. An item with data-pages shows only
 * on those pages; Sign Out is always there. The image folder's items also
 * depend on the folder's state.
 */
function syncHeaderMenu() {
  const page = currentMenuPage();
  const items = [...document.querySelectorAll("#headerMenuDropdown .header-menu-item[data-pages]")];
  items.forEach(item => {
    item.hidden = !item.dataset.pages.split(" ").includes(page);
  });

  // The image folder's one action depends on its state (js/style-images.js).
  const folder = document.getElementById("headerMenuStyleFolder");
  const unlink = document.getElementById("headerMenuStyleFolderUnlink");
  if (page === "styles" && folder && unlink) {
    const { label, canUnlink } = getStyleImageMenuState();
    folder.hidden = !label;
    if (label) folder.querySelector("span").textContent = label;
    unlink.hidden = !canUnlink;
  }

  // Sign Out's divider only when something sits above it.
  document.getElementById("headerMenuSignOut")?.classList.toggle("header-menu-item-separator", items.some(item => !item.hidden));
}

function initHeaderMenu() {
  const btn = document.getElementById("headerMenuBtn");
  const dropdown = document.getElementById("headerMenuDropdown");
  if (!btn || !dropdown) return;

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const open = dropdown.hidden;
    if (open) syncHeaderMenu();
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
    exportCurrentViewCsv(); // js/exports.js — follows the page you're on
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
 * One row per task across the page's campaigns or trade shows — what it
 * belongs to, when it's due, and whether it's done. An item with no tasks
 * still gets a row, so nothing scheduled goes missing from the export.
 */
function exportScheduleCsv(type) {
  const items = getAllScheduleItems()
    .filter(item => item.type === type)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
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
  const noun = type === ITEM_TYPE_CAMPAIGN ? "campaigns" : "trade-shows";
  a.download = `mioumuse-${noun}-${todayYmd()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showIndicator(`Exported ${items.length} ${type === ITEM_TYPE_CAMPAIGN ? "campaigns" : "trade shows"}`, "success");
}

// ── Nav ──────────────────────────────────────────────────────────────────────

function initAppNav() {
  initNavMenus();
  document.getElementById("navLogoHome")?.addEventListener("click", () => switchAppView("home"));
  document.getElementById("appBackBtn")?.addEventListener("click", () => goBackAppView("home"));

  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    setAppLoading(true, "Refreshing…");
    try {
      await loadAppData();
      // A view saved on another computer since this one loaded.
      await syncTableViewsFromAccount();
      syncMailchimp();
      // Re-render from the fresh data. A record in the pane that was deleted
      // elsewhere closes the pane.
      switchAppView(getCurrentAppView());
      refreshItemPane();
      refreshBannerViews();
      refreshPhotoshootViews();
      // Magento isn't part of the app's data; it's asked again only when showing.
      if (getCurrentAppView() === "magento") await reloadMagento();
      showIndicator("Refreshed", "success");
    } catch (err) {
      showIndicator(err.message || "Could not refresh.", "error");
    } finally {
      setAppLoading(false);
    }
  });

  document.getElementById("saveIndicatorDismiss")?.addEventListener("click", clearIndicator);
}
