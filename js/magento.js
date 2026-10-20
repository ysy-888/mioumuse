/**
 * Magento — the store's catalog, read and edited live.
 *
 * Nothing here is kept in Supabase: every list comes straight from Magento
 * through the `magento` Edge Function (supabase/functions/magento), which
 * holds the store's token. A catalog can run to tens of thousands of
 * products, so Magento does the filtering, sorting and paging; the app asks
 * for one page at a time.
 *
 * Two sub-views:
 *   Products   — filter by status, category, type and visibility from the
 *                column headers' funnels (js/column-filter.js — several
 *                values at once); search SKU or name; sort by a column
 *                header's label; flip Status right in
 *                the table; tick rows to enable / disable / add to or remove
 *                from a category in one go; click a row to edit it in the pane.
 *   Categories — the category tree, with product counts; rename, switch
 *                active on or off, or jump to its products.
 */

const MG_FUNCTION = "magento";
const MG_PAGE_SIZES = [25, 50, 100, 200];

const MG_STATUS = { 1: "Enabled", 2: "Disabled" };
const MG_VISIBILITY = { 1: "Not visible individually", 2: "Catalog", 3: "Search", 4: "Catalog, Search" };
const MG_TYPES = {
  simple: "Simple",
  configurable: "Configurable",
  virtual: "Virtual",
  bundle: "Bundle",
  grouped: "Grouped",
  downloadable: "Downloadable",
};

/** Columns the header sorts by (Magento's names live in the Edge Function). */
const MG_SORTABLE = new Set(["name", "sku", "type", "price", "status", "visibility", "updatedAt"]);

let mgSubview = "products";
let mgLoadedOnce = false;
/** null until asked; then { connected, mediaUrl, currency, … } or { error }. */
let mgStore = null;
let mgCategories = [];
let mgCategoryById = new Map();
/** Color's choices [{ value, label }] — the option id is what's saved. */
let mgColorOptions = [];
/** Product counts per value, { status: { "1": n }, type: {…}, visibility: {…} } — null if unknown. */
let mgFacets = null;

/**
 * What's asked of Magento. status / type / visibility / categoryId are the
 * header filters' ticked keys: null = not filtered, [] = nothing ticked.
 */
/** Products open sorted by name, A–Z. */
const MG_DEFAULT_SORT = { sort: "name", dir: "ASC" };

let mgQuery = { page: 1, pageSize: 50, ...MG_DEFAULT_SORT, search: "", status: null, type: null, visibility: null, categoryId: null };

/** The header filters, by column, and the mgQuery field each one sets. */
const MG_HEADER_FILTERS = { status: "status", type: "type", visibility: "visibility", categories: "categoryId" };
let mgPage = { items: [], total: 0 };
let mgLoading = false;
let mgError = "";
/** Each request gets a number; an answer to an older one is ignored. */
let mgRequestSeq = 0;

/** Ticked products, by SKU. Kept across pages so a selection can span several. */
let mgSelected = new Set();

/** The product in the pane: what Magento has (`saved`) and the edit in progress (`draft`). */
let mgPane = null;

async function callMagento(action, params = {}) {
  if (!supabaseClient) throw new Error("Supabase isn't configured.");
  const { data, error } = await supabaseClient.functions.invoke(MG_FUNCTION, {
    body: { action, ...params },
  });
  if (error) {
    // The function's own message, when it sent one.
    let message = error.message || "Couldn't reach Magento.";
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      /* keep the generic message */
    }
    if (/Failed to send a request|not found/i.test(message) && !/Magento/.test(message)) {
      message = "The Magento helper isn't set up yet — deploy the magento Edge Function.";
    }
    const err = new Error(message);
    err.status = error.context?.status;
    throw err;
  }
  return data?.data;
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatMgPrice(value) {
  if (value === null || value === undefined || value === "") return EMPTY_DISPLAY;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: mgStore?.currency || "USD" }).format(Number(value));
  } catch {
    return Number(value).toFixed(2);
  }
}

function formatMgQty(product) {
  if (product.qty === null) return EMPTY_DISPLAY;
  const n = Number.isInteger(product.qty) ? product.qty : product.qty.toFixed(2);
  return product.inStock === false ? `${n} · out` : String(n);
}

/** Magento's "2026-10-20 14:03:11" (UTC) as MM/DD/YY. */
function formatMgDate(value) {
  if (!value) return EMPTY_DISPLAY;
  return formatMdy(String(value).slice(0, 10));
}

function getMgImageUrl(product) {
  if (!product.image || product.image === "no_selection" || !mgStore?.mediaUrl) return "";
  return `${mgStore.mediaUrl}${product.image.startsWith("/") ? "" : "/"}${product.image}`;
}

function getMgCategoryName(id) {
  return mgCategoryById.get(String(id))?.name ?? `#${id}`;
}

