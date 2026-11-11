/**
 * The page's search box sits in the app header, centred. Each page keeps its
 * own box in its toolbar's markup (so the page code finds it by id as
 * before); this moves them into the header and shows the one whose toolbar
 * is showing. A box with a keyword in it is highlighted.
 */

function headerSearchWraps() {
  return [...document.querySelectorAll("#headerSearch .toolbar-search-wrap")];
}

/** The input actually showing in a box (Need to Shoot / Shoots share one box). */
function visibleSearchInput(wrap) {
  return [...wrap.querySelectorAll('input[type="search"]')].find(i => !i.hidden) ?? null;
}

/** Highlight each box with a keyword; call after setting a search box's value from code. */
function syncHeaderSearch() {
  headerSearchWraps().forEach(wrap => {
    // Only on a change: setting it fires the observers below again.
    const hidden = Boolean(wrap._toolbar?.hidden);
    if (wrap.hidden !== hidden) wrap.hidden = hidden;
    const input = visibleSearchInput(wrap);
    wrap.classList.toggle("is-searching", Boolean(input?.value.trim()));
  });
}

function initHeaderSearch() {
  const slot = document.getElementById("headerSearch");
  if (!slot) return;
  document.querySelectorAll(".toolbar .toolbar-search-wrap").forEach(wrap => {
    wrap._toolbar = wrap.closest(".toolbar");
    slot.appendChild(wrap);
    // The page shows or hides its toolbar; the box follows.
    new MutationObserver(syncHeaderSearch).observe(wrap._toolbar, { attributes: true, attributeFilter: ["hidden"] });
    // Need to Shoot / Shoots swap inputs inside one box.
    new MutationObserver(syncHeaderSearch).observe(wrap, { attributes: true, attributeFilter: ["hidden"], subtree: true });
  });
  slot.addEventListener("input", syncHeaderSearch);
  slot.addEventListener("search", syncHeaderSearch);
  syncHeaderSearch();
}
