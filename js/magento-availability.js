/**
 * Availability — whether a product actually shows on the webstore.
 *
 * The store: Grouped styles are visible (Catalog, Search); the Simple items
 * under them (the colours) are "Not Visible Individually", so they're only
 * seen through their group.
 *
 * A product's own conditions:
 *   Simple   Enabled, Salable Qty above 0, In Stock
 *   Grouped  Enabled, In Stock (a group has no qty)
 * Salable Qty is what the store sells by, but Magento gives it one SKU at a
 * time, so it's read behind the catalog, only for items that pass the rest
 * (nothing else can be available, and it's never above Qty). Until it's read,
 * or if it can't be, Qty ≥ 1 stands in.
 * And the grouping:
 *   Simple   only shows through its group, so it's available only when its
 *            group is Enabled and In Stock too (an item in no group, or in
 *            an unavailable group, doesn't show). An item visible on its own
 *            needs no group.
 *   Grouped  available only when at least one of its items is.
 *
 * Availability depends on other products (a group's items, an item's
 * group) that may be on other pages, so it's worked out from a brief index
 * of the whole catalog (the helper's catalogIndex: status, visibility, qty,
 * Stock Status for every SKU) plus the imported groups. Magento can't filter
 * by it, so the Available / Not available and Flagged filters ask Magento
 * for every matching SKU (skuList), keep the ones that pass here, and then
 * load just the page wanted (products with `skus`).
 */

/** sku → { type, status, visibility, qty, inStock } — null until loaded. */
let mgIndex = null;
let mgIndexLoading = null;
let mgIndexError = "";
/** Grouped SKU → its items as Magento's API lists them (enabled only) — used before groups are imported. */
const mgApiChildren = new Map();

/** "" (all) | "available" | "unavailable" */
let mgAvailFilter = "";
let mgFlaggedOnly = false;
/** The last skuList, by query — so paging a filtered list doesn't ask again. */
let mgSkuListCache = { key: "", skus: null };

const MG_INDEX_CACHE_KEY = scopedStorageKey("magentoCatalogIndex");
const MG_SALABLE_CACHE_KEY = scopedStorageKey("magentoSalableQty");
/** SKUs per salableQty call, and calls at once. */
const MG_SALABLE_BATCH = 200;
const MG_SALABLE_CALLS = 2;
let mgCatalogSalableRun = 0;

/**
 * Rows from the helper's catalogIndex. Newer helpers add name, price, date
 * and categories — then the app can filter and sort by itself (mgLocalSkus).
 */
function mgIndexFromRows(rows) {
  return new Map((rows ?? []).map(([sku, type, status, visibility, qty, inStock, name, price, updatedAt, categoryIds]) =>
    [sku, {
      type, status, visibility, qty, inStock,
      name: name ?? null,
      price: price ?? null,
      updatedAt: updatedAt ?? "",
      categoryIds: categoryIds ? String(categoryIds).split(",") : [],
    }]));
}

/** The catalog carries what local filtering needs (names — from a newer helper). */
function mgIndexIsFull() {
  if (!mgIndex?.size) return false;
  return mgIndex.values().next().value.name !== null;
}

/**
 * The last catalog check, kept in this browser — so availability shows the
 * moment the tab opens, while a fresh check runs behind it.
 */
function restoreMgIndexCache() {
  if (mgIndex) return;
  try {
    const cached = JSON.parse(localStorage.getItem(MG_INDEX_CACHE_KEY) ?? "null");
    if (Array.isArray(cached?.products)) mgIndex = mgIndexFromRows(cached.products);
    const salable = JSON.parse(localStorage.getItem(MG_SALABLE_CACHE_KEY) ?? "null");
    if (Array.isArray(salable)) salable.forEach(([sku, value]) => mgSalable.set(sku, value));
  } catch {
    /* nothing usable kept */
  }
}

function saveMgIndexCache(rows) {
  try {
    localStorage.setItem(MG_INDEX_CACHE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), products: rows }));
  } catch {
    /* too big or not allowed — the next visit just waits for the check */
  }
}

async function loadMgIndex({ force = false } = {}) {
  if (mgIndexLoading && !force) return mgIndexLoading;
  // Last time's answer first, if the page has none yet.
  restoreMgIndexCache();
  mgIndexLoading = (async () => {
    try {
      const res = await callMagento("catalogIndex");
      mgIndex = mgIndexFromRows(res?.products);
      saveMgIndexCache(res?.products ?? []);
      mgIndexError = "";
      // The page on screen may have been filled from last time's catalog.
      mgPage.items.forEach(fillMgStockFromIndex);
      loadMgCatalogSalable();
    } catch (err) {
      mgIndexError = err.message || "Couldn't check availability.";
      showIndicator(`Availability can't be checked: ${mgIndexError}`, "error");
      // A filter by it can't work now — drop it rather than show nothing.
      if (mgAvailFilter) {
        mgAvailFilter = "";
        forgetMgSkuList();
        loadMagentoProducts();
      }
    }
    renderMgAvailControls();
    renderMgProducts();
    if (mgPane) renderMagentoPane(); // its Available tag
  })();
  return mgIndexLoading;
}