function getMgCategoryPath(id) {
  return mgCategoryById.get(String(id))?.path ?? `Category #${id}`;
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** Store info and categories — needed by every list, loaded once per visit. */
async function loadMagentoBasics() {
  try {
    mgStore = await callMagento("status");
  } catch (err) {
    mgStore = { error: err.message || "Couldn't reach Magento." };
  }
  renderMgConnection();
  if (mgStore.error) return false;
  try {
    mgCategories = await callMagento("categories");
  } catch (err) {
    showIndicator(err.message || "Couldn't load Magento categories.", "error");
    mgCategories = [];
  }
  mgCategoryById = new Map(mgCategories.map(c => [c.id, c]));
  renderMgCategoryControls();
  // What exists, for the header filters; Color's choices for the pane; and
  // the groups imported from Magento's export (js/magento-groups.js).
  const [facets, colors] = await Promise.all([
    callMagento("facets").catch(() => null),
    callMagento("colorOptions").catch(err => ({ options: [], problem: err.message })),
    loadMagentoGroups(),
  ]);
  mgFacets = facets ?? null;
  mgColorOptions = colors?.options ?? [];
  renderMgColorOptions();
  // No names means the Color column would show option numbers — say why.
  if (colors?.problem) showIndicator(colors.problem, "error");
  return true;
}

function renderMgColorOptions() {
  const select = document.getElementById("mgPaneColor");
  select?.replaceChildren(new Option("No color", ""), ...mgColorOptions.map(o => new Option(o.label, o.value)));
  const field = document.getElementById("mgPaneColorField");
  if (field) field.hidden = mgColorOptions.length === 0;
}

async function loadMagentoProducts() {
  if (mgStore?.error) return;
  const seq = ++mgRequestSeq;
  // A header filter with nothing ticked matches nothing — no need to ask.
  if (Object.values(MG_HEADER_FILTERS).some(field => mgQuery[field]?.length === 0)) {
    mgLoading = false;
    mgError = "";
    mgPage = { items: [], total: 0 };
    renderMgProducts();
    return;
  }
  mgLoading = true;
  mgError = "";
  renderMgProducts();
  try {
    const page = await callMagento("products", mgQuery);
    if (seq !== mgRequestSeq) return;
    page.items.forEach(applyMgGroups);
    mgPage = page;
  } catch (err) {
    if (seq !== mgRequestSeq) return;
    mgError = err.message || "Couldn't load products.";
    mgPage = { items: [], total: 0 };
  }
  mgLoading = false;
  renderMgProducts();
}

/** First visit loads everything; later visits keep what's on screen. */
async function enterMagentoView() {
  renderMagentoSubview();
  if (mgLoadedOnce) return;
  mgLoadedOnce = true;
  await reloadMagento();
}

/** Everything again — the header's Refresh button, and after bulk changes. */
async function reloadMagento() {
  mgLoading = true;
  renderMgProducts();
  renderMgCategoriesTable();
  const ok = await loadMagentoBasics();
  if (!ok) {
    mgLoading = false;
    renderMgProducts();
    renderMgCategoriesTable();
    return;
  }
  renderMgCategoriesTable();
  await loadMagentoProducts();
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function renderMgConnection() {
  const el = document.getElementById("mgConnection");
  if (!el) return;
  el.replaceChildren();
  el.classList.toggle("is-error", Boolean(mgStore?.error));
  if (!mgStore) return;
  if (mgStore.error) {
    el.textContent = "Not connected";
    el.title = mgStore.error;
    return;
  }
  const link = document.createElement("a");
  link.href = mgStore.baseUrl || mgStore.adminUrl;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = (mgStore.baseUrl || mgStore.adminUrl || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  link.title = "Open the store";
  el.appendChild(link);
}

/** "Women / Tops / Tees" options, indented by depth. */
function mgCategoryOptions() {
  return mgCategories.map(c => {
    const option = new Option(`${"  ".repeat(Math.max(c.level - 1, 0))}${c.name}`, c.id);
    option.title = c.path;
    return option;
  });
}

function renderMgCategoryControls() {
  const add = document.getElementById("mgBulkAddCategory");
  if (add) add.replaceChildren(new Option("Add to category…", ""), ...mgCategoryOptions());
  const remove = document.getElementById("mgBulkRemoveCategory");
  if (remove) remove.replaceChildren(new Option("Remove from category…", ""), ...mgCategoryOptions());
}

/**
 * The toolbar's quick filters mirror the header filters: All / Enabled /
 * Disabled the Status one, All / Grouped / Simple the Type one.
 */
function syncMgFilterButtons() {
  // A button is lit when its filter holds exactly its value; "All" when unfiltered.
  const sync = (selector, attr, selected) => {
    document.querySelectorAll(`${selector} .filter-btn`).forEach(btn => {
      const key = btn.dataset[attr];
      btn.classList.toggle("active", key ? selected?.length === 1 && selected[0] === key : selected === null);
    });
  };
  sync("#mgStatusFilters", "status", mgQuery.status);
  sync("#mgTypeFilters", "type", mgQuery.type);
  document.querySelectorAll("#mgSubtabs .filter-btn").forEach(btn => {
    const active = btn.dataset.view === mgSubview;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function renderMagentoSubview() {
  const products = mgSubview === "products";
  const show = { mgProductControls: products, mgCategoryControls: !products, mgProductsWrap: products, mgCategoriesWrap: !products, mgPager: products };
  Object.entries(show).forEach(([id, visible]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible;
  });
  const search = document.getElementById("mgSearchInput");
  if (search) {
    search.placeholder = products ? "Search SKU or name" : "Search categories";
    search.value = products ? mgQuery.search : mgCategorySearch;
  }
  if (!products) closeMagentoPane();
  syncMgFilterButtons();
  updateMgCounter();
}

function updateMgCounter() {
  const counter = document.getElementById("mgRowCounter");
  if (!counter) return;
  if (mgSubview === "categories") {
    const n = visibleMgCategories().length;
    counter.textContent = n === 1 ? "1 category" : `${n.toLocaleString()} categories`;
  } else if (mgLoading && !mgPage.items.length) {
    counter.textContent = "— products";
  } else {
    const n = mgPage.total;
    counter.textContent = n === 1 ? "1 product" : `${n.toLocaleString()} products`;
  }
}

/** Any filter change starts again from page 1. */
function setMgQuery(changes) {
  mgQuery = { ...mgQuery, ...changes, page: changes.page ?? 1 };
  syncMgFilterButtons();
  loadMagentoProducts();
}

/** Ask Magento again with whatever the header filters now hold. */
function applyMgHeaderFilters() {
  const changes = {};
  Object.entries(MG_HEADER_FILTERS).forEach(([col, field]) => {
    changes[field] = getColumnFilterSelection("mgProductsTable", col);
  });
  setMgQuery(changes);
}

/** Set header filters from code — `{ status: ["1"], categories: null }` — then reload. */
function setMgHeaderFilters(selections) {
  Object.entries(selections).forEach(([col, keys]) => setColumnFilterSelection("mgProductsTable", col, keys));
  applyMgHeaderFilters();
}

/**
 * The choices in each header filter — only values some product actually
 * has, with how many. Counts come from Magento (facets, categories). Should
 * the counts be unavailable, every value is offered rather than none.
 */
function mgHeaderFilterOptions(col) {
  const fromMap = (map, counts) => Object.entries(map)
    .map(([key, label]) => ({ key, label, count: counts ? counts[key] ?? 0 : null }))
    .filter(o => o.count === null || o.count > 0);
  if (col === "status") return fromMap(MG_STATUS, mgFacets?.status);
  if (col === "type") return fromMap(MG_TYPES, mgFacets?.type);
  if (col === "visibility") return fromMap(MG_VISIBILITY, mgFacets?.visibility);
  return mgCategories.filter(c => c.productCount > 0).map(c => ({
    key: c.id,
    label: `${"   ".repeat(Math.max(c.level - 1, 0))}${c.name}${c.isActive ? "" : " (inactive)"}`,
    count: c.productCount,
  }));
}

// ── Products table ───────────────────────────────────────────────────────────

function createMgStatusSwitch(product) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mg-status-switch";
  const paint = () => {
    const on = product.status === 1;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.innerHTML = `<span class="mg-switch-track" aria-hidden="true"><span class="mg-switch-knob"></span></span><span class="mg-switch-label">${on ? "Enabled" : "Disabled"}</span>`;
    btn.title = on ? "Enabled — click to disable" : "Disabled — click to enable";
  };
  paint();
  btn.addEventListener("click", async () => {
    const next = product.status === 1 ? 2 : 1;
    btn.disabled = true;
    btn.classList.add("is-saving");
    try {
      const saved = await callMagento("update", { sku: product.sku, changes: { status: next } });
      Object.assign(product, pickMgSummary(applyMgGroups(saved)));
      paint();
      btn.closest("tr")?.classList.toggle("mg-row-disabled", product.status !== 1);
      if (mgPane?.saved.sku === product.sku) {
        mgPane.saved.status = saved.status;
        mgPane.draft.status = saved.status;
        renderMagentoPane();
      }
      showIndicator(`${product.sku} ${next === 1 ? "enabled" : "disabled"}`, "success");
    } catch (err) {
      showIndicator(err.message || "Couldn't change the status.", "error");
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-saving");
    }
  });
  return btn;
}

/** The list's fields out of a full product, to update a row in place. */
function pickMgSummary(p) {
  const { id, sku, name, type, color, colorId, childSkus, groupSource, groupSku, unlinkedGroup, price, specialPrice, status, visibility, categoryIds, qty, inStock, image, urlKey, createdAt, updatedAt } = p;
  return { id, sku, name, type, color, colorId, childSkus, groupSource, groupSku, unlinkedGroup, price, specialPrice, status, visibility, categoryIds, qty, inStock, image, urlKey, createdAt, updatedAt };
}

/**
 * The page's rows in display order, each with its part in a group:
 * "parent" (a Grouped item), "child" (one of its Simple items, placed right
 * under it), "last" (its final Simple item), or null. Only while Type isn't
 * filtered — with a Type filter on, the list is shown just as sorted. A
 * Simple item whose Grouped item is on another page stays where it sorts.
 */
function arrangeMgRows(items) {
  if (mgQuery.type !== null) return items.map(product => ({ product, role: null }));
  const bySku = new Map(items.map(p => [p.sku, p]));
  // Simple items that have their Grouped item on this page.
  const underParent = new Set();
  items.forEach(p => {
    if (p.type === "grouped") (p.childSkus ?? []).forEach(sku => { if (bySku.has(sku) && sku !== p.sku) underParent.add(sku); });
  });
  const rows = [];
  const placed = new Set();
  items.forEach(p => {
    if (placed.has(p.sku) || (underParent.has(p.sku) && p.type !== "grouped")) return;
    placed.add(p.sku);
    if (p.type !== "grouped") {
      rows.push({ product: p, role: null });
      return;
    }
    const children = (p.childSkus ?? []).filter(sku => bySku.has(sku) && !placed.has(sku)).map(sku => bySku.get(sku));
    rows.push({ product: p, role: children.length ? "parent" : "solo" });
    children.forEach((child, i) => {
      placed.add(child.sku);
      rows.push({ product: child, role: i === children.length - 1 ? "last" : "child" });
    });
  });
  return rows;
}

/**
 * Name, plus — for a Grouped item — how many Simple items it has; a Simple
 * item shown under its Grouped item gets a connector instead.
 */
function createMgNameCell(product, role) {
  const wrap = document.createElement("span");
  wrap.className = "mg-name-cell";
  if (role === "child" || role === "last") {
    const branch = document.createElement("span");
    branch.className = "mg-group-branch";
    branch.setAttribute("aria-hidden", "true");
    wrap.appendChild(branch);
  }
  const text = document.createElement("span");
  text.className = "mg-name-text";
  mountSearchHighlightedText(text, product.name);
  wrap.appendChild(text);
  if (product.type === "grouped") wrap.appendChild(createMgChildCount(product));
  if (product.unlinkedGroup) wrap.appendChild(createMgUnlinkedFlag(product));
  return wrap;
}

function createMgChildCount(product) {
  const n = product.childSkus?.length ?? 0;
  const badge = document.createElement("span");
  badge.className = "mg-child-count" + (n ? "" : " is-empty");
  badge.textContent = String(n);
  // The words and SKUs on hover — and, for a group the import doesn't have
  // yet, that disabled items may be missing (Magento's API leaves them out).
  const words = n === 1 ? "1 simple item" : `${n} simple items`;
  const note = product.groupSource === "api" ? "\n(From Magento's API — disabled items aren't listed. Import groups to see them.)" : "";
  badge.title = n ? `${words}:\n${product.childSkus.join("\n")}${note}` : `No simple items in this group${note}`;
  badge.setAttribute("aria-label", words);
  return badge;
}

/** A Simple item whose SKU matches a group it isn't in on Magento. */
function createMgUnlinkedFlag(product) {
  const flag = document.createElement("span");
  flag.className = "mg-unlinked-flag";
  flag.textContent = `Not in ${product.unlinkedGroup}`;
  flag.title = `This SKU matches group ${product.unlinkedGroup}, but it isn't in that group on Magento (as of the imported export).`;
  return flag;
}

/** The product type as a coloured label — each type its own colour (crm.css). */
function createMgTypePill(type) {
  const pill = document.createElement("span");
  pill.className = "mg-type-pill";
  pill.dataset.type = type;
  pill.textContent = MG_TYPES[type] ?? type ?? EMPTY_DISPLAY;
  return pill;
}

function createMgThumb(product) {
  const wrap = document.createElement("span");
  wrap.className = "mg-thumb";
  const url = getMgImageUrl(product);
  if (!url) {
    wrap.classList.add("is-empty");
    return wrap;
  }
  const img = document.createElement("img");
  img.src = url;
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => {
    wrap.classList.add("is-empty");
    img.remove();
  });
  wrap.appendChild(img);
  return wrap;
}

function createMgCategoryChips(product) {
  const wrap = document.createElement("span");
  wrap.className = "mg-cat-chips";
  const ids = product.categoryIds ?? [];
  if (!ids.length) {
    wrap.textContent = EMPTY_DISPLAY;
    wrap.classList.add("is-empty");
    return wrap;
  }
  // Every category, wrapping onto more lines when they don't fit.
  ids.forEach(id => {
    const chip = document.createElement("span");
    chip.className = "mg-cat-chip";
    chip.textContent = getMgCategoryName(id);
    chip.title = getMgCategoryPath(id);
    wrap.appendChild(chip);
  });
  return wrap;
}

function renderMgProducts() {
  updateMgCounter();
  renderMgPager();
  const tbody = document.getElementById("mgProductsBody");
  if (!tbody) return;
  const cols = [...document.querySelectorAll("#mgProductsTable thead th[data-col]")].map(th => th.dataset.col);
  const message = text => {
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(text)}</td></tr>`;
  };

  if (mgStore?.error) return message(mgStore.error);
  if (mgError) return message(mgError);
  if (mgLoading && !mgPage.items.length) return message("Loading products…");
  if (!mgPage.items.length) {
    const filtered = mgQuery.search || Object.values(MG_HEADER_FILTERS).some(field => mgQuery[field]);
    return message(filtered ? "No products match the current filters." : "No products in Magento yet.");
  }

  setActiveSearchQuery(mgQuery.search.toLowerCase());
  const rows = arrangeMgRows(mgPage.items).map(({ product, role }) => {
    const tr = document.createElement("tr");
    tr.className = "clickable-row";
    tr.dataset.sku = product.sku;
    if (mgPane?.saved.sku === product.sku) tr.classList.add("is-open");
    if (product.status !== 1) tr.classList.add("mg-row-disabled");
    if (role) tr.classList.add(`mg-group-${role}`);
    cols.forEach(col => {
      const td = document.createElement("td");
      td.dataset.col = col;
      if (col === "select") td.appendChild(createMgCheckbox(product));
      else if (col === "image") td.appendChild(createMgThumb(product));
      else if (col === "status") td.appendChild(createMgStatusSwitch(product));
      else if (col === "categories") td.appendChild(createMgCategoryChips(product));
      else if (col === "name") td.appendChild(createMgNameCell(product, role));
      else if (col === "color") mountSearchHighlightedText(td, product.color || EMPTY_DISPLAY);
      else if (col === "sku") {
        td.className = "mg-sku";
        mountSearchHighlightedText(td, product.sku);
      } else if (col === "type") td.appendChild(createMgTypePill(product.type));
      else if (col === "price") {
        td.className = "mg-num";
        td.textContent = formatMgPrice(product.price);
        if (product.specialPrice !== null) {
          const sp = document.createElement("span");
          sp.className = "mg-special-price";
          sp.textContent = formatMgPrice(product.specialPrice);
          sp.title = "Special price";
          td.append(" ", sp);
        }
      } else if (col === "qty") {
        td.className = "mg-num";
        td.textContent = formatMgQty(product);
        if (product.inStock === false) td.classList.add("mg-out-of-stock");
      } else if (col === "visibility") td.textContent = MG_VISIBILITY[product.visibility] ?? EMPTY_DISPLAY;
      else if (col === "updatedAt") td.textContent = formatMgDate(product.updatedAt);
      if (col === "name" && product.name) td.title = product.name;
      tr.appendChild(td);
    });
    return tr;
  });
  tbody.replaceChildren(...rows);
  tbody.closest("table")?.classList.toggle("is-loading", mgLoading);
  syncMgSelectionUi();
}

function renderMgPager() {
  const pager = document.getElementById("mgPager");
  if (!pager) return;
  const { total } = mgPage;
  const pages = Math.max(Math.ceil(total / mgQuery.pageSize), 1);
  if (!total) {
    pager.replaceChildren();
    return;
  }
  const from = (mgQuery.page - 1) * mgQuery.pageSize + 1;
  const to = Math.min(mgQuery.page * mgQuery.pageSize, total);

  const info = document.createElement("span");
  info.className = "mg-pager-info";
  info.textContent = `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`;

  const btn = (label, page, disabled, title) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = label;
    b.title = title;
    b.disabled = disabled || mgLoading;
    b.addEventListener("click", () => setMgQuery({ page }));
    return b;
  };

  const pageLabel = document.createElement("span");
  pageLabel.className = "mg-pager-page";
  pageLabel.textContent = `Page ${mgQuery.page.toLocaleString()} of ${pages.toLocaleString()}`;

  const size = document.createElement("select");
  size.className = "form-input mg-pager-size";
  size.setAttribute("aria-label", "Products per page");
  MG_PAGE_SIZES.forEach(n => size.appendChild(new Option(`${n} per page`, n)));
  size.value = String(mgQuery.pageSize);
  size.addEventListener("change", () => setMgQuery({ pageSize: Number(size.value) }));

  pager.replaceChildren(
    info,
    btn("« First", 1, mgQuery.page <= 1, "First page"),
    btn("‹ Prev", mgQuery.page - 1, mgQuery.page <= 1, "Previous page"),
    pageLabel,
    btn("Next ›", mgQuery.page + 1, mgQuery.page >= pages, "Next page"),
    btn("Last »", pages, mgQuery.page >= pages, "Last page"),
    size,
  );
}

/**
 * Cycle: ascending → descending → back to the default (Name, A–Z). Name
 * itself just flips between A–Z and Z–A.
 */
function sortMgProductsBy(col) {
  if (!MG_SORTABLE.has(col)) return;
  if (mgQuery.sort !== col) {
    mgQuery.sort = col;
    mgQuery.dir = "ASC";
  } else if (mgQuery.dir === "ASC") {
    mgQuery.dir = "DESC";
  } else if (col === MG_DEFAULT_SORT.sort) {
    mgQuery.dir = "ASC";
  } else {
    Object.assign(mgQuery, MG_DEFAULT_SORT);
  }
  syncMgSortHeaders();
  setMgQuery({});
}

function syncMgSortHeaders() {
  document.querySelectorAll("#mgProductsTable thead th[data-col]").forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.col === mgQuery.sort) th.classList.add(mgQuery.dir === "ASC" ? "sorted-asc" : "sorted-desc");
  });
}

// ── Selection and bulk changes ───────────────────────────────────────────────

function createMgCheckbox(product) {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "row-select";
  cb.checked = mgSelected.has(product.sku);
  cb.setAttribute("aria-label", `Select ${product.sku}`);
  cb.addEventListener("change", () => {
    if (cb.checked) mgSelected.add(product.sku); else mgSelected.delete(product.sku);
    syncMgSelectionUi();
  });
  return cb;
}

function syncMgSelectionUi() {
  const all = document.getElementById("mgSelectAll");
  if (all) {
    const onPage = mgPage.items.filter(p => mgSelected.has(p.sku)).length;
    all.checked = onPage > 0 && onPage === mgPage.items.length;
    all.indeterminate = onPage > 0 && onPage < mgPage.items.length;
  }
  const bar = document.getElementById("mgSelectionBar");
  if (bar) {
    bar.hidden = mgSelected.size === 0;
    const count = document.getElementById("mgSelectionCount");
    if (count) count.textContent = `${mgSelected.size.toLocaleString()} selected`;
  }
}

function clearMgSelection() {
  mgSelected = new Set();
  renderMgProducts();
}

const MG_BULK_LABELS = {
  enable: n => `Enable ${n}?`,
  disable: n => `Disable ${n}? They'll disappear from the store.`,
  addCategory: (n, cat) => `Add ${n} to "${cat}"?`,
  removeCategory: (n, cat) => `Remove ${n} from "${cat}"?`,
};

async function runMgBulk(op, categoryId = "") {
  const skus = [...mgSelected];
  if (!skus.length) return;
  const n = skus.length === 1 ? "1 product" : `${skus.length.toLocaleString()} products`;
  if (!confirm(MG_BULK_LABELS[op](n, categoryId ? getMgCategoryPath(categoryId) : ""))) return;

  setAppLoading(true, `Updating ${n} in Magento…`);
  try {
    // The Edge Function takes up to 500 at a time.
    const results = [];
    for (let i = 0; i < skus.length; i += 500) {
      const res = await callMagento("bulk", { skus: skus.slice(i, i + 500), op, categoryId });
      results.push(...(res?.results ?? []));
    }
    const failed = results.filter(r => !r.ok);
    mgSelected = new Set(failed.map(r => r.sku));
    // Category changes move the counts on the Categories view too.
    if (op === "addCategory" || op === "removeCategory") {
      mgCategories = await callMagento("categories").catch(() => mgCategories);
      mgCategoryById = new Map(mgCategories.map(c => [c.id, c]));
      renderMgCategoriesTable();
    }
    // Enabling or disabling moves the Status filter's counts.
    if (op === "enable" || op === "disable") mgFacets = await callMagento("facets").catch(() => mgFacets);
    await loadMagentoProducts();
    if (failed.length) {
      const first = failed.slice(0, 3).map(r => `${r.sku}: ${r.error}`).join("; ");
      showIndicator(`${failed.length} of ${results.length} failed (still ticked) — ${first}`, "error");
    } else {
      showIndicator(`Updated ${n}`, "success");
    }
  } catch (err) {
    showIndicator(err.message || "Couldn't update the products.", "error");
  } finally {
    setAppLoading(false);
  }
}

// ── Product pane ─────────────────────────────────────────────────────────────

const MG_PANE_FIELDS = ["name", "colorId", "price", "specialPrice", "weight", "urlKey", "visibility", "shortDescription", "description", "metaTitle", "metaDescription"];
const MG_NUMBER_FIELDS = new Set(["price", "specialPrice", "weight", "visibility"]);
let mgPaneCategorySearch = "";

function isMagentoPaneOpen() {
  return mgPane !== null;
}

async function openMagentoPane(sku) {
  const pane = document.getElementById("mgProductPane");
  if (!pane) return;
  if (mgPane && isMgPaneDirty() && mgPane.saved.sku !== sku && !confirm("Discard your unsaved changes to this product?")) return;

  const row = mgPage.items.find(p => p.sku === sku);
  // Show what the list already knows while the full product loads.
  const seed = { ...row, description: "", shortDescription: "", metaTitle: "", metaDescription: "", weight: null };
  mgPane = { saved: seed, draft: structuredClone(seed), loading: true };
  mgPaneCategorySearch = "";
  pane.hidden = false;
  pane.querySelector(".item-pane-body")?.scrollTo({ top: 0 });
  renderMagentoPane();
  renderMgProducts();

  try {
    const full = applyMgGroups(await callMagento("product", { sku }));
    if (mgPane?.saved.sku !== sku) return;
    mgPane = { saved: full, draft: structuredClone(full), loading: false };
  } catch (err) {
    if (mgPane?.saved.sku !== sku) return;
    mgPane.loading = false;
    mgPane.error = err.message || "Couldn't load the product.";
  }
  renderMagentoPane();
}

function closeMagentoPane({ force = true } = {}) {
  if (!mgPane) return true;
  if (!force && isMgPaneDirty() && !confirm("Discard your unsaved changes to this product?")) return false;
  mgPane = null;
  const pane = document.getElementById("mgProductPane");
  if (pane) pane.hidden = true;
  if (getCurrentAppView() === "magento") renderMgProducts();
  return true;
}

/** The fields that differ from what Magento has — all that's sent on save. */
function getMgPaneChanges() {
  if (!mgPane || mgPane.loading) return {};
  const { saved, draft } = mgPane;
  const changes = {};
  [...MG_PANE_FIELDS, "status"].forEach(f => {
    const a = saved[f] ?? (MG_NUMBER_FIELDS.has(f) ? null : "");
    const b = draft[f] ?? (MG_NUMBER_FIELDS.has(f) ? null : "");
    if (a !== b) changes[f] = b;
  });
  const before = [...(saved.categoryIds ?? [])].sort().join(",");
  const after = [...(draft.categoryIds ?? [])].sort().join(",");
  if (before !== after) changes.categoryIds = draft.categoryIds;
  return changes;
}

function isMgPaneDirty() {
  return Object.keys(getMgPaneChanges()).length > 0;
}

function renderMagentoPane() {
  if (!mgPane) return;
  const { draft, saved } = mgPane;

  document.getElementById("mgPaneTitle").textContent = saved.name || saved.sku;
  document.getElementById("mgPaneSubtitle").textContent = [saved.sku, MG_TYPES[saved.type] ?? saved.type, saved.updatedAt ? `Updated ${formatMgDate(saved.updatedAt)}` : ""].filter(Boolean).join(" · ");

  const preview = document.getElementById("mgPanePreview");
  const url = getMgImageUrl(saved);
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = saved.name;
    preview.replaceChildren(img);
  } else {
    preview.replaceChildren();
  }
  preview.hidden = !url;

  const form = document.getElementById("mgPaneForm");
  form.classList.toggle("is-loading", Boolean(mgPane.loading));
  form.querySelectorAll("[data-field]").forEach(el => {
    const value = draft[el.dataset.field];
    const text = value === null || value === undefined ? "" : String(value);
    if (el.value !== text) el.value = text;
    el.disabled = Boolean(mgPane.loading);
  });
  document.querySelectorAll("#mgPaneStatus .filter-btn").forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.value) === draft.status);
    btn.disabled = Boolean(mgPane.loading);
  });

  // Grouping: a Grouped item's Simple items, or the group a Simple item is
  // in — or, when its SKU matches a group it isn't in, that flag.
  const groupField = document.getElementById("mgPaneGroupField");
  if (groupField) {
    const chip = sku => {
      const el = document.createElement("span");
      el.className = "mg-cat-chip mg-sku";
      el.textContent = sku;
      return el;
    };
    const label = document.getElementById("mgPaneGroupLabel");
    const list = document.getElementById("mgPaneGroupList");
    if (saved.type === "grouped") {
      groupField.hidden = false;
      label.textContent = "Simple items";
      list.replaceChildren(createMgChildCount(saved), ...(saved.childSkus ?? []).map(chip));
    } else if (saved.groupSku || saved.unlinkedGroup) {
      groupField.hidden = false;
      label.textContent = "Group";
      list.replaceChildren(saved.groupSku ? chip(saved.groupSku) : createMgUnlinkedFlag(saved));
    } else {
      groupField.hidden = true;
    }
  }

  renderMgPaneCategories();
  syncMgPaneFooter();
}

