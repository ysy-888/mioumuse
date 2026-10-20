/**
 * Magento helper — the app's only way to the Magento 2 store.
 *
 * The admin token can't live in the app's public code, and Magento won't
 * answer cross-site requests from a web page anyway, so the app calls this
 * function instead. The store's address and token stay here, read from the
 * MAGENTO_BASE_URL and MAGENTO_ACCESS_TOKEN secrets.
 *
 * The token is an Integration's access token (Magento admin → System →
 * Extensions → Integrations → Add New Integration, give it Catalog →
 * Inventory → Products and Categories, Activate, copy "Access Token").
 * For it to work as a bearer token, Stores → Configuration → Services →
 * OAuth → Consumer Settings → "Allow OAuth Access Tokens to be used as
 * standalone Bearer tokens" must be Yes (Magento 2.4.4+).
 *
 * Every request must come from a signed-in user of the app (checked below).
 * Body: { action, ...params }. Replies: { data } or { error } (with status).
 *
 * Actions
 *   status                          is it connected, and which store
 *   categories                      the whole category tree, flattened
 *   products   { page, pageSize, sort, dir, search, status, type,
 *                visibility, categoryId, skus?, withStock? }
 *                                   withStock: false leaves qty / Stock
 *                                   Status out (the app has them already)
 *                                   one page of products; status, type,
 *                                   visibility and categoryId each take
 *                                   one value or a list (any matches)
 *   skuList    { …products filters } every matching SKU, in sort order
 *   catalogIndex                    every product's [sku, type, status,
 *                                   visibility, qty, inStock], for
 *                                   working out availability
 *   facets                          product counts per status, type and
 *                                   visibility value (for the filters)
 *   colorOptions                    Color's choices { options, problem }
 *   product    { sku }              one product, with its content fields
 *   update     { sku, changes }     save a product's fields (below)
 *   bulk       { skus, op, categoryId? }
 *                                   op: enable | disable | addCategory | removeCategory
 *   category   { id, changes }      changes: { name?, isActive? }
 *
 * Product changes the app sends:
 *   name, price, specialPrice, status (1 | 2), visibility (1–4), weight,
 *   colorId (the Color option's id; "" clears it),
 *   categoryIds (the full list — replaces what's there), description,
 *   shortDescription, urlKey, metaTitle, metaDescription
 *
 * Saves go to the "all" store scope — the admin's default values, the same
 * as editing with "Default Store View" unchosen in the Magento admin.
 *
 * Deploy: supabase functions deploy magento --project-ref <ref> --use-api
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { AsyncLocalStorage } from "node:async_hooks";

// The store's address only — anything from "/rest" on (pasted from an API
// URL) is dropped, so "https://shop.com/rest/V1" still works.
/**
 * This file's version — sent with every reply, so the app can tell when the
 * copy running in Supabase is older than the app expects. Bump it (and
 * MG_HELPER_VERSION in js/magento.js) whenever this file changes.
 */
const HELPER_VERSION = "2026-10-20.7";

/**
 * Where a request's time went: each Magento call is counted and timed, per
 * request (AsyncLocalStorage keeps requests running side by side apart).
 */
type Timing = { magentoCalls: number; magentoMs: number; slowestMs: number; slowest: string };
const timingStore = new AsyncLocalStorage<Timing>();

const BASE = (Deno.env.get("MAGENTO_BASE_URL") ?? "").trim().replace(/\/rest(\/.*)?$/i, "").replace(/\/+$/, "");
const TOKEN = Deno.env.get("MAGENTO_ACCESS_TOKEN") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Magento's messages carry %1-style placeholders, filled from `parameters`. */
// deno-lint-ignore no-explicit-any
function magentoMessage(body: any) {
  let message = String(body?.message ?? "");
  const params = body?.parameters;
  if (Array.isArray(params)) params.forEach((v, i) => (message = message.replaceAll(`%${i + 1}`, String(v))));
  else if (params && typeof params === "object") Object.entries(params).forEach(([k, v]) => (message = message.replaceAll(`%${k}`, String(v))));
  return message;
}

/**
 * One Magento REST call. `scope` is the store code in the URL: none for
 * reads (the default store view, what shoppers see — whatever its code is),
 * "all" for saves.
 */