/** Salable Qty for every item that could be available, a batch at a time. */
async function loadMgCatalogSalable() {
  const run = ++mgCatalogSalableRun;
  const skus = [...mgIndex].filter(([, r]) => r.type !== "grouped" && r.status === 1 && r.inStock !== false && r.qty > 0).map(([sku]) => sku);
  const batches = [];
  for (let i = 0; i < skus.length; i += MG_SALABLE_BATCH) batches.push(skus.slice(i, i + MG_SALABLE_BATCH));
  let stopped = false;
  const worker = async () => {
    while (batches.length && !stopped && run === mgCatalogSalableRun) {
      try {
        const { quantities, problem } = await callMagento("salableQty", { skus: batches.shift() });
        Object.entries(quantities).forEach(([sku, value]) => mgSalable.set(sku, value));
        if (problem) {
          stopped = true;
          warnMgSalable(problem);
        }
      } catch {
        stopped = true; // Qty stands in
      }
      if (!mgAvailFilter && run === mgCatalogSalableRun) refreshMgAvailability();
    }
  };
  await Promise.all(Array.from({ length: MG_SALABLE_CALLS }, worker));
  if (run !== mgCatalogSalableRun || stopped) return;
  try {
    localStorage.setItem(MG_SALABLE_CACHE_KEY, JSON.stringify([...mgSalable]));
  } catch {
    /* the next visit just reads them again */
  }
  // Filtered lists were picked before these came in.
  forgetMgSkuList();
  if (hasMgClientFilter()) loadMagentoProducts();
  else refreshMgAvailability();
}

function refreshMgAvailability() {
  renderMgProducts();
  renderMgAvailControls();
  if (mgPane) renderMagentoPane();
}

/** A product just loaded from Magento — the freshest word on it. */
function absorbMgProduct(p) {
  if (p.type === "grouped" && p.childSkus) mgApiChildren.set(p.sku, p.childSkus);
  if (!mgIndex) return;
  const now = mgIndex.get(p.sku) ?? {};
  mgIndex.set(p.sku, {
    type: p.type,
    status: p.status,
    visibility: p.visibility,
    qty: p.qty ?? now.qty ?? null,
    inStock: p.inStock ?? now.inStock ?? null,
    name: p.name ?? now.name ?? null,
    price: p.price ?? now.price ?? null,
    updatedAt: p.updatedAt ?? now.updatedAt ?? "",
    categoryIds: p.categoryIds ?? now.categoryIds ?? [],
  });
}

/**
 * With the catalog in hand, a page needn't fetch stock — that's a few dozen
 * extra calls to Magento per page (one per Grouped item), and the catalog
 * already has every product's qty and Stock Status. So pages are asked for
 * without it, and filled in from here.
 */
function mgStockParams() {
  return mgIndex ? { withStock: false } : {};
}

function fillMgStockFromIndex(p) {
  const r = mgIndex?.get(p.sku);
  if (r) {
    p.qty = p.type === "grouped" ? null : r.qty;
    p.inStock = r.inStock;
  }
  return p;
}

/** Edits change availability; the next filtered list is asked for fresh. */
function forgetMgSkuList() {
  mgSkuListCache = { key: "", skus: null };
}

// ── The rules ────────────────────────────────────────────────────────────────

/** A product's own conditions: ok true / false / null (not known yet), with why not. */
function mgOwnConditions(sku) {
  const r = mgIndex?.get(sku);
  if (!r) return { ok: null, reasons: ["Not checked yet"] };
  const reasons = [];
  let unknown = false;
  if (r.status !== 1) reasons.push("Disabled");
  if (r.type !== "grouped") {
    const salable = mgSalable.get(sku);
    if (typeof salable === "number") {
      if (salable <= 0) reasons.push(`Salable Qty ${salable}`);
    } else if (r.qty === null || r.qty === undefined) unknown = true;
    else if (r.qty < 1) reasons.push(`Qty ${r.qty}`);
  }
  if (r.inStock === false) reasons.push("Out of Stock");
  else if (r.inStock === null || r.inStock === undefined) unknown = true;
  return { ok: reasons.length ? false : unknown ? null : true, reasons };
}

function mgGroupItems(groupSku) {
  return mgGroups?.get(groupSku) ?? mgApiChildren.get(groupSku) ?? null;
}