function renderMgPaneCategories() {
  const ids = mgPane.draft.categoryIds ?? [];
  const count = document.getElementById("mgPaneCategoryCount");
  if (count) count.textContent = ids.length ? `(${ids.length})` : "";

  const chips = document.getElementById("mgPaneCategoryChips");
  if (chips) {
    if (!ids.length) {
      const empty = document.createElement("span");
      empty.className = "item-tasks-empty";
      empty.textContent = "Not in any category.";
      chips.replaceChildren(empty);
    } else {
      chips.replaceChildren(...ids.map(id => {
        const chip = document.createElement("span");
        chip.className = "mg-cat-chip mg-cat-chip--removable";
        chip.title = getMgCategoryPath(id);
        chip.textContent = getMgCategoryPath(id);
        const x = document.createElement("button");
        x.type = "button";
        x.textContent = "✕";
        x.setAttribute("aria-label", `Remove from ${getMgCategoryPath(id)}`);
        x.addEventListener("click", () => toggleMgPaneCategory(id, false));
        chip.appendChild(x);
        return chip;
      }));
    }
  }

  const list = document.getElementById("mgPaneCategoryList");
  if (!list) return;
  const q = mgPaneCategorySearch.trim().toLowerCase();
  const shown = mgCategories.filter(c => !q || c.path.toLowerCase().includes(q));
  if (!shown.length) {
    list.innerHTML = `<span class="item-tasks-empty">${mgCategories.length ? "No categories match." : "No categories loaded."}</span>`;
    return;
  }
  list.replaceChildren(...shown.map(c => {
    const label = document.createElement("label");
    label.className = "mg-pane-cat-option";
    if (!c.isActive) label.classList.add("is-inactive");
    // The tree's indent; a search shows full paths instead.
    if (!q) label.style.paddingLeft = `${8 + Math.max(c.level - 1, 0) * 16}px`;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = ids.includes(c.id);
    cb.disabled = Boolean(mgPane.loading);
    cb.addEventListener("change", () => toggleMgPaneCategory(c.id, cb.checked));
    const name = document.createElement("span");
    name.textContent = q ? c.path : c.name;
    label.append(cb, name);
    if (!c.isActive) {
      const tag = document.createElement("span");
      tag.className = "mg-inactive-tag";
      tag.textContent = "inactive";
      label.appendChild(tag);
    }
    return label;
  }));
}