async function mg(path: string, init: RequestInit = {}, scope = "") {
  const started = performance.now();
  try {
    return await mgCall(path, init, scope);
  } finally {
    const t = timingStore.getStore();
    if (t) {
      const ms = performance.now() - started;
      t.magentoCalls += 1;
      t.magentoMs += ms;
      if (ms > t.slowestMs) {
        t.slowestMs = ms;
        t.slowest = path.split("?")[0];
      }
    }
  }
}

async function mgCall(path: string, init: RequestInit, scope: string) {
  const res = await fetch(`${BASE}/rest/${scope ? `${scope}/` : ""}V1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // An HTML error page from the web server rather than Magento.
    if (res.status === 414) throw new UserError("The request to Magento was too long for its web server (414).", 502);
    if (!res.ok) throw new UserError(`Magento answered ${res.status} without JSON — check MAGENTO_BASE_URL.`, 502);
  }
  if (!res.ok) {
    const message = magentoMessage(body) || `Magento error ${res.status}`;
    if (res.status === 401) throw new UserError(`Magento refused the token: ${message}`, 502);
    throw new UserError(message, res.status === 404 ? 404 : 502);
  }
  return body;
}

/**
 * A long SKU list as small batches. Each SKU in a search adds three query
 * parameters (~200 characters); 50 of them made a ~15,000-character web
 * address, too long for the store's web server (414 — the usual limit is
 * 8,000). 10 at a time stays near 4,000 even with every filter on.
 */
const SKU_BATCH = 10;

function skuBatches(skus: string[]) {
  const out: string[][] = [];
  for (let i = 0; i < skus.length; i += SKU_BATCH) out.push(skus.slice(i, i + SKU_BATCH));
  return out;
}

/**
 * Every page of a product search: the first says how many there are, then
 * the rest are fetched side by side (a few at a time) rather than in turn.
 */
// deno-lint-ignore no-explicit-any
async function allProductPages(query: (page: number) => URLSearchParams, pageSize: number, limit = 4): Promise<any[]> {
  const first = await mg(`/products?${query(1)}`);
  const total = Number(first?.total_count ?? 0);
  const pages = Math.min(Math.ceil(total / pageSize), 50);
  const rest = await eachLimited(Array.from({ length: Math.max(pages - 1, 0) }, (_, i) => i + 2), limit,
    page => mg(`/products?${query(page)}`));
  return [first, ...rest].flatMap(b => b?.items ?? []);
}

/** Run `fn` over `items`, a few at a time, so a big batch doesn't swamp the store. */
async function eachLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

// ── Products ─────────────────────────────────────────────────────────────────

const LIST_FIELDS = [
  "id", "sku", "name", "price", "status", "visibility", "type_id",
  "created_at", "updated_at", "custom_attributes",
  "extension_attributes[category_links,stock_item[qty,is_in_stock]]",
  // A grouped product's simple items are its "associated" links — enabled
  // ones only (Magento's API leaves disabled items out). The app uses the
  // imported export's groups instead when it has them (js/magento-groups.js).
  "product_links[link_type,linked_product_sku,linked_product_type,position]",
].join(",");

// ── Color ────────────────────────────────────────────────────────────────────
//
// Color is a dropdown attribute: a product stores the option's id ("49"),
// not its name ("Black"). The names come from the attribute's options, tried
// in turn until one answers:
//   1. the admin API — needs the integration to have Stores → Attributes →
//      Product (the most reliable);
//   2. the storefront's GraphQL, which needs no token — the 2.4.7+ query,
//      then the older one.
// The answer is kept for 10 minutes — a failed lookup too: trying all three
// again on every page added three failing calls to each one. The tab's own
// colorOptions call (on open and on Refresh) always asks afresh, so fixing
// the permission takes effect on the next Refresh. `colorProblem` says why
// the names couldn't be found, for the app to show.

type ColorOption = { value: string; label: string };
let colorCache: { options: ColorOption[]; at: number } | null = null;
let colorProblem = "";

// deno-lint-ignore no-explicit-any
function toColorOptions(rows: any[]): ColorOption[] {
  return (rows ?? [])
    .map(o => ({ value: String(o?.value ?? ""), label: String(o?.label ?? "").trim() }))
    // Magento lists a blank "no value" option first.
    .filter(o => o.value !== "" && o.label !== "");
}

async function storefrontGraphql(query: string) {
  const res = await fetch(`${BASE}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.errors?.length) throw new Error(body?.errors?.[0]?.message || `GraphQL answered ${res.status}`);
  return body.data;
}

