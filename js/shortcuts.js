/**
 * Keyboard shortcuts on the table pages.
 *
 *   ← / →    the previous / next page — Magento's Products, Orders and
 *            Customers (the footer's pager); on Styles, → shows the next
 *            batch ("Show more"). Tables that fit on one page ignore them.
 *   Space    the page's search box; text already in it is selected, to
 *            type over or edit.
 *
 * They stand aside while you're typing (a text box, dropdown or checkbox),
 * while a window, filter or menu is open, and when Ctrl / Alt / Shift / Cmd
 * is held. Space on a button reached with Tab still presses it; on one just
 * clicked, it goes to the search box instead of clicking it again.
 */

/** Each page's search box(es) — the first one showing is used. */
const SHORTCUT_SEARCH = {
  campaigns: ["campaignSearchInput"],
  tradeShows: ["tradeShowSearchInput"],
  platforms: ["bannerSearchInput"],
  styles: ["styleSearchInput"],
  photoshoots: ["shootSearchInput"],
  needToShoot: ["needSearchInput"],
  magento: ["mgSearchInput"],
};

function isShowing(el) {
  return Boolean(el && !el.hidden && el.offsetParent !== null);
}

/** Something has the keyboard that the shortcuts mustn't take from. */
function shortcutsBlocked(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return true;
  const t = e.target;
  if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return true;
  if (document.querySelector(".modal-backdrop.open")) return true;
  // Popovers and menus are shown by dropping [hidden] (some are position:
  // fixed, which offsetParent can't see), so that's what's checked.
  const open = el => Boolean(el && !el.hidden);
  if (open(document.getElementById("columnFilterPopover"))) return true;
  if (document.getElementById("copyMenu")) return true;
  if ([...document.querySelectorAll(".header-menu-dropdown")].some(open)) return true;
  return false;
}

function focusPageSearch() {
  const ids = SHORTCUT_SEARCH[getCurrentAppView()] ?? [];
  const input = ids.map(id => document.getElementById(id)).find(isShowing);
  if (!input) return false;
  input.focus();
  // Text already there: selected, so typing replaces it.
  if (input.value) input.select();
  return true;
}

/** The pager's Next / Prev (Magento), or Styles' "Show more"; false when there's none to press. */
function turnPage(direction) {
  const view = getCurrentAppView();
  if (view === "magento") {
    const pager = document.getElementById("mgPager");
    if (!isShowing(pager)) return false;
    const btn = pager.querySelector(`button[title="${direction < 0 ? "Previous page" : "Next page"}"]`);
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }
  if (view === "styles" && direction > 0) {
    const more = document.querySelector("#stylesTableBody .style-more-row button");
    if (!more) return false;
    more.click();
    return true;
  }
  return false;
}

function initShortcuts() {
  document.addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== " ") return;
    if (shortcutsBlocked(e)) return;

    if (e.key === " ") {
      // A button reached with Tab keeps Space; one just clicked doesn't.
      if (e.target?.tagName === "BUTTON" && e.target.matches(":focus-visible")) return;
      if (focusPageSearch()) e.preventDefault();
      return;
    }
    if (turnPage(e.key === "ArrowLeft" ? -1 : 1)) e.preventDefault();
  });
}