function toggleMgPaneCategory(id, on) {
  if (!mgPane || mgPane.loading) return;
  const ids = new Set(mgPane.draft.categoryIds ?? []);
  if (on) ids.add(id); else ids.delete(id);
  mgPane.draft.categoryIds = [...ids];
  renderMgPaneCategories();
  syncMgPaneFooter();
}

function syncMgPaneFooter() {
  const changes = getMgPaneChanges();
  const n = Object.keys(changes).length;
  const save = document.getElementById("mgPaneSaveBtn");
  const revert = document.getElementById("mgPaneRevertBtn");
  const message = document.getElementById("mgPaneMessage");
  if (save) save.disabled = n === 0 || mgPane?.saving;
  if (revert) revert.disabled = n === 0 || mgPane?.saving;
  if (message) {
    message.classList.toggle("is-error", Boolean(mgPane?.error));
    if (mgPane?.error) message.textContent = mgPane.error;
    else if (mgPane?.loading) message.textContent = "Loading from Magento…";
    else if (mgPane?.saving) message.textContent = "Saving…";
    else message.textContent = n ? `${n} unsaved change${n === 1 ? "" : "s"}` : "";
  }
}

async function saveMagentoPane() {
  if (!mgPane || mgPane.saving) return;
  const changes = getMgPaneChanges();
  if (!Object.keys(changes).length) return;
  if ("name" in changes && !String(changes.name).trim()) {
    mgPane.error = "A product needs a name.";
    syncMgPaneFooter();
    return;
  }
  const sku = mgPane.saved.sku;
  mgPane.saving = true;
  mgPane.error = "";
  syncMgPaneFooter();
  try {
    const saved = applyMgGroups(await callMagento("update", { sku, changes }));
    if (mgPane?.saved.sku === sku) mgPane = { saved, draft: structuredClone(saved), loading: false };
    const row = mgPage.items.find(p => p.sku === sku);
    if (row) Object.assign(row, pickMgSummary(saved));
    renderMgProducts();
    renderMagentoPane();
    showIndicator(`${sku} saved to Magento`, "success");
  } catch (err) {
    if (mgPane?.saved.sku === sku) {
      mgPane.saving = false;
      mgPane.error = err.message || "Couldn't save.";
      syncMgPaneFooter();
    }
  }
}