async function getColorOptions({ fresh = false } = {}): Promise<ColorOption[]> {
  if (!fresh && colorCache && Date.now() - colorCache.at < 10 * 60 * 1000) return colorCache.options;
  const attempts: [string, () => Promise<ColorOption[]>][] = [
    ["admin API", async () => toColorOptions(await mg("/products/attributes/color/options"))],
    ["storefront GraphQL", async () => {
      const data = await storefrontGraphql('{ customAttributeMetadataV2(attributes: [{ attribute_code: "color", entity_type: "catalog_product" }]) { items { options { label value } } } }');
      return toColorOptions(data?.customAttributeMetadataV2?.items?.[0]?.options);
    }],
    ["storefront GraphQL (older)", async () => {
      const data = await storefrontGraphql('{ customAttributeMetadata(attributes: [{ attribute_code: "color", entity_type: "catalog_product" }]) { items { attribute_options { label value } } } }');
      return toColorOptions(data?.customAttributeMetadata?.items?.[0]?.attribute_options);
    }],
  ];
  const why: string[] = [];
  for (const [source, run] of attempts) {
    try {
      const options = await run();
      if (options.length) {
        colorCache = { options, at: Date.now() };
        colorProblem = "";
        return options;
      }
      why.push(`${source}: no options`);
    } catch (err) {
      why.push(`${source}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  colorProblem = `Couldn't read Color's names (${why.join("; ")}). In Magento, give the integration Stores → Attributes → Product access, then Refresh.`;
  colorCache = { options: [], at: Date.now() };
  return [];
}

async function getColorNames() {
  return new Map((await getColorOptions()).map(o => [o.value, o.label]));
}

/** The columns the app sorts by, and Magento's names for them. */
const SORT_FIELDS: Record<string, string> = {
  name: "name",
  sku: "sku",
  price: "price",
  status: "status",
  visibility: "visibility",
  type: "type_id",
  updatedAt: "updated_at",
  createdAt: "created_at",
};

// deno-lint-ignore no-explicit-any
function customAttr(p: any, code: string) {
  // deno-lint-ignore no-explicit-any
  return (p.custom_attributes ?? []).find((a: any) => a.attribute_code === code)?.value ?? null;
}

/** The shape the app works with. `colors` turns Color option ids into names. */
// deno-lint-ignore no-explicit-any
function summarize(p: any, colors: Map<string, string>) {
  const stock = p.extension_attributes?.stock_item;
  const special = customAttr(p, "special_price");
  const colorId = customAttr(p, "color");
  return {
    id: p.id,
    sku: p.sku,
    name: p.name ?? "",
    type: p.type_id ?? "",
    // A text Color attribute (no options) is shown as it is.
    colorId: colorId === null ? "" : String(colorId),
    color: colorId === null || colorId === "" ? "" : colors.get(String(colorId)) ?? String(colorId),
    childSkus: (p.product_links ?? [])
      // deno-lint-ignore no-explicit-any
      .filter((l: any) => l.link_type === "associated")
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
      // deno-lint-ignore no-explicit-any
      .map((l: any) => String(l.linked_product_sku)),
    price: p.price ?? null,
    specialPrice: special === null || special === "" ? null : Number(special),
    status: Number(p.status ?? 0),
    visibility: Number(p.visibility ?? 0),
    // deno-lint-ignore no-explicit-any
    categoryIds: (p.extension_attributes?.category_links ?? []).map((l: any) => String(l.category_id)),
    qty: stock ? Number(stock.qty ?? 0) : null,
    inStock: stock ? Boolean(stock.is_in_stock) : null,
    image: customAttr(p, "thumbnail") || customAttr(p, "small_image") || customAttr(p, "image") || "",
    urlKey: customAttr(p, "url_key") ?? "",
    createdAt: p.created_at ?? "",
    updatedAt: p.updated_at ?? "",
  };
}

/** The extra fields the side pane edits. */
// deno-lint-ignore no-explicit-any
function detail(p: any, colors: Map<string, string>) {
  return {
    ...summarize(p, colors),
    weight: p.weight ?? null,
    description: customAttr(p, "description") ?? "",
    shortDescription: customAttr(p, "short_description") ?? "",
    metaTitle: customAttr(p, "meta_title") ?? "",
    metaDescription: customAttr(p, "meta_description") ?? "",
  };
}

/**
 * searchCriteria as query parameters. Filters in one group are OR'd, groups
 * are AND'd — so the search box (SKU or name) is one group of its own.
 */
function buildSearchCriteria(p: Record<string, unknown>) {
  const q = new URLSearchParams();
  let group = 0;
  const add = (filters: [string, string, string][]) => {
    filters.forEach(([field, value, cond], i) => {
      q.set(`searchCriteria[filter_groups][${group}][filters][${i}][field]`, field);
      q.set(`searchCriteria[filter_groups][${group}][filters][${i}][value]`, value);
      q.set(`searchCriteria[filter_groups][${group}][filters][${i}][condition_type]`, cond);
    });
    group++;
  };

  const search = String(p.search ?? "").trim();
  if (search) add([["sku", `%${search}%`, "like"], ["name", `%${search}%`, "like"]]);

  // Each of these takes one value or several (any of them matches).
  const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);
  const anyOf = (field: string, values: string[]) => {
    if (values.length) add(values.map(v => [field, v, "eq"] as [string, string, string]));
  };
  anyOf("status", list(p.status));
  anyOf("type_id", list(p.type));
  anyOf("visibility", list(p.visibility));
  // Magento ANDs several category filters even inside one group, so
  // categories go as a single "in" list instead.
  const categories = list(p.categoryId);
  if (categories.length) add([["category_id", categories.join(","), "in"]]);
  // Exactly these SKUs — a page the app picked itself (availability, flags).
  anyOf("sku", list(p.skus).slice(0, 200));

  // Unsorted means most recently updated first.
  const sort = SORT_FIELDS[String(p.sort ?? "")] ?? "updated_at";
  const dir = SORT_FIELDS[String(p.sort ?? "")] ? (p.dir === "DESC" ? "DESC" : "ASC") : "DESC";
  q.set("searchCriteria[sortOrders][0][field]", sort);
  q.set("searchCriteria[sortOrders][0][direction]", dir);
  // Ties: the same name puts the Grouped item first ("grouped" sorts before
  // "simple"), whichever way the main sort runs; then by SKU, so the order
  // is the same every time.
  if (sort !== "type_id") {
    q.set("searchCriteria[sortOrders][1][field]", "type_id");
    q.set("searchCriteria[sortOrders][1][direction]", "ASC");
  }
  q.set(`searchCriteria[sortOrders][${sort !== "type_id" ? 2 : 1}][field]`, "sku");
  q.set(`searchCriteria[sortOrders][${sort !== "type_id" ? 2 : 1}][direction]`, "ASC");

  const pageSize = Math.min(Math.max(Number(p.pageSize) || 50, 1), 200);
  q.set("searchCriteria[pageSize]", String(pageSize));
  q.set("searchCriteria[currentPage]", String(Math.max(Number(p.page) || 1, 1)));
  return { query: q, pageSize };
}

/** The product payload for a save, from the app's change names. */
function buildProductPayload(sku: string, c: Record<string, unknown>) {
  // deno-lint-ignore no-explicit-any
  const product: any = { sku };
  const custom: { attribute_code: string; value: unknown }[] = [];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(c, k);

  if (has("name")) {
    const name = String(c.name ?? "").trim();
    if (!name) throw new UserError("A product needs a name.");
    product.name = name;
  }
  if (has("price")) {
    const price = Number(c.price);
    if (!Number.isFinite(price) || price < 0) throw new UserError("Price must be a number, 0 or more.");
    product.price = price;
  }
  if (has("status")) {
    if (![1, 2].includes(Number(c.status))) throw new UserError("Status is 1 (enabled) or 2 (disabled).");
    product.status = Number(c.status);
  }
  if (has("visibility")) {
    if (![1, 2, 3, 4].includes(Number(c.visibility))) throw new UserError("Unknown visibility.");
    product.visibility = Number(c.visibility);
  }
  if (has("weight")) product.weight = c.weight === null || c.weight === "" ? null : Number(c.weight);
  // The Color option's id; blank clears it.
  if (has("colorId")) custom.push({ attribute_code: "color", value: c.colorId === null ? "" : String(c.colorId) });
  if (has("categoryIds")) {
    const ids = Array.isArray(c.categoryIds) ? c.categoryIds : [];
    product.extension_attributes = {
      category_links: ids.map((id, position) => ({ position, category_id: String(id) })),
    };
  }
  // Blank special price clears it.
  if (has("specialPrice")) custom.push({ attribute_code: "special_price", value: c.specialPrice === null || c.specialPrice === "" ? "" : Number(c.specialPrice) });
  const text: Record<string, string> = {
    description: "description",
    shortDescription: "short_description",
    urlKey: "url_key",
    metaTitle: "meta_title",
    metaDescription: "meta_description",
  };
  Object.entries(text).forEach(([key, code]) => {
    if (has(key)) custom.push({ attribute_code: code, value: String(c[key] ?? "") });
  });
  if (custom.length) product.custom_attributes = custom;
  return product;
}

async function getProduct(sku: string) {
  return mg(`/products/${encodeURIComponent(sku)}`);
}

// ── Stock ────────────────────────────────────────────────────────────────────
//
// The product list doesn't carry stock on this Magento (its stock_item comes
// back empty), so quantity and Stock Status (In Stock / Out of Stock — set
// on its own in Magento, not worked out from qty) are asked for separately:
//   Simple   1. Inventory source items (MSI) — a few short calls for the
//               page (10 SKUs each), side by side; qty is the total across
//               sources, in stock if any source is.
//            2. Failing that, each product's legacy stock item.
//   Grouped  no qty of its own, but its own Stock Status — from its legacy
//            stock item (MSI keeps none for grouped products).

type Stocked = { sku: string; type: string; qty: number | null; inStock: boolean | null };

async function addStock<T extends Stocked>(items: T[]): Promise<T[]> {
  const grouped = items.filter(p => p.type === "grouped" && p.inStock === null);
  await Promise.all([
    addSimpleStock(items.filter(p => p.type !== "grouped" && p.qty === null)),
    eachLimited(grouped, 8, async p => {
      try {
        p.inStock = Boolean((await mg(`/stockItems/${encodeURIComponent(p.sku)}`))?.is_in_stock);
      } catch {
        /* left unknown */
      }
    }),
  ]);
  return items;
}

async function addSimpleStock(need: Stocked[]) {
  if (!need.length) return;
  const bySku = new Map(need.map(p => [p.sku, p]));

  try {
    // Any of these SKUs (one filter group = OR) — in short batches, at once.
    const bodies = await Promise.all(skuBatches(need.map(p => p.sku)).map(batch => {
      const q = new URLSearchParams();
      batch.forEach((sku, i) => {
        q.set(`searchCriteria[filter_groups][0][filters][${i}][field]`, "sku");
        q.set(`searchCriteria[filter_groups][0][filters][${i}][value]`, sku);
        q.set(`searchCriteria[filter_groups][0][filters][${i}][condition_type]`, "eq");
      });
      q.set("searchCriteria[pageSize]", String(batch.length * 20));
      return mg(`/inventory/source-items?${q}`);
    }));
    const found = new Set<string>();
    // deno-lint-ignore no-explicit-any
    bodies.flatMap(b => b?.items ?? []).forEach((s: any) => {
      const p = bySku.get(String(s.sku));
      if (!p) return;
      found.add(p.sku);
      p.qty = (p.qty ?? 0) + Number(s.quantity ?? 0);
      p.inStock = Boolean(p.inStock) || Number(s.status) === 1;
    });
    // A SKU with no source rows has nothing in stock.
    need.forEach(p => {
      if (!found.has(p.sku)) {
        p.qty = 0;
        p.inStock = false;
      }
    });
    return;
  } catch {
    // No MSI (or not allowed): the legacy stock item, per product.
  }

  await eachLimited(need, 8, async p => {
    try {
      const s = await mg(`/stockItems/${encodeURIComponent(p.sku)}`);
      p.qty = Number(s?.qty ?? 0);
      p.inStock = Boolean(s?.is_in_stock);
    } catch {
      /* left unknown */
    }
  });
}

/**
 * Every product's stock at once, for the catalog index: Magento's low-stock
 * list with a ceiling no product reaches (all stock items, keyed by product
 * id — grouped products included), or failing that the inventory source
 * items (keyed by SKU — Simple items only).
 */
type StockEntry = { qty: number; inStock: boolean };

async function catalogStock(): Promise<{ stockFrom: string; byId?: Map<string, StockEntry>; bySku?: Map<string, StockEntry> }> {
  try {
    const byId = new Map<string, StockEntry>();
    for (let page = 1; page <= 20; page++) {
      const q = new URLSearchParams({ scopeId: "0", qty: "1000000000", pageSize: "5000", currentPage: String(page) });
      const items = (await mg(`/stockItems/lowStock/?${q}`))?.items ?? [];
      // Some versions send only the qty here — then this list is no use.
      // deno-lint-ignore no-explicit-any
      if (items.length && items.some((s: any) => s.product_id === undefined || s.is_in_stock === undefined)) {
        throw new Error("stock items without product or status");
      }
      // deno-lint-ignore no-explicit-any
      items.forEach((s: any) => byId.set(String(s.product_id), { qty: Number(s.qty ?? 0), inStock: Boolean(s.is_in_stock) }));
      if (items.length < 5000) break;
    }
    if (!byId.size) throw new Error("no stock items");
    return { stockFrom: "stock items", byId };
  } catch {
    const bySku = new Map<string, StockEntry>();
    const q = new URLSearchParams({ "searchCriteria[pageSize]": "100000" });
    // deno-lint-ignore no-explicit-any
    ((await mg(`/inventory/source-items?${q}`))?.items ?? []).forEach((s: any) => {
      const now = bySku.get(String(s.sku)) ?? { qty: 0, inStock: false };
      bySku.set(String(s.sku), { qty: now.qty + Number(s.quantity ?? 0), inStock: now.inStock || Number(s.status) === 1 });
    });
    return { stockFrom: "inventory sources", bySku };
  }
}

// ── Categories ───────────────────────────────────────────────────────────────

type CategoryRow = {
  id: string; parentId: string; name: string; path: string;
  level: number; isActive: boolean; productCount: number; position: number;
};

/** Depth-first, so the list reads as the tree does. The root catalog is left out. */
// deno-lint-ignore no-explicit-any
function flattenTree(node: any, parents: string[], out: CategoryRow[]) {
  const level = Number(node.level ?? 0);
  const name = String(node.name ?? "");
  // Level 0 is Magento's invisible root; level 1 is each store's root catalog.
  const trail = level >= 1 ? [...parents, name] : parents;
  if (level >= 1) {
    out.push({
      id: String(node.id),
      parentId: String(node.parent_id ?? ""),
      name,
      path: trail.join(" / "),
      level,
      isActive: Boolean(node.is_active),
      productCount: Number(node.product_count ?? 0),
      position: Number(node.position ?? 0),
    });
  }
  // deno-lint-ignore no-explicit-any
  const children = [...(node.children_data ?? [])].sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
  children.forEach(child => flattenTree(child, trail, out));
}

// ── Actions ──────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
const actions: Record<string, (p: any) => Promise<unknown>> = {
  async status() {
    // Reading products proves the address and token; that's all the
    // integration is given access to.
    await mg("/products?searchCriteria[pageSize]=1&fields=total_count");
    // Store settings (media address, currency) need the Stores permission
    // too; without it, the usual defaults do.
    // deno-lint-ignore no-explicit-any
    let configs: any[] = [];
    try {
      configs = (await mg("/store/storeConfigs")) ?? [];
    } catch {
      /* not allowed — fall back */
    }
    // deno-lint-ignore no-explicit-any
    const store = configs.find((c: any) => Number(c.id) === 1) ?? configs[0] ?? {};
    return {
      connected: true,
      baseUrl: store.base_url ?? `${BASE}/`,
      mediaUrl: `${String(store.base_media_url ?? `${BASE}/media/`).replace(/\/+$/, "")}/catalog/product`,
      currency: store.base_currency_code ?? "USD",
      adminUrl: BASE,
    };
  },

  async categories() {
    const tree = await mg("/categories?depth=20");
    const out: CategoryRow[] = [];
    flattenTree(tree, [], out);
    return out;
  },

  async products(params) {
    const colorsLoading = getColorNames();
    // deno-lint-ignore no-explicit-any
    let raw: any[];
    let total: number;
    let pageSize: number;
    const skus = Array.isArray(params.skus) ? params.skus.map(String) : [];
    if (skus.length) {
      // Chosen SKUs: a few short searches at once, not one over-long one.
      const bodies = await Promise.all(skuBatches(skus.slice(0, 200)).map(batch => {
        const { query } = buildSearchCriteria({ ...params, skus: batch, page: 1, pageSize: batch.length });
        query.set("fields", `items[${LIST_FIELDS}],total_count`);
        return mg(`/products?${query}`);
      }));
      raw = bodies.flatMap(b => b?.items ?? []);
      total = raw.length;
      pageSize = skus.length;
    } else {
      const built = buildSearchCriteria(params);
      built.query.set("fields", `items[${LIST_FIELDS}],total_count`);
      const body = await mg(`/products?${built.query}`);
      raw = body?.items ?? [];
      total = Number(body?.total_count ?? 0);
      pageSize = built.pageSize;
    }
    const colors = await colorsLoading;
    const summaries = raw.map(p => summarize(p, colors));
    // Stock costs extra calls (one per Grouped item). The app skips it
    // (withStock: false) when its catalog index already has every product's
    // qty and Stock Status — then a page is one call to Magento.
    const items = params.withStock === false ? summaries : await addStock(summaries);
    return { items, total, page: Math.max(Number(params.page) || 1, 1), pageSize };
  },

  /**
   * How many products have each status, type and visibility — so the
   * header filters list only values that exist. One tiny count query per
   * value, a few at a time.
   */
  /**
   * Every SKU matching the filters, search and sort, in order — for filters
   * Magento can't apply itself (availability, flags): the app picks the
   * SKUs it wants and asks for that page with `skus`.
   */
  async skuList(params) {
    const items = await allProductPages(page => {
      const { query } = buildSearchCriteria({ ...params, skus: [], page, pageSize: 1000 });
      query.set("searchCriteria[pageSize]", "1000");
      query.set("fields", "items[sku],total_count");
      return query;
    }, 1000);
    return items.map(p => String(p.sku));
  },

  /**
   * The whole catalog in brief: each product's
   *   [sku, type, status, visibility, qty, inStock, name, price, updatedAt, categoryIds]
   * — enough for the app to work out availability, and to filter, search and
   * sort by itself when a filter Magento can't apply (Available, Flagged) is
   * on, so it only asks Magento for the page shown. Stock comes in bulk — the
   * stock items of every product at once (Magento's low-stock list, with a
   * ceiling no product reaches), or failing that the inventory source items
   * (Simple items only; Grouped items' Stock Status is then unknown).
   */
  async catalogIndex() {
    // Products and stock side by side — but only two product pages at a
    // time, so the store has room left for the table's own requests.
    const [products, stockResult] = await Promise.all([
      allProductPages(page => new URLSearchParams({
        "searchCriteria[pageSize]": "1000",
        "searchCriteria[currentPage]": String(page),
        fields: "items[id,sku,type_id,status,visibility,name,price,updated_at,extension_attributes[category_links[category_id]]],total_count",
      }), 1000, 2),
      catalogStock(),
    ]);
    const { stockFrom, byId, bySku } = stockResult;

    return {
      stockFrom,
      products: products.map(p => {
        const s = byId?.get(String(p.id)) ?? bySku?.get(String(p.sku));
        const grouped = p.type_id === "grouped";
        return [
          String(p.sku),
          String(p.type_id ?? ""),
          Number(p.status ?? 0),
          Number(p.visibility ?? 0),
          grouped ? null : s ? s.qty : stockFrom === "inventory sources" ? 0 : null,
          s ? s.inStock : grouped || stockFrom !== "inventory sources" ? null : false,
          String(p.name ?? ""),
          p.price ?? null,
          String(p.updated_at ?? ""),
          // deno-lint-ignore no-explicit-any
          (p.extension_attributes?.category_links ?? []).map((l: any) => String(l.category_id)).join(","),
        ];
      }),
    };
  },

  async facets() {
    const fields: Record<string, [string, string[]]> = {
      status: ["status", ["1", "2"]],
      type: ["type_id", ["simple", "configurable", "virtual", "bundle", "grouped", "downloadable"]],
      visibility: ["visibility", ["1", "2", "3", "4"]],
    };
    const jobs = Object.entries(fields).flatMap(([key, [field, values]]) => values.map(value => ({ key, field, value })));
    const counts = await eachLimited(jobs, 4, async ({ field, value }) => {
      const q = new URLSearchParams({
        "searchCriteria[filter_groups][0][filters][0][field]": field,
        "searchCriteria[filter_groups][0][filters][0][value]": value,
        "searchCriteria[filter_groups][0][filters][0][condition_type]": "eq",
        "searchCriteria[pageSize]": "1",
        fields: "total_count",
      });
      return Number((await mg(`/products?${q}`))?.total_count ?? 0);
    });
    const out: Record<string, Record<string, number>> = { status: {}, type: {}, visibility: {} };
    jobs.forEach((job, i) => (out[job.key][job.value] = counts[i]));
    return out;
  },

  /**
   * Color's choices, for the pane: { options: [{ value, label }], problem }.
   * No options with a problem means the names couldn't be read; no options
   * without one means Color isn't a dropdown in this store.
   */
  async colorOptions() {
    // Always asked afresh here (tab open, Refresh) — pages reuse the answer.
    const options = (await getColorOptions({ fresh: true })).sort((a, b) => a.label.localeCompare(b.label));
    return { options, problem: options.length ? "" : colorProblem };
  },

  async product({ sku }) {
    if (!sku) throw new UserError("Which product?");
    const [p, colors] = await Promise.all([getProduct(sku), getColorNames()]);
    return (await addStock([detail(p, colors)]))[0];
  },

  async update({ sku, changes }) {
    if (!sku) throw new UserError("Which product?");
    const colors = await getColorNames();
    if (!changes || typeof changes !== "object" || !Object.keys(changes).length) return (await addStock([detail(await getProduct(sku), colors)]))[0];
    const product = buildProductPayload(sku, changes);
    await mg(`/products/${encodeURIComponent(sku)}`, { method: "PUT", body: JSON.stringify({ product }) }, "all");
    // Read back what Magento actually kept.
    return (await addStock([detail(await getProduct(sku), colors)]))[0];
  },

  /** One change across many products. Each SKU's outcome is reported, so a partial run is visible. */
  async bulk({ skus, op, categoryId }) {
    const list: string[] = Array.isArray(skus) ? [...new Set(skus.map(String))].slice(0, 500) : [];
    if (!list.length) throw new UserError("No products picked.");
    if (["addCategory", "removeCategory"].includes(op) && !categoryId) throw new UserError("Pick a category.");

    const run = async (sku: string) => {
      const s = encodeURIComponent(sku);
      if (op === "enable" || op === "disable") {
        await mg(`/products/${s}`, { method: "PUT", body: JSON.stringify({ product: { sku, status: op === "enable" ? 1 : 2 } }) }, "all");
      } else if (op === "addCategory") {
        await mg(`/categories/${encodeURIComponent(categoryId)}/products`, {
          method: "POST",
          body: JSON.stringify({ productLink: { sku, position: 0, category_id: String(categoryId) } }),
        }, "all");
      } else if (op === "removeCategory") {
        try {
          await mg(`/categories/${encodeURIComponent(categoryId)}/products/${s}`, { method: "DELETE" }, "all");
        } catch (err) {
          // Wasn't in it — nothing to remove.
          if (!(err instanceof UserError && err.status === 404)) throw err;
        }
      } else {
        throw new UserError(`Unknown bulk change "${op}".`);
      }
    };

    const results = await eachLimited(list, 4, async sku => {
      try {
        await run(sku);
        return { sku, ok: true };
      } catch (err) {
        if (err instanceof UserError && err.message.startsWith("Unknown bulk")) throw err;
        return { sku, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
    return { results };
  },

  async category({ id, changes }) {
    if (!id) throw new UserError("Which category?");
    // deno-lint-ignore no-explicit-any
    const category: any = {};
    if (changes?.name !== undefined) {
      const name = String(changes.name).trim();
      if (!name) throw new UserError("A category needs a name.");
      category.name = name;
    }
    if (changes?.isActive !== undefined) category.is_active = Boolean(changes.isActive);
    if (!Object.keys(category).length) throw new UserError("Nothing to change.");
    await mg(`/categories/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ category }) }, "all");
    return { id: String(id) };
  },
};