/**
 * { available: true | false | null, reasons: [why not] } — null when it
 * can't be told yet (catalog not loaded, groups not imported).
 */
function mgAvailability(sku) {
  if (!mgIndex) return { available: null, reasons: [mgIndexError || "Checking…"] };
  const r = mgIndex.get(sku);
  const own = mgOwnConditions(sku);
  if (!r || own.ok === false) return { available: own.ok, reasons: own.reasons };

  if (r.type === "grouped") {
    if (r.visibility === 1) return { available: false, reasons: ["Not visible in the catalog"] };
    const items = mgGroupItems(sku);
    if (!items) return { available: null, reasons: ["Import groups to check its items"] };
    if (!items.length) return { available: false, reasons: ["No items in the group"] };
    const states = items.map(item => mgOwnConditions(item).ok);
    if (states.includes(true)) return { available: own.ok, reasons: own.ok ? [] : ["Stock Status not known"] };
    if (states.every(s => s === false)) return { available: false, reasons: ["No available items"] };
    return { available: null, reasons: ["Some items not checked yet"] };
  }

  // Visible on its own: no group needed.
  if (r.visibility !== 1) return { available: own.ok, reasons: own.reasons };
  if (!mgGroups) return { available: null, reasons: ["Import groups to check its group"] };
  const group = mgChildGroup.get(sku);
  if (!group) return { available: false, reasons: ["Not in a group"] };
  const g = mgOwnConditions(group);
  const gVisible = mgIndex.get(group)?.visibility !== 1;
  if (g.ok === false || !gVisible) {
    const why = g.ok === false ? g.reasons.join(", ") : "not visible in the catalog";
    return { available: false, reasons: [`Group ${group} is ${why}`] };
  }
  if (own.ok === null || g.ok === null) return { available: null, reasons: ["Stock not checked yet"] };
  return { available: true, reasons: [] };
}

/** A Simple item whose SKU matches a group it isn't in (needs the import). */
function isMgFlagged(sku) {
  if (!mgGroups) return false;
  const r = mgIndex?.get(sku);
  if (r && r.type === "grouped") return false;
  return !mgChildGroup.has(sku) && !mgGroups.has(sku) && Boolean(prefixGroupFor(sku));
}

/** The table's Available cell: the label — why not is in its tooltip. */
function createMgAvailCell(product) {
  const { available, reasons } = mgAvailability(product.sku);
  const wrap = document.createElement("span");
  wrap.className = "mg-avail-cell";
  const pill = document.createElement("span");
  pill.className = `mg-avail-pill ${available === true ? "is-yes" : available === false ? "is-no" : "is-unknown"}`;
  pill.textContent = available === true ? "Available" : available === false ? "Not available" : "?";
  wrap.title = available === true
    ? "Showing on the webstore"
    : `${available === false ? "Not showing on the webstore" : "Can't tell yet"}: ${reasons.join("; ")}`;
  wrap.appendChild(pill);
  return wrap;
}

// ── Filters ──────────────────────────────────────────────────────────────────

function hasMgClientFilter() {
  return Boolean(mgAvailFilter || mgFlaggedOnly);
}

function passesMgClientFilter(sku) {
  if (mgFlaggedOnly && !isMgFlagged(sku)) return false;
  if (mgAvailFilter) {
    const { available } = mgAvailability(sku);
    if (mgAvailFilter === "available" && available !== true) return false;
    if (mgAvailFilter === "unavailable" && available !== false) return false;
  }
  return true;
}

/**
 * Every SKU passing Magento's filters (status, type, visibility, category,
 * search), sorted as Magento sorts — worked out here from the catalog, no
 * calls needed: ties put Grouped first, then go by SKU; blanks sort first
 * going up (as MySQL's do); case is ignored.
 */
function mgLocalSkus() {
  const q = mgQuery;
  const term = q.search.trim().toLowerCase();
  const skus = [];
  mgIndex.forEach((r, sku) => {
    if (q.status && !q.status.includes(String(r.status))) return;
    if (q.type && !q.type.includes(r.type)) return;
    if (q.visibility && !q.visibility.includes(String(r.visibility))) return;
    if (q.categoryId && !r.categoryIds.some(id => q.categoryId.includes(id))) return;
    if (term && !sku.toLowerCase().includes(term) && !String(r.name ?? "").toLowerCase().includes(term)) return;
    skus.push(sku);
  });

  const key = {
    name: r => String(r.name ?? "").toLowerCase(),
    sku: (r, sku) => sku.toLowerCase(),
    type: r => r.type,
    price: r => r.price,
    status: r => r.status,
    visibility: r => r.visibility,
    updatedAt: r => r.updatedAt,
  }[q.sort] ?? (r => r.updatedAt);
  const dir = q.sort ? (q.dir === "DESC" ? -1 : 1) : -1;
  const cmp = (a, b) => {
    if (a === b) return 0;
    if (a === null || a === undefined || a === "") return -1;
    if (b === null || b === undefined || b === "") return 1;
    return a < b ? -1 : 1;
  };
  return skus.sort((x, y) => {
    const rx = mgIndex.get(x);
    const ry = mgIndex.get(y);
    return dir * cmp(key(rx, x), key(ry, y))
      || (q.sort !== "type" ? cmp(rx.type, ry.type) : 0)
      || cmp(x.toLowerCase(), y.toLowerCase());
  });
}