function revertMagentoPane() {
  if (!mgPane) return;
  mgPane.draft = structuredClone(mgPane.saved);
  mgPane.error = "";
  renderMagentoPane();
}

// ── Categories view ──────────────────────────────────────────────────────────

let mgCategorySearch = "";

function visibleMgCategories() {
  const showInactive = document.getElementById("mgShowInactive")?.checked ?? true;
  const q = mgCategorySearch.trim().toLowerCase();
  return mgCategories.filter(c => (showInactive || c.isActive) && (!q || c.path.toLowerCase().includes(q)));
}

function renderMgCategoriesTable() {
  updateMgCounter();
  const tbody = document.getElementById("mgCategoriesBody");
  if (!tbody) return;
  const message = text => {
    tbody.innerHTML = `<tr class="state-row"><td colspan="5">${escapeHtml(text)}</td></tr>`;
  };
  if (mgStore?.error) return message(mgStore.error);
  if (!mgStore) return message("Loading categories…");
  const shown = visibleMgCategories();
  if (!shown.length) return message(mgCategories.length ? "No categories match." : "No categories in Magento yet.");

  const q = mgCategorySearch.trim();
  setActiveSearchQuery(q.toLowerCase());
  tbody.replaceChildren(...shown.map(c => {
    const tr = document.createElement("tr");
    tr.dataset.categoryId = c.id;
    if (!c.isActive) tr.classList.add("mg-row-disabled");

    const name = document.createElement("td");
    name.className = "mg-cat-name-cell";
    if (!q) name.style.paddingLeft = `${12 + Math.max(c.level - 1, 0) * 20}px`;
    name.appendChild(createMgCategoryNameInput(c, q));
    if (q) {
      const path = document.createElement("span");
      path.className = "mg-cat-path";
      mountSearchHighlightedText(path, c.path);
      name.appendChild(path);
    }

    const id = document.createElement("td");
    id.className = "mg-num";
    id.textContent = c.id;

    const count = document.createElement("td");
    count.className = "mg-num";
    count.textContent = c.productCount.toLocaleString();

    const active = document.createElement("td");
    active.appendChild(createMgCategoryActiveSwitch(c));

    const actions = document.createElement("td");
    const view = document.createElement("button");
    view.type = "button";
    view.className = "btn mg-cat-view-btn";
    view.textContent = "View products";
    // All of the category's products — the other filters start over.
    view.addEventListener("click", () => {
      mgSubview = "products";
      mgQuery.search = "";
      renderMagentoSubview();
      setMgHeaderFilters({ categories: [c.id], status: null, type: null, visibility: null });
    });
    actions.appendChild(view);

    tr.append(name, id, count, active, actions);
    return tr;
  }));
}

