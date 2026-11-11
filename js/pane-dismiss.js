/**
 * Side panes, app-wide (every .item-pane: campaigns and shows, banners,
 * shoots, styles, Magento products, orders and customers).
 *
 *   Click outside   closes the open pane, through its own ✕ (so a Magento
 *                   product with unsaved changes still asks first). A click
 *                   that opens a pane, or one on a table row, a menu, a
 *                   dialog or a scrollbar, leaves it be.
 *   Closing         slides and fades out, rather than vanishing.
 *
 * The animation is a stand-in: the pane itself hides at once as before (so
 * nothing that checks it waits), and a copy of it fades out in its place.
 */

/** Clicks here never close a pane: they open one, or sit over the page. */
const PANE_KEEP_OPEN = [
  ".item-pane",
  "tbody tr",
  ".modal-backdrop",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
  ".header-menu-dropdown",
  ".column-filter-popover",
  ".shoot-picker",
  ".cell-date-picker",
  ".cal-filter-menu",
  "#shootMenu",
  ".dashboard-day-pane",
].join(", ");

const PANE_CLOSE_MS = 170;

/** The side panes showing, apart from one docked into its page. */
function openSidePanes() {
  return [...document.querySelectorAll(".item-pane:not([hidden]):not(.is-docked)")]
    .filter(pane => !pane.classList.contains("is-pane-ghost"));
}

/** Which pane, showing what — to tell a click that opened something. */
const paneKey = pane => `${pane.id}|${pane.querySelector(".item-pane-title")?.textContent ?? ""}`;

/** A press on a scroll bar lands on the scrolling box itself. */
function isScrollbarPress(e) {
  const el = e.target;
  if (!(el instanceof Element) || e.offsetX === undefined) return false;
  return (el.clientWidth && e.offsetX > el.clientWidth) || (el.clientHeight && e.offsetY > el.clientHeight);
}

function keepsPaneOpen(target) {
  return !(target instanceof Element) || !target.isConnected || Boolean(target.closest(PANE_KEEP_OPEN));
}

let paneDismissPress = null; // { keep, before }

function onPaneDismissPointerDown(e) {
  if (e.button !== 0) { paneDismissPress = null; return; }
  const before = openSidePanes();
  paneDismissPress = before.length
    ? { keep: keepsPaneOpen(e.target) || isScrollbarPress(e), before: new Set(before.map(paneKey)) }
    : null;
}

function onPaneDismissClick(e) {
  const press = paneDismissPress;
  paneDismissPress = null;
  if (!press || press.keep || keepsPaneOpen(e.target)) return;
  if (document.querySelector(".modal-backdrop.open")) return;
  // The click opened a pane (or another item in one): leave it showing.
  const now = openSidePanes();
  if (now.some(pane => !press.before.has(paneKey(pane)))) return;
  now.forEach(pane => pane.querySelector(".item-pane-close")?.click());
}

// ── Closing animation ────────────────────────────────────────────────────────

/** A copy of the pane where it was, fading out; gone when it's done. */
function playPaneClose(pane) {
  if (pane.classList.contains("is-docked")) return;
  // Swapping one pane for another: the new one shows at once instead.
  if (openSidePanes().length) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const ghost = pane.cloneNode(true);
  ghost.hidden = false;
  ghost.inert = true;
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.add("is-pane-ghost");
  // The copy keeps the pane's look (some styles use its ids) but not its ids.
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
  ghost.style.animationDuration = `${PANE_CLOSE_MS}ms`;
  pane.after(ghost);

  // Where it was scrolled to, so the copy doesn't jump to the top.
  const from = pane.querySelectorAll(".item-pane-body");
  ghost.querySelectorAll(".item-pane-body").forEach((el, i) => { el.scrollTop = from[i]?.dataset.lastScroll ?? 0; });

  const done = () => ghost.remove();
  ghost.addEventListener("animationend", done, { once: true });
  setTimeout(done, PANE_CLOSE_MS + 80);
}

function initPaneDismiss() {
  document.addEventListener("pointerdown", onPaneDismissPointerDown, true);
  document.addEventListener("click", onPaneDismissClick);

  // Remember each pane's scroll, since a hidden pane reads as scrolled to 0.
  document.querySelectorAll(".item-pane .item-pane-body").forEach(body => {
    body.addEventListener("scroll", () => { body.dataset.lastScroll = String(body.scrollTop); }, { passive: true });
  });

  const watcher = new MutationObserver(records => {
    records.forEach(({ target, oldValue }) => {
      // Just hidden (it wasn't before, and still is now the handlers are done).
      if (oldValue === null && target.hidden) playPaneClose(target);
    });
  });
  document.querySelectorAll(".item-pane").forEach(pane => {
    watcher.observe(pane, { attributes: true, attributeFilter: ["hidden"], attributeOldValue: true });
  });
}
