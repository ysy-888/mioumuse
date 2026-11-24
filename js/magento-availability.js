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
/** Group conditions and children per Magento record, before SKU aggregation. */
let mgGroupCatalogRecords = new Map();
let mgIndexLoading = null;
let mgIndexError = "";
/** Grouped SKU → its items as Magento's API lists them (enabled only) — used before groups are imported. */
const mgApiChildren = new Map();

/** "" (all) | "available" | "unavailable" */
let mgAvailFilter = "";
let mgFlaggedOnly = false;
let mgAtsMismatchOnly = false;
let mgAvailableNoPictureOnly = false;
let mgN41AvailabilityMismatchOnly = false;
const mgImageFailures = new Map();
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
  mgPackRevision++;
  mgGroupCatalogRecords = new Map();
  for (const row of rows ?? []) {
    if (row[1] !== "grouped" || typeof row[11] !== "string") continue;
    const sku = String(row[0]);
    if (!mgGroupCatalogRecords.has(sku)) mgGroupCatalogRecords.set(sku, []);
    mgGroupCatalogRecords.get(sku).push({ status: Number(row[2]), visibility: Number(row[3]), inStock: row[5], children: row[11] ? row[11].split(",") : [] });
  }
  const seenSkus = new Set();
  for (const row of rows ?? []) {
    if (seenSkus.has(String(row[0]))) mgDuplicateSkus.add(String(row[0]));
    seenSkus.add(String(row[0]));
  }
  // A newer helper adds each Grouped product's live items — so an item put in
  // a group since the imported export counts as in it (js/magento-groups.js).
  const live = (rows ?? [])
    .filter(row => row[1] === "grouped" && typeof row[11] === "string")
    .map(row => [String(row[0]), row[11] ? row[11].split(",") : [], row[12]]);
  if (live.length) setMgLiveGroups(live, new Set((rows ?? []).filter(row => Number(row[2]) === 1).map(row => String(row[0]))));
  return new Map((rows ?? []).map(([sku, type, status, visibility, qty, inStock, name, price, updatedAt, categoryIds, preOrderDate, _groupItems, _id, prepack, prepackCode, image]) =>
    [sku, {
      type, status, visibility, qty, inStock,
      name: name ?? null,
      price: price ?? null,
      updatedAt: updatedAt ?? "",
      categoryIds: categoryIds ? String(categoryIds).split(",") : [],
      // undefined from a helper older than Pre-Order Date in the index.
      preOrderDate, prepack, prepackCode, image,
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
      forgetMgSkuList();
      mgPage.items.forEach(p => applyMgGroups(fillMgStockFromIndex(p)));
      if (mgPane) {
        applyMgGroups(mgPane.saved);
        applyMgGroups(mgPane.draft);
      }
      if (mgFlaggedOnly) await loadMagentoProducts();
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
    if (mgSubview === "categories") renderMgCategoryDetail(); // which styles can be ticked
    refreshStyleMgViews({ pane: true });
  })();
  return mgIndexLoading;
}

/** Salable Qty for every unique Simple SKU, including disabled/zero-stock items, for ATS comparison. */
async function loadMgCatalogSalable() {
  const run = ++mgCatalogSalableRun;
  const skus = [...mgIndex].filter(([sku, r]) => r.type !== "grouped" && !mgDuplicateSkus.has(sku)).map(([sku]) => sku);
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
  refreshStyleMgViews();
}

/** A product just loaded from Magento — the freshest word on it. */
function absorbMgProduct(p) {
  mgPackRevision++;
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
    preOrderDate: p.preOrderDate ?? now.preOrderDate,
    prepack: "prepack" in p ? p.prepack : now.prepack,
    prepackCode: "prepackCode" in p ? p.prepackCode : now.prepackCode,
    image: "image" in p ? p.image : now.image,
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
  if (mgDuplicateSkus.has(p.sku)) {
    p.qty = null;
    p.inStock = null;
    return p;
  }
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
      if (salable <= 0) reasons.push(`ATS ${salable}`);
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
  const duplicateParents = mgDuplicateSkus.has(group) ? mgGroupCatalogRecords.get(group) : null;
  if (duplicateParents?.length) {
    const linkedParents = duplicateParents.filter(parent => parent.children.includes(sku));
    if (linkedParents.length) {
      const visible = linkedParents.filter(parent => parent.status === 1 && parent.visibility !== 1);
      if (visible.some(parent => parent.inStock === true)) return { available: own.ok, reasons: own.reasons };
      if (!visible.length) return { available: false, reasons: [`Group ${group} is disabled or not visible in the catalog`] };
      if (visible.every(parent => parent.inStock === false)) return { available: false, reasons: [`Group ${group} is Out of Stock`] };
      return { available: null, reasons: ["Group Stock Status not known"] };
    }
    return { available: null, reasons: ["Duplicate group membership needs a fresh catalog check"] };
  }
  const g = mgOwnConditions(group);
  const gVisible = mgIndex.get(group)?.visibility !== 1;
  if (g.ok === false || !gVisible) {
    const why = g.ok === false ? g.reasons.join(", ") : "not visible in the catalog";
    return { available: false, reasons: [`Group ${group} is ${why}`] };
  }
  if (own.ok === null || g.ok === null) return { available: null, reasons: ["Stock not checked yet"] };
  return { available: true, reasons: [] };
}

// ── ATS: N41 garment units versus Magento prepack quantities ───────────────

/** Magento's prepack is a ratio such as "3,2,1", not an option ID. */
function mgPrepackSize(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!/^\d+(?:\s*,\s*\d+)*$/.test(text)) return null;
  const quantities = text.split(",").map(Number);
  const total = quantities.reduce((sum, qty) => sum + qty, 0);
  return quantities.every(Number.isSafeInteger) && Number.isSafeInteger(total) && total > 0 ? total : null;
}