/** Rename in place: saves on Enter or leaving the box, Esc undoes. */
function createMgCategoryNameInput(category, searching) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "mg-cat-name-input";
  if (category.level <= 1) input.classList.add("is-root");
  input.value = category.name;
  input.title = searching ? category.path : "Click to rename";
  input.setAttribute("aria-label", `Name of ${category.path}`);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      input.value = category.name;
      input.blur();
    }
  });
  input.addEventListener("blur", async () => {
    const name = input.value.trim();
    if (!name) {
      input.value = category.name;
      return;
    }
    if (name === category.name) return;
    input.disabled = true;
    try {
      await callMagento("category", { id: category.id, changes: { name } });
      const oldPath = category.path;
      category.name = name;
      // Renaming a parent renames every path under it.
      const cut = oldPath.lastIndexOf(" / ");
      const newPath = cut === -1 ? name : `${oldPath.slice(0, cut)} / ${name}`;
      mgCategories.forEach(c => {
        if (c.path === oldPath) c.path = newPath;
        else if (c.path.startsWith(`${oldPath} / `)) c.path = newPath + c.path.slice(oldPath.length);
      });
      renderMgCategoryControls();
      renderMgProducts();
      showIndicator(`Renamed to ${name}`, "success");
    } catch (err) {
      input.value = category.name;
      showIndicator(err.message || "Couldn't rename the category.", "error");
    } finally {
      input.disabled = false;
    }
  });
  return input;
}