// ── Entry ────────────────────────────────────────────────────────────────────

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "POST only." }, 405);
  const started = performance.now();

  // Only a signed-in user of the app gets through — the anon key alone isn't enough.
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return reply({ error: "Sign in to use Magento." }, 401);
  const authMs = performance.now() - started;

  if (!BASE || !TOKEN) {
    return reply({ error: "Magento isn't connected yet — add the MAGENTO_BASE_URL and MAGENTO_ACCESS_TOKEN secrets in Supabase." }, 503);
  }

  const t: Timing = { magentoCalls: 0, magentoMs: 0, slowestMs: 0, slowest: "" };
  const timing = () => ({
    version: HELPER_VERSION,
    totalMs: Math.round(performance.now() - started),
    authMs: Math.round(authMs),
    magentoCalls: t.magentoCalls,
    magentoMs: Math.round(t.magentoMs),
    slowestMs: Math.round(t.slowestMs),
    slowest: t.slowest,
  });
  try {
    const { action, ...params } = await req.json();
    const run = actions[action];
    if (!run) return reply({ error: `Unknown action "${action}".`, timing: timing() }, 400);
    const data = await timingStore.run(t, () => run(params));
    return reply({ data, timing: timing() });
  } catch (err) {
    const status = err instanceof UserError ? err.status : 500;
    return reply({ error: err instanceof Error ? err.message : String(err), timing: timing() }, status);
  }
});