let mgPackRevision = 0;
let mgPackParentCache = null;
function mgPackParents() {
  if (mgPackParentCache?.index === mgIndex && mgPackParentCache?.groups === mgGroups && mgPackParentCache?.revision === mgPackRevision) return mgPackParentCache.parents;
  const parents = new Map();
  const add = (children, group) => children.forEach(sku => {
    if (!parents.has(sku)) parents.set(sku, new Set());
    parents.get(sku).add(group);
  });
  (mgGroups ?? mgLiveGroups).forEach(add);
  mgApiChildren.forEach(add);
  mgPackParentCache = { index: mgIndex, groups: mgGroups, revision: mgPackRevision, parents };
  return parents;
}

function mgProductPack(product) {
  const own = mgPrepackSize(product.prepack ?? mgIndex?.get(product.sku)?.prepack);
  if (own !== null) return { size: own, source: product.sku };
  const parents = [...(mgPackParents().get(product.sku) ?? [])];
  const sizes = parents.map(sku => ({ sku, size: mgPrepackSize(mgIndex?.get(sku)?.prepack) }));
  if (sizes.some(p => mgDuplicateSkus.has(p.sku)) || new Set(sizes.map(p => p.size)).size > 1) {
    return { size: null, ambiguous: true, source: parents.join(", ") };
  }
  return { size: sizes[0]?.size ?? null, source: parents.join(", ") };
}