function createMgCategoryActiveSwitch(category) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mg-status-switch";
  const paint = () => {
    btn.classList.toggle("is-on", category.isActive);
    btn.setAttribute("aria-pressed", category.isActive ? "true" : "false");
    btn.innerHTML = `<span class="mg-switch-track" aria-hidden="true"><span class="mg-switch-knob"></span></span><span class="mg-switch-label">${category.isActive ? "Active" : "Inactive"}</span>`;
  };
  paint();
  btn.addEventListener("click", async () => {
    const next = !category.isActive;
    if (!next && !confirm(`Make "${category.path}" inactive? It will disappear from the store's menu.`)) return;
    btn.disabled = true;
    try {
      await callMagento("category", { id: category.id, changes: { isActive: next } });
      category.isActive = next;
      paint();
      btn.closest("tr")?.classList.toggle("mg-row-disabled", !next);
      showIndicator(`${category.name} ${next ? "active" : "inactive"}`, "success");
    } catch (err) {
      showIndicator(err.message || "Couldn't change the category.", "error");
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

// ── CSV export ───────────────────────────────────────────────────────────────

/**
 * Header menu → Export CSV on this page. Products: every product matching
 * the current filters, search and sort — not just the page on screen — so
 * Magento is asked for it 200 at a time. Categories: the tree as shown.
 */
async function exportMagentoCsv() {
  if (!mgStore || mgStore.error) {
    showIndicator(mgStore?.error || "Magento hasn't loaded yet.", "error");
    return;
  }
  if (mgSubview === "categories") return exportMgCategoriesCsv();

  if (!mgPage.total) {
    showIndicator("Nothing to export", "error");
    return;
  }
  const EXPORT_PAGE = 200;
  const products = new Map(); // by SKU — a product edited mid-export can move pages
  setAppLoading(true, "Exporting from Magento…");
  try {
    for (let page = 1; ; page++) {
      const res = await callMagento("products", { ...mgQuery, page, pageSize: EXPORT_PAGE });
      (res?.items ?? []).forEach(p => products.set(p.sku, applyMgGroups(p)));
      setAppLoading(true, `Exporting from Magento… ${products.size.toLocaleString()} of ${res.total.toLocaleString()}`);
      if (!res?.items?.length || page * EXPORT_PAGE >= res.total) break;
    }
  } catch (err) {
    showIndicator(err.message || "Couldn't export from Magento.", "error");
    return;
  } finally {
    setAppLoading(false);
  }

  const rows = [...products.values()].map(p => [
    p.sku,
    p.name,
    p.color,
    MG_TYPES[p.type] ?? p.type,
    p.type === "grouped" ? (p.childSkus ?? []).length : "",
    (p.childSkus ?? []).join(", "),
    p.groupSku ?? "",
    p.unlinkedGroup ? `SKU matches ${p.unlinkedGroup}, not in that group` : "",
    MG_STATUS[p.status] ?? p.status,
    MG_VISIBILITY[p.visibility] ?? p.visibility,
    p.price ?? "",
    p.specialPrice ?? "",
    p.qty ?? "",
    p.inStock === null ? "" : p.inStock ? "Yes" : "No",
    (p.categoryIds ?? []).map(getMgCategoryPath).join(" | "),
    (p.categoryIds ?? []).join(", "),
    p.urlKey,
    getMgImageUrl(p),
    p.createdAt,
    p.updatedAt,
  ]);
  downloadCsv(`Magento products ${todayYmd()}`,
    ["SKU", "Name", "Color", "Type", "Simple Items", "Simple Item SKUs", "Group", "Group Flag", "Status", "Visibility", "Price", "Special Price", "Qty", "In Stock", "Categories", "Category IDs", "URL Key", "Image URL", "Created", "Updated"],
    rows);
  showIndicator(`Exported ${rows.length.toLocaleString()} products`, "success");
}

function exportMgCategoriesCsv() {
  const categories = visibleMgCategories();
  if (!categories.length) {
    showIndicator("Nothing to export", "error");
    return;
  }
  downloadCsv(`Magento categories ${todayYmd()}`,
    ["ID", "Parent ID", "Name", "Path", "Level", "Active", "Products"],
    categories.map(c => [c.id, c.parentId, c.name, c.path, c.level, c.isActive ? "Yes" : "No", c.productCount]));
  showIndicator(`Exported ${categories.length.toLocaleString()} categories`, "success");
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initMagento() {
  document.getElementById("mgExportCsvBtn")?.addEventListener("click", exportMagentoCsv);
  initMagentoGroups(); // js/magento-groups.js

  document.getElementById("mgPaneVisibility")?.replaceChildren(...Object.entries(MG_VISIBILITY).map(([k, v]) => new Option(v, k)));

  // Before the sort handlers: a click on the funnel side of the header
  // filters, a click on the label sorts.
  Object.keys(MG_HEADER_FILTERS).forEach(col => {
    initColumnFilter("mgProductsTable", col, {
      options: () => mgHeaderFilterOptions(col),
      onChange: applyMgHeaderFilters,
    });
  });
  document.querySelectorAll("#mgStatusFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => setMgHeaderFilters({ status: btn.dataset.status ? [btn.dataset.status] : null }));
  });
  document.querySelectorAll("#mgTypeFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => setMgHeaderFilters({ type: btn.dataset.type ? [btn.dataset.type] : null }));
  });
  document.querySelectorAll("#mgSubtabs .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (mgSubview === btn.dataset.view) return;
      if (!closeMagentoPane({ force: false })) return;
      mgSubview = btn.dataset.view;
      renderMagentoSubview();
      if (mgSubview === "categories") renderMgCategoriesTable();
      else renderMgProducts();
    });
  });

  // Search: Magento is asked once typing pauses.
  let searchTimer = null;
  document.getElementById("mgSearchInput")?.addEventListener("input", e => {
    const value = e.target.value;
    if (mgSubview === "categories") {
      mgCategorySearch = value;
      renderMgCategoriesTable();
      return;
    }
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setMgQuery({ search: value.trim() }), 350);
  });
  document.getElementById("mgShowInactive")?.addEventListener("change", renderMgCategoriesTable);

  document.querySelectorAll("#mgProductsTable thead th[data-col]").forEach(th => {
    if (!MG_SORTABLE.has(th.dataset.col)) th.classList.add("th-no-sort");
    th.addEventListener("click", () => sortMgProductsBy(th.dataset.col));
  });
  // The default sort shows on its header from the start.
  syncMgSortHeaders();

  document.getElementById("mgProductsBody")?.addEventListener("click", e => {
    // The tick box (and its cell) selects; the status switch flips; anywhere else opens the pane.
    if (e.target.closest('td[data-col="select"]')) {
      if (e.target.tagName !== "INPUT") e.target.closest("td").querySelector("input")?.click();
      return;
    }
    if (e.target.closest(".mg-status-switch")) return;
    const tr = e.target.closest("tr[data-sku]");
    if (tr) openMagentoPane(tr.dataset.sku);
  });

  document.getElementById("mgSelectAll")?.addEventListener("change", e => {
    mgPage.items.forEach(p => {
      if (e.target.checked) mgSelected.add(p.sku); else mgSelected.delete(p.sku);
    });
    renderMgProducts();
  });
  document.getElementById("mgClearSelectionBtn")?.addEventListener("click", clearMgSelection);
  document.getElementById("mgBulkEnableBtn")?.addEventListener("click", () => runMgBulk("enable"));
  document.getElementById("mgBulkDisableBtn")?.addEventListener("click", () => runMgBulk("disable"));
  ["mgBulkAddCategory", "mgBulkRemoveCategory"].forEach(id => {
    const select = document.getElementById(id);
    select?.addEventListener("change", async () => {
      const categoryId = select.value;
      select.value = "";
      if (categoryId) await runMgBulk(id === "mgBulkAddCategory" ? "addCategory" : "removeCategory", categoryId);
    });
  });

  // Pane edits go into the draft; nothing reaches Magento until Save.
  const form = document.getElementById("mgPaneForm");
  form?.addEventListener("input", e => {
    const field = e.target.dataset?.field;
    if (!field || !mgPane) return;
    const raw = e.target.value;
    mgPane.draft[field] = MG_NUMBER_FIELDS.has(field) ? (raw.trim() === "" ? null : Number(raw)) : raw;
    mgPane.error = "";
    syncMgPaneFooter();
  });
  form?.addEventListener("submit", e => e.preventDefault());
  document.querySelectorAll("#mgPaneStatus .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!mgPane || mgPane.loading) return;
      mgPane.draft.status = Number(btn.dataset.value);
      renderMagentoPane();
    });
  });
  document.getElementById("mgPaneCategorySearch")?.addEventListener("input", e => {
    mgPaneCategorySearch = e.target.value;
    renderMgPaneCategories();
  });
  document.getElementById("mgPaneSaveBtn")?.addEventListener("click", saveMagentoPane);
  document.getElementById("mgPaneRevertBtn")?.addEventListener("click", revertMagentoPane);
  document.getElementById("mgPaneClose")?.addEventListener("click", () => closeMagentoPane({ force: false }));
  document.addEventListener("keydown", e => {
    if (!isMagentoPaneOpen()) return;
    if (e.key === "Escape") {
      if (document.querySelector(".modal-backdrop.open")) return;
      closeMagentoPane({ force: false });
    } else if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveMagentoPane();
    }
  });
  window.addEventListener("beforeunload", e => {
    if (mgPane && isMgPaneDirty()) e.preventDefault();
  });

  syncMgFilterButtons();
}
