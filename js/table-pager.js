/**
 * Paging for tables drawn from data already in the browser (Styles, Need to
 * Shoot): the same footer bar as Magento's — "1–100 of 2,345", First / Prev /
 * Page n of m / Next / Last, and a per-page size, remembered per table.
 */

const TABLE_PAGE_SIZES = [50, 100, 200, 500];
const TABLE_PAGE_SIZE_DEFAULT = 100;

function readTablePageSize(tableId) {
  try {
    const n = Number(localStorage.getItem(scopedStorageKey(`pageSize.${tableId}`)));
    if (TABLE_PAGE_SIZES.includes(n)) return n;
  } catch {
    /* falls back to the default */
  }
  return TABLE_PAGE_SIZE_DEFAULT;
}

function saveTablePageSize(tableId, size) {
  try {
    localStorage.setItem(scopedStorageKey(`pageSize.${tableId}`), String(size));
  } catch {
    /* only lasts this visit */
  }
}

/** The page to show: `page` kept within 1 … the last page for `total` rows. */
function clampTablePage(page, total, pageSize) {
  return Math.min(Math.max(page, 1), Math.max(Math.ceil(total / pageSize), 1));
}

/**
 * Draw the pager into `pagerId`. `onPage(n)` and `onPageSize(n)` redraw the
 * table; nothing shows when there are no rows.
 */
function renderTablePager(pagerId, { total, page, pageSize, noun, onPage, onPageSize }) {
  const pager = document.getElementById(pagerId);
  if (!pager) return;
  if (!total) {
    pager.replaceChildren();
    return;
  }
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const info = document.createElement("span");
  info.className = "mg-pager-info";
  info.textContent = `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`;

  // Titles match Magento's, so the keyboard shortcuts find them.
  const btn = (label, target, disabled, title) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = label;
    b.title = title;
    b.disabled = disabled;
    b.addEventListener("click", () => onPage(target));
    return b;
  };

  const pageLabel = document.createElement("span");
  pageLabel.className = "mg-pager-page";
  pageLabel.textContent = `Page ${page.toLocaleString()} of ${pages.toLocaleString()}`;

  const size = document.createElement("select");
  size.className = "form-input mg-pager-size";
  size.setAttribute("aria-label", `${noun} per page`);
  TABLE_PAGE_SIZES.forEach(n => size.appendChild(new Option(`${n} per page`, n)));
  size.value = String(pageSize);
  size.addEventListener("change", () => onPageSize(Number(size.value)));

  pager.replaceChildren(
    info,
    btn("« First", 1, page <= 1, "First page"),
    btn("‹ Prev", page - 1, page <= 1, "Previous page"),
    pageLabel,
    btn("Next ›", page + 1, page >= pages, "Next page"),
    btn("Last »", pages, page >= pages, "Last page"),
    size,
  );
}