/** Missing data stays unknown; stock Qty never stands in for Magento ATS. */
function mgAtsComparison(product) {
  if (product.type === "grouped") return { state: "not-applicable", message: "Grouped products have no ATS of their own." };
  if (mgDuplicateSkus.has(product.sku)) return { state: "unknown", message: "Duplicate SKU: compare the individual records in Magento." };
  const units = numOrNull(mgProductStyles(product)[0]?.ats);
  if (units === null) return { state: "unknown", message: "Import N41 ATS for this style/color to compare quantities." };
  const pack = mgProductPack(product);
  if (!pack.size) return { state: pack.ambiguous ? "pack-ambiguous" : "pack-missing", message: pack.ambiguous
    ? "Linked parents have conflicting or incomplete Prepack ratios. Check the Magento parent products."
    : "Prepack ratio is missing. Refresh the catalog; check Prepack on the Magento grouped parent. No six-pack default is assumed." };
  const ats = mgSalable.get(product.sku);
  if (typeof ats !== "number" || !Number.isFinite(ats)) return { state: "pending", message: "Waiting for Magento ATS (Salable Quantity)." };
  const expected = Math.max(0, Math.floor(units / pack.size));
  return {
    state: Math.abs(ats - expected) < 0.000001 ? "match" : "mismatch",
    units, packSize: pack.size, expected, actual: ats,
    message: `N41 ATS: ${units} units ÷ ${pack.size} per pack = ${expected} whole packs; Magento ATS: ${ats} packs. Prepack from ${pack.source}. Based on total units; size-level availability may further limit complete packs.`,
  };
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
  const groupSku = product.visibility === 1 ? mgChildGroup.get(product.sku) : null;
  const base = String(mgStore?.baseUrl || "https://www.mioumuse.com/").replace(/\/?$/, "/");
  const wrap = document.createElement("a");
  wrap.className = "mg-avail-cell";
  wrap.target = "_blank";
  wrap.rel = "noopener noreferrer";
  wrap.style.textDecoration = "none";
  wrap.href = product.urlKey ? `${base}${product.urlKey}.html` : `${base}catalog/product/view/id/${encodeURIComponent(product.id)}`;
  wrap.addEventListener("click", async event => {
    event.stopPropagation();
    if (!groupSku) return;
    event.preventDefault();
    const page = window.open("about:blank", "_blank");
    if (page) page.opener = null;
    try {
      const group = await callMagento("product", { sku: groupSku });
      const url = group.urlKey ? `${base}${group.urlKey}.html` : `${base}catalog/product/view/id/${encodeURIComponent(group.id)}`;
      wrap.href = url;
      if (page) page.location.replace(url);
    } catch (error) {
      page?.close();
      showIndicator(`Couldn't open the product page: ${error.message}`, "error");
    }
  });
  const pill = document.createElement("span");
  pill.className = `mg-avail-pill ${available === true ? "is-yes" : available === false ? "is-no" : "is-unknown"}`;
  pill.textContent = available === true ? "Available" : available === false ? "Not available" : "?";
  wrap.title = available === true
    ? "Showing on the webstore"
    : `${available === false ? "Not showing on the webstore" : "Can't tell yet"}: ${reasons.join("; ")}`;
  wrap.appendChild(pill);
  return wrap;
}

/** The same Available condition as the table, on products with their own images. */
function mgAvailableNoPicture(sku, product = null) {
  const record = product ?? mgIndex?.get(sku);
  if (!record || record.type === "grouped" || mgDuplicateSkus.has(sku)) return false;
  const image = record.image ?? mgIndex?.get(sku)?.image;
  // An older catalog didn't include images: wait rather than flag unknowns.
  if (image === undefined || image === null) return false;
  const missing = !String(image).trim() || image === "no_selection" || mgImageFailures.get(sku) === image;
  return missing && mgAvailability(sku).available === true;
}

// ── Filters ──────────────────────────────────────────────────────────────────

// ── N41 and stock columns: sorted and filtered here, from the catalog ────────
//
// N41 Available, OH, WIP, OO, N41 ATS (the Styles database, by SKU), Qty,
// ATS (Salable Qty), Stock Status and Pre-Order Date. Magento can't sort or
// filter by them, so — like Available — the SKUs are picked here and only
// that page is loaded. Grouped items have none of these but Stock Status:
// a filter on the others leaves them out, and they sort last.

const MG_LOCAL_COLS = ["n41Avail", "n41Inv", "n41Oh", "n41Wip", "n41Oo", "n41Ats", "qty", "salableQty", "stockStatus", "preOrderDate"];