/** Every SKU matching Magento's filters and these, in sort order. */
async function mgFilteredSkus() {
  // The kept (or current) catalog will do; only wait for a check if there's none.
  if (!mgIndex) await loadMgIndex();
  if (mgAvailFilter && !mgIndex) throw new Error(`Availability can't be checked: ${mgIndexError || "the catalog didn't load"}`);
  // A full catalog answers it here — no calls to Magento at all.
  if (mgIndexIsFull()) return mgLocalSkus().filter(passesMgClientFilter);
  // Otherwise (an older helper's catalog) Magento lists the SKUs.
  const { page, pageSize, ...rest } = mgQuery;
  const key = JSON.stringify(rest);
  if (mgSkuListCache.key !== key || !mgSkuListCache.skus) {
    mgSkuListCache = { key, skus: await callMagento("skuList", rest) };
  }
  return mgSkuListCache.skus.filter(passesMgClientFilter);
}

/** One page of products by SKU, in the order given. */
async function loadMgProductsBySku(skus) {
  if (!skus.length) return [];
  // The SKUs were already picked with the filters, so only they are sent.
  const res = await callMagento("products", { sort: mgQuery.sort, dir: mgQuery.dir, ...mgStockParams(), page: 1, pageSize: skus.length, skus });
  const bySku = new Map((res?.items ?? []).map(p => [p.sku, p]));
  return skus.map(sku => bySku.get(sku)).filter(Boolean);
}

/** The page wanted, when a filter Magento can't apply is on. */
async function loadMgClientFilteredPage() {
  const skus = await mgFilteredSkus();
  const from = (mgQuery.page - 1) * mgQuery.pageSize;
  return { items: await loadMgProductsBySku(skus.slice(from, from + mgQuery.pageSize)), total: skus.length, page: mgQuery.page, pageSize: mgQuery.pageSize };
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function renderMgAvailControls() {
  document.querySelectorAll("#mgAvailFilters .filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.avail === mgAvailFilter);
    // Without the catalog, Available / Not available can't be told — say so.
    const blocked = Boolean(btn.dataset.avail) && !mgIndex && Boolean(mgIndexError);
    btn.disabled = blocked;
    if (blocked) btn.title = `Can't check availability: ${mgIndexError}`;
  });
  const flagged = document.getElementById("mgFlaggedBtn");
  if (flagged) {
    flagged.classList.toggle("active", mgFlaggedOnly);
    flagged.disabled = !mgGroups;
    const n = mgIndex && mgGroups ? [...mgIndex.keys()].filter(isMgFlagged).length : null;
    flagged.textContent = n === null ? "Flagged" : `Flagged (${n.toLocaleString()})`;
    flagged.title = mgGroups
      ? "Simple items whose SKU matches a group they aren't in on Magento"
      : "Import groups first — flags come from the imported groups";
  }
  // Catalog-wide counts on hover.
  if (mgIndex) {
    let yes = 0;
    let no = 0;
    mgIndex.forEach((_, sku) => {
      const a = mgAvailability(sku).available;
      if (a === true) yes += 1;
      else if (a === false) no += 1;
    });
    const set = (key, text) => {
      const btn = document.querySelector(`#mgAvailFilters [data-avail="${key}"]`);
      if (btn) btn.title = text;
    };
    set("available", `${yes.toLocaleString()} products showing on the webstore`);
    set("unavailable", `${no.toLocaleString()} products not showing`);
  }
}

function setMgClientFilter(changes) {
  if ("avail" in changes) mgAvailFilter = changes.avail;
  if ("flagged" in changes) mgFlaggedOnly = changes.flagged;
  renderMgAvailControls();
  setMgQuery({});
}

function initMagentoAvailability() {
  document.querySelectorAll("#mgAvailFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => setMgClientFilter({ avail: btn.dataset.avail }));
  });
  document.getElementById("mgFlaggedBtn")?.addEventListener("click", () => setMgClientFilter({ flagged: !mgFlaggedOnly }));
  renderMgAvailControls();
}