/** A product's value in one of those columns (null when blank). */
function mgLocalValue(col, sku, r = mgIndex?.get(sku)) {
  if (!r) return null;
  if (col === "stockStatus") return r.inStock ?? null;
  if (r.type === "grouped") return null;
  if (col === "qty") return r.qty ?? null;
  if (col === "salableQty") return mgSalable.get(sku) ?? null;
  if (col === "preOrderDate") return r.preOrderDate || null;
  const style = mgProductStyles({ sku, type: r.type })[0]; // js/magento.js
  if (!style) return null;
  if (col === "n41Avail") return /^\d{4}-\d{2}/.exec(style.availableDate ?? "")?.[0] ?? null;
  return numOrNull(style[MG_N41_QTY[col]]);
}

/** Its filter choice: a month, In / Out of Stock, or above / at / below 0. */
function mgLocalFilterKey(col, v) {
  if (col === "stockStatus") return v === true ? "in" : v === false ? "out" : "unknown";
  if (col === "n41Avail" || col === "preOrderDate") return v ? String(v).slice(0, 7) : "";
  return v === null || v === 0 ? "zero" : v > 0 ? "pos" : "neg";
}

const MG_LOCAL_BUCKETS = { pos: "Above 0", zero: "– (0 or blank)", neg: "Below 0", in: "In Stock", out: "Out of Stock", unknown: "Not known" };

/** The choices for a column's filter — only values some product has, with how many. */
function mgLocalFilterOptions(col) {
  if (!mgIndex) return [];
  const counts = new Map();
  mgIndex.forEach((r, sku) => {
    if (r.type === "grouped" && col !== "stockStatus") return;
    const key = mgLocalFilterKey(col, mgLocalValue(col, sku, r));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const dated = col === "n41Avail" || col === "preOrderDate";
  const keys = dated
    ? [...counts.keys()].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b))
    : Object.keys(MG_LOCAL_BUCKETS).filter(k => counts.has(k));
  return keys.map(key => ({
    key,
    label: dated ? (key ? formatMonYY(key) : col === "n41Avail" ? "No month" : "No date") : MG_LOCAL_BUCKETS[key],
    count: counts.get(key),
  }));
}

function mgLocalFilters() {
  return MG_LOCAL_COLS.map(col => [col, getColumnFilterSelection("mgProductsTable", col)]).filter(([, keys]) => keys);
}

function passesMgLocalFilters(sku) {
  const r = mgIndex?.get(sku);
  return mgLocalFilters().every(([col, keys]) => {
    if (!r || (r.type === "grouped" && col !== "stockStatus")) return false;
    return keys.includes(mgLocalFilterKey(col, mgLocalValue(col, sku, r)));
  });
}

function isMgLocalSort() {
  return MG_LOCAL_COLS.includes(mgQuery.sort);
}

/** Sort SKUs by one of those columns; blanks last whichever way it runs. */
function sortMgSkusLocally(skus) {
  const col = mgQuery.sort;
  const dir = mgQuery.dir === "DESC" ? -1 : 1;
  const values = new Map(skus.map(sku => [sku, mgLocalValue(col, sku)]));
  const blank = v => v === null || v === undefined || v === "";
  return [...skus].sort((x, y) => {
    const a = values.get(x);
    const b = values.get(y);
    if (blank(a) || blank(b)) return blank(a) - blank(b) || x.localeCompare(y);
    return dir * (a < b ? -1 : a > b ? 1 : 0) || x.localeCompare(y);
  });
}

/** Exact N41-unit thresholds requested, independent of the product's pack size. */
function mgN41AvailabilityMismatch(sku) {
  const product = mgIndex?.get(sku);
  if (!product || product.type === "grouped" || mgDuplicateSkus.has(sku)) return false;
  const ats = numOrNull(mgProductStyles({ ...product, sku })[0]?.ats);
  if (ats === null) return false;
  const { available } = mgAvailability(sku);
  return (ats <= 0 && available === true) || (ats >= 6 && available === false);
}

function hasMgClientFilter() {
  return Boolean(mgAvailFilter || mgFlaggedOnly || mgAtsMismatchOnly || mgAvailableNoPictureOnly || mgN41AvailabilityMismatchOnly || isMgLocalSort() || mgLocalFilters().length);
}

function passesMgClientFilter(sku) {
  if (!passesMgLocalFilters(sku)) return false;
  if (mgFlaggedOnly && !isMgFlagged(sku)) return false;
  if (mgAtsMismatchOnly && mgAtsComparison({ ...mgIndex?.get(sku), sku }).state !== "mismatch") return false;
  if (mgAvailableNoPictureOnly && !mgAvailableNoPicture(sku)) return false;
  if (mgN41AvailabilityMismatchOnly && !mgN41AvailabilityMismatch(sku)) return false;
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
  if (mgIndexIsFull() && !mgDuplicateSkus.size) {
    const skus = mgLocalSkus().filter(passesMgClientFilter);
    return isMgLocalSort() ? sortMgSkusLocally(skus) : skus;
  }
  // Otherwise (an older helper's catalog) Magento lists the SKUs.
  const { page, pageSize, ...rest } = mgQuery;
  const key = JSON.stringify(rest);
  if (mgSkuListCache.key !== key || !mgSkuListCache.skus) {
    mgSkuListCache = { key, skus: await callMagento("skuList", rest) };
  }
  const skus = mgSkuListCache.skus.filter(passesMgClientFilter);
  return isMgLocalSort() ? sortMgSkusLocally(skus) : skus;
}

/** One page of products by SKU, in the order given. */
async function loadMgProductsBySku(skus) {
  if (!skus.length) return [];
  // The SKUs were already picked with the filters, so only they are sent.
  const res = await callMagento("products", { ...mgQuery, ...mgStockParams(), page: 1, pageSize: skus.length, skus });
  const items = res?.items ?? [];
  rememberMgProducts(items);
  const order = new Map(skus.map((sku, i) => [sku, i]));
  return items.sort((a, b) => order.get(a.sku) - order.get(b.sku) || Number(a.id) - Number(b.id));
}

/** The page wanted, when a filter Magento can't apply is on. */
async function loadMgClientFilteredPage() {
  const skus = await mgFilteredSkus();
  const from = (mgQuery.page - 1) * mgQuery.pageSize;
  if (mgDuplicateSkus.size) {
    // SKU-based filters can match several IDs. Page the actual records so
    // duplicate records cannot disappear at a page boundary or skew totals.
    const uniqueSkus = [...new Set(skus)];
    const records = new Map();
    for (let i = 0; i < uniqueSkus.length; i += 200) {
      for (const p of await loadMgProductsBySku(uniqueSkus.slice(i, i + 200))) records.set(mgProductKey(p), p);
    }
    const items = [...records.values()];
    return { items: items.slice(from, from + mgQuery.pageSize), total: items.length, page: mgQuery.page, pageSize: mgQuery.pageSize };
  }
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
  const atsButton = document.getElementById("mgAtsMismatchBtn");
  if (atsButton) {
    const count = mgIndex ? [...mgIndex].filter(([sku, p]) => mgAtsComparison({ ...p, sku }).state === "mismatch").length : null;
    atsButton.classList.toggle("active", mgAtsMismatchOnly);
    atsButton.textContent = count === null ? "ATS mismatches" : `ATS mismatches (${count.toLocaleString()})`;
    atsButton.title = "Compare N41 units with Magento ATS packs using the product or parent Prepack ratio. Counts update as ATS loads; missing pack data is marked Check pack.";
  }
  const noPictureButton = document.getElementById("mgAvailableNoPictureBtn");
  if (noPictureButton) {
    const count = mgIndex ? [...mgIndex.keys()].filter(sku => mgAvailableNoPicture(sku)).length : null;
    noPictureButton.classList.toggle("active", mgAvailableNoPictureOnly);
    noPictureButton.textContent = count === null ? "Available, no picture" : `Available, no picture (${count.toLocaleString()})`;
    noPictureButton.title = "Available Simple products with no assigned product image or a failed image. Unknown availability is excluded.";
  }
  const n41AvailabilityButton = document.getElementById("mgN41AvailabilityMismatchBtn");
  if (n41AvailabilityButton) {
    const count = mgIndex ? [...mgIndex.keys()].filter(mgN41AvailabilityMismatch).length : null;
    n41AvailabilityButton.classList.toggle("active", mgN41AvailabilityMismatchOnly);
    n41AvailabilityButton.textContent = count === null ? "N41 availability mismatch" : `N41 availability mismatch (${count.toLocaleString()})`;
    n41AvailabilityButton.title = "N41 ATS ≤ 0 and Available, OR N41 ATS ≥ 6 units and Not available. Unknown ATS/availability and grouped parents are excluded.";
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
  if ("atsMismatch" in changes) mgAtsMismatchOnly = changes.atsMismatch;
  if ("availableNoPicture" in changes) mgAvailableNoPictureOnly = changes.availableNoPicture;
  if ("n41AvailabilityMismatch" in changes) mgN41AvailabilityMismatchOnly = changes.n41AvailabilityMismatch;
  renderMgAvailControls();
  setMgQuery({});
}

function initMagentoAvailability() {
  document.querySelectorAll("#mgAvailFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => setMgClientFilter({ avail: btn.dataset.avail }));
  });
  document.getElementById("mgFlaggedBtn")?.addEventListener("click", () => setMgClientFilter({ flagged: !mgFlaggedOnly }));
  document.getElementById("mgAvailableNoPictureBtn")?.addEventListener("click", () => setMgClientFilter({ availableNoPicture: !mgAvailableNoPictureOnly }));
  document.getElementById("mgN41AvailabilityMismatchBtn")?.addEventListener("click", () => setMgClientFilter({ n41AvailabilityMismatch: !mgN41AvailabilityMismatchOnly }));
  document.getElementById("mgAtsMismatchBtn")?.addEventListener("click", () => setMgClientFilter({ atsMismatch: !mgAtsMismatchOnly }));
  renderMgAvailControls();
}

// ── On Styles: Magento Status (js/styles.js, js/style-pane.js) ───────────────
//
// A colour's Magento item is the SKU "STYLE#-COLOR" (T3201-BLACK), or with
// ST after the Style # (T2692ST-BLUE). Its availability is worked out as on
// the Magento tab: last time's catalog shows at once, the imported groups
// load, and a fresh check runs once behind them.

let styleMgStarted = false;

/** The colour's Magento SKU; "" when Magento has none; null before the catalog is known. */
function styleMgSku(style) {
  if (!mgIndex) return null;
  const styleNo = String(style.styleNo ?? "").trim().toUpperCase();
  const color = String(style.color ?? "").trim().toUpperCase();
  return [`${styleNo}-${color}`, `${styleNo}ST-${color}`].find(sku => mgIndex.has(sku)) ?? "";
}

/** { sku, available: true | false | null, reasons } — sku "" when it isn't on Magento. */
function styleMgAvailability(style) {
  const sku = styleMgSku(style);
  if (sku === null) return { sku: null, available: null, reasons: [mgIndexError || "Checking Magento…"] };
  if (!sku) return { sku: "", available: false, reasons: ["Not on Magento"] };
  return { sku, ...mgAvailability(sku) };
}

/** For sorting and the column: "Available", "Not available", "Not on Magento" or "". */
function styleMgStatusText(style) {
  const { sku, available } = styleMgAvailability(style);
  if (sku === "") return "Not on Magento";
  return available === true ? "Available" : available === false ? "Not available" : "";
}

/** Known ATS at or below zero, while Magento still shows the colour as available. */
function styleAtsAvailableMismatch(style, availability = styleMgAvailability(style)) {
  const ats = numOrNull(style.ats);
  return ats !== null && ats <= 0 && Boolean(availability.sku) && availability.available === true;
}

/** Known ATS and OH of at least six, while the Magento colour is not available. */
function styleAtsUnavailableMismatch(style, availability = styleMgAvailability(style)) {
  const ats = numOrNull(style.ats);
  const oh = numOrNull(style.oh);
  return ats !== null && ats >= 6 && oh !== null && oh >= 6 && Boolean(availability.sku) && availability.available === false;
}

/** Linked Magento products with no assigned photo, regardless of availability. */
function styleMagentoMissingPhoto(style) {
  const sku = styleMgSku(style);
  if (!sku || mgDuplicateSkus.has(sku)) return false;
  const image = mgIndex?.get(sku)?.image;
  // Older catalogs omit image information; don't treat unknowns as missing.
  if (image === undefined || image === null) return false;
  return !String(image).trim() || String(image).trim() === "no_selection";
}

/** The Magento Status pill — why not, and the SKU, in its tooltip. */
function createStyleMgStatusCell(style) {
  const { sku, available, reasons } = styleMgAvailability(style);
  const wrap = document.createElement("span");
  wrap.className = "mg-avail-cell style-mg-status";
  const pill = document.createElement("span");
  if (sku === "") {
    // Not on Magento: just a dash (the tooltip says so).
    pill.className = "mg-avail-pill is-none";
    pill.textContent = EMPTY_DISPLAY;
    wrap.title = `Not on Magento — no product ${String(style.styleNo).trim().toUpperCase()}-${String(style.color).trim().toUpperCase()}`;
  } else {
    pill.className = `mg-avail-pill ${available === true ? "is-yes" : available === false ? "is-no" : "is-unknown"}`;
    pill.textContent = available === true ? "Available" : available === false ? "Not available" : "?";
    const head = available === true ? "Showing on the webstore" : available === false ? "Not showing on the webstore" : "Can't tell yet";
    wrap.title = (sku ? `${sku} — ` : "") + head + (reasons.length && available !== true ? `: ${reasons.join("; ")}` : "");
  }
  if (styleAtsAvailableMismatch(style, { sku, available })) {
    pill.classList.add("is-ats-mismatch");
    wrap.title += ` — ATS ${numOrNull(style.ats)}: should not be available`;
  }
  if (styleAtsUnavailableMismatch(style, { sku, available })) {
    pill.classList.add("is-ats-mismatch");
    wrap.title += ` — ATS ${numOrNull(style.ats)}, OH ${numOrNull(style.oh)}: should be available`;
  }
  wrap.appendChild(pill);
  return wrap;
}

/** Once a session: last time's catalog, the groups, then a fresh check. */
function ensureStyleMgAvailability() {
  if (styleMgStarted) return;
  styleMgStarted = true;
  restoreMgIndexCache();
  const hadCatalog = Boolean(mgIndex);
  const groups = mgGroups ? Promise.resolve() : loadMagentoGroups();
  groups.then(() => refreshStyleMgViews({ pane: true }));
  // Without a catalog from before, Magento may not be set up — the Magento
  // tab checks it then; the column waits.
  if (hadCatalog && !mgIndexLoading) loadMgIndex();
}

/** Redraw what shows Magento Status: the Styles table, and the pane when asked (not mid-typing). */
function refreshStyleMgViews({ pane = false } = {}) {
  if (!styleMgStarted) return;
  if (getCurrentAppView() === "styles") {
    if (styleSortCol === "magento" || styleAtsAvailableOnly || styleAtsUnavailableOnly || styleMagentoNoPhotoOnly) applyStyleFilters({ keepShown: true });
    else renderStylesTable();
  }
  const paneEl = document.getElementById("stylePane");
  if (pane && paneEl && !paneEl.hidden && !paneEl.contains(document.activeElement)) refreshStylePaneSummary();
}
