/**
 * Magento helper — the app's only way to the Magento 2 store.
 *
 * The admin token can't live in the app's public code, and Magento won't
 * answer cross-site requests from a web page anyway, so the app calls this
 * function instead. The store's address and token stay here, read from the
 * MAGENTO_BASE_URL and MAGENTO_ACCESS_TOKEN secrets. MAGENTO_ADMIN_URL
 * (optional) is the admin panel's address, for "Open in Magento" links.
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
 *   orders     { page, pageSize, sort, dir, search, status, from }
 *                                   one page of orders (read-only)
 *   orderFacets                     order counts per status in use
 *   order      { id }               one order: items, totals, addresses,
 *                                   shipments + tracking, comments
 *   customers  { page, pageSize, sort, dir, search, groupId, from,
 *                activation?: { code, values } }
 *   customerGroups                  groups, with customer counts
 *   customerFields                  the store's Company / Is Activated
 *                                   fields (found by label), with counts
 *   setCustomerActivation { id, value }
 *                                   change a customer's activation (the
 *                                   only customer edit the app makes)
 *   customer   { id }               one customer, with their orders
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
 *   events                          every event (the store's events
 *                                   extension, found in its API map)
 *   saveEvent  { id?, changes }      create (no id) or change an event:
 *                                   title, content, start, end, status
 *   deleteEvent { id }
 *   fixEventDates                   re-save events saved at UTC midnight
 *   eventsApi                       the event routes and fields found
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
const HELPER_VERSION = "2026-10-26.2";

/**
 * Where a request's time went: each Magento call is counted and timed, per
 * request (AsyncLocalStorage keeps requests running side by side apart).
 */
type Timing = { magentoCalls: number; magentoMs: number; slowestMs: number; slowest: string };
const timingStore = new AsyncLocalStorage<Timing>();

const BASE = (Deno.env.get("MAGENTO_BASE_URL") ?? "").trim().replace(/\/rest(\/.*)?$/i, "").replace(/\/+$/, "");
const TOKEN = Deno.env.get("MAGENTO_ACCESS_TOKEN") ?? "";
// The Magento admin panel's address (its path is usually custom, e.g.
// https://shop.com/admin_x7k2) — optional; with it the app links customers
// and orders straight to their admin pages.
const ADMIN_URL = (Deno.env.get("MAGENTO_ADMIN_URL") ?? "").trim().replace(/\/+$/, "");

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

/** Magento's permission names, as the integration's API tab shows them. */
const PERMISSION_NAMES: Record<string, string> = {
  "Magento_Sales::shipment": "Sales → Operations → Shipments",
  "Magento_Sales::actions_view": "Sales → Operations → Orders → Actions → View",
  "Magento_Sales::sales": "Sales → Operations → Orders",
  "Magento_Customer::group": "Customers → Customer Groups",
  "Magento_Customer::manage": "Customers → All Customers",
  "Magento_Customer::customer": "Customers → All Customers",
  "Magento_Catalog::attributes_attributes": "Stores → Attributes → Product",
};

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
    if (res.status === 401) {
      // A missing permission: name the box to tick in the integration.
      const needs = Object.entries(PERMISSION_NAMES).find(([resource]) => message.includes(resource))?.[1];
      if (needs) throw new UserError(`The Magento integration needs the "${needs}" permission (System → Extensions → Integrations → edit → API), then Refresh.`, 403);
      throw new UserError(`Magento refused the token: ${message}`, 502);
    }
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

// ── Orders and customers ─────────────────────────────────────────────────────
//
// Read-only: lists (filtered, searched, sorted, paged by Magento) and one
// record in full. Needs the integration's Sales → Operations → Orders (and
// Shipments, for tracking) and Customers → All Customers permissions.

type Filter = [string, string, string];

/** searchCriteria from filter groups (each group OR'd inside, AND'd between). */
function criteria(groups: Filter[][], sort: { field: string; dir: string } | null, page: number, pageSize: number) {
  const q = new URLSearchParams();
  groups.filter(g => g.length).forEach((filters, g) => {
    filters.forEach(([field, value, cond], i) => {
      q.set(`searchCriteria[filter_groups][${g}][filters][${i}][field]`, field);
      q.set(`searchCriteria[filter_groups][${g}][filters][${i}][value]`, value);
      q.set(`searchCriteria[filter_groups][${g}][filters][${i}][condition_type]`, cond);
    });
  });
  if (sort) {
    q.set("searchCriteria[sortOrders][0][field]", sort.field);
    q.set("searchCriteria[sortOrders][0][direction]", sort.dir);
  }
  q.set("searchCriteria[pageSize]", String(pageSize));
  q.set("searchCriteria[currentPage]", String(page));
  return q;
}

function listParam(v: unknown) {
  return (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);
}

function pageParams(p: Record<string, unknown>) {
  return {
    page: Math.max(Number(p.page) || 1, 1),
    pageSize: Math.min(Math.max(Number(p.pageSize) || 50, 1), 200),
  };
}

// deno-lint-ignore no-explicit-any
function summarizeAddress(a: any) {
  if (!a) return null;
  return {
    name: [a.firstname, a.lastname].filter(Boolean).join(" "),
    company: a.company ?? "",
    street: (Array.isArray(a.street) ? a.street : [a.street]).filter(Boolean).join(", "),
    city: a.city ?? "",
    region: typeof a.region === "object" ? a.region?.region ?? "" : a.region ?? "",
    postcode: a.postcode ?? "",
    country: a.country_id ?? "",
    phone: a.telephone ?? "",
  };
}

const ORDER_LIST_FIELDS = [
  "entity_id", "increment_id", "created_at", "status", "state", "customer_id", "customer_is_guest",
  "customer_firstname", "customer_lastname", "customer_email", "grand_total", "order_currency_code",
  "total_qty_ordered", "total_item_count", "shipping_description",
  "billing_address[firstname,lastname,company,city,region,country_id,telephone]",
  "customer_note",
  "payment[method,additional_information,cc_last4,cc_type,cc_owner,cc_exp_month,cc_exp_year]",
  // All of it: the store's own order fields (Order Comment, First Order) are
  // extension attributes whose names aren't known ahead.
  "extension_attributes",
].join(",");

/**
 * The store's own order fields, found by name wherever they turn up — the
 * order, its extension attributes, or the payment's: { key → value }.
 */
// deno-lint-ignore no-explicit-any
function orderCustomFields(o: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // deno-lint-ignore no-explicit-any
  const take = (obj: any) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    Object.entries(obj).forEach(([k, v]) => {
      if (v !== null && typeof v !== "object" && !(k in out)) out[k] = v;
    });
  };
  take(o.extension_attributes);
  take(o.payment?.extension_attributes);
  take(o);
  return out;
}

const isFirstOrderKey = (k: string) => /first_?order/i.test(k);
const isCommentKey = (k: string) => /comment|customer_note|order_note/i.test(k) && !/histor|notify/i.test(k);

/**
 * The card on the order: the number as the payment keeps it (the last four,
 * or a number written into the payment's details by the store's card
 * method), its type, holder and expiry.
 */
// deno-lint-ignore no-explicit-any
function summarizeCard(payment: any) {
  if (!payment) return null;
  const info = payment.additional_information;
  const values: string[] = Array.isArray(info) ? info.map(String) : info && typeof info === "object" ? Object.values(info).map(String) : [];
  // A card-number-looking value: 12–19 digits, possibly spaced or masked.
  const written = values.find(v => /^[\d*xX•\s-]{12,23}$/.test(v.trim()) && (v.match(/\d/g) ?? []).length >= 4)?.trim() ?? "";
  const last4 = String(payment.cc_last4 ?? "").trim();
  const number = written || (last4 ? `•••• ${last4}` : "");
  if (!number && !payment.cc_type) return null;
  return {
    number,
    type: String(payment.cc_type ?? ""),
    owner: String(payment.cc_owner ?? ""),
    expires: payment.cc_exp_month && payment.cc_exp_year && Number(payment.cc_exp_year) > 0
      ? `${String(payment.cc_exp_month).padStart(2, "0")}/${payment.cc_exp_year}` : "",
  };
}

// deno-lint-ignore no-explicit-any
function summarizeOrder(o: any) {
  const billing = summarizeAddress(o.billing_address);
  const shipping = summarizeAddress(o.extension_attributes?.shipping_assignments?.[0]?.shipping?.address) ?? billing;
  const custom = orderCustomFields(o);
  const firstOrderKey = Object.keys(custom).find(isFirstOrderKey);
  return {
    id: o.entity_id,
    number: String(o.increment_id ?? ""),
    createdAt: o.created_at ?? "",
    status: o.status ?? "",
    state: o.state ?? "",
    customerId: o.customer_id ?? null,
    guest: Boolean(o.customer_is_guest),
    customerName: [o.customer_firstname, o.customer_lastname].filter(Boolean).join(" ") || billing?.name || "",
    email: o.customer_email ?? "",
    // The billing address's company; the customer's Company field replaces it
    // when they have one (addOrderCompanies).
    company: billing?.company ?? "",
    total: o.grand_total ?? null,
    currency: o.order_currency_code ?? "",
    qty: Number(o.total_qty_ordered ?? 0),
    itemCount: Number(o.total_item_count ?? 0),
    shipTo: shipping ? [shipping.city, shipping.region, shipping.country].filter(Boolean).join(", ") : "",
    // The payment method's title comes first in additional_information.
    payment: o.payment?.additional_information?.[0] || o.payment?.method || "",
    shipping: o.shipping_description ?? "",
    card: summarizeCard(o.payment),
    comment: String(Object.entries(custom).find(([k, v]) => isCommentKey(k) && String(v).trim())?.[1] ?? "").trim(),
    // The store's First Order field (1 / 0); null when the store has none.
    firstOrder: firstOrderKey ? ["1", "true", "yes"].includes(String(custom[firstOrderKey]).toLowerCase()) : null,
  };
}

const ORDER_SORT: Record<string, string> = {
  number: "increment_id", date: "created_at", total: "grand_total", status: "status",
  customer: "customer_lastname", email: "customer_email", qty: "total_qty_ordered",
};

function orderCriteria(p: Record<string, unknown>, page: number, pageSize: number, fields: string) {
  const groups: Filter[][] = [];
  const search = String(p.search ?? "").trim();
  if (search) {
    groups.push(["increment_id", "customer_email", "customer_lastname", "customer_firstname"]
      .map(field => [field, `%${search}%`, "like"] as Filter));
  }
  groups.push(listParam(p.status).map(s => ["status", s, "eq"] as Filter));
  if (p.from) groups.push([["created_at", `${p.from} 00:00:00`, "gteq"]]);
  if (p.customerId) groups.push([["customer_id", String(p.customerId), "eq"]]);
  const sortField = ORDER_SORT[String(p.sort ?? "")];
  const q = criteria(groups, { field: sortField ?? "created_at", dir: sortField ? (p.dir === "DESC" ? "DESC" : "ASC") : "DESC" }, page, pageSize);
  q.set("fields", `items[${fields}],total_count`);
  return q;
}

const CUSTOMER_LIST_FIELDS = [
  "id", "email", "firstname", "lastname", "group_id", "created_at", "default_billing", "custom_attributes",
  "addresses[id,firstname,lastname,company,street,city,region[region],postcode,country_id,telephone]",
].join(",");

// deno-lint-ignore no-explicit-any
function summarizeCustomer(c: any) {
  // deno-lint-ignore no-explicit-any
  const addresses = (c.addresses ?? []).map((a: any) => ({ id: String(a.id), ...summarizeAddress(a) }));
  const main = addresses.find((a: { id: string }) => a.id === String(c.default_billing)) ?? addresses[0] ?? null;
  return {
    id: c.id,
    name: [c.firstname, c.lastname].filter(Boolean).join(" "),
    email: c.email ?? "",
    groupId: c.group_id ?? null,
    createdAt: c.created_at ?? "",
    location: main ? [main.city, main.region, main.country].filter(Boolean).join(", ") : "",
    phone: main?.phone ?? "",
    // The address's company; a Company field on the account (custom, below)
    // is preferred by the app when the store has one.
    company: main?.company ?? "",
    // The store's own customer fields (Company, Is Activated…): code → value.
    // deno-lint-ignore no-explicit-any
    custom: Object.fromEntries((c.custom_attributes ?? []).map((a: any) => [a.attribute_code, a.value])),
    addresses,
  };
}

// ── The store's own customer fields ──
//
// "Company" and "Is Activated" aren't Magento's own customer fields — they
// come from this store's setup (an extension or custom attributes), so
// they're found by their labels in the customer attribute list. The
// activation field can be a yes / no, or a choice (Pending / Approved…).

type CustomerField = { code: string; label: string; input: string; options: { value: string; label: string }[] };

// deno-lint-ignore no-explicit-any
function toCustomerField(a: any): CustomerField {
  return {
    code: String(a.attribute_code),
    label: String(a.frontend_label ?? a.store_label ?? a.attribute_code),
    input: String(a.frontend_input ?? ""),
    // deno-lint-ignore no-explicit-any
    options: (a.options ?? []).map((o: any) => ({ value: String(o.value ?? ""), label: String(o.label ?? "").trim() }))
      .filter((o: { value: string; label: string }) => o.value !== "" && o.label !== ""),
  };
}

async function findCustomerFields() {
  // deno-lint-ignore no-explicit-any
  const all: any[] = (await mg("/attributeMetadata/customer")) ?? [];
  const fields = all.map(toCustomerField);
  const byLabel = (re: RegExp, codeRe: RegExp) =>
    fields.find(f => re.test(f.label)) ?? fields.find(f => codeRe.test(f.code)) ?? null;
  return {
    company: byLabel(/^company( name)?$/i, /^company(_name)?$/i),
    activation: byLabel(/activat|approv/i, /activat|approv/i),
    // A file field: the business license (or, failing a match, the first file field).
    license: byLabel(/licen[cs]e/i, /licen[cs]e/i) ?? fields.find(f => f.input === "file" || f.input === "image") ?? null,
    // Every custom field, so the app can show what's there when nothing matched.
    all: fields.filter(f => !["firstname", "lastname", "email", "group_id", "created_at", "updated_at", "website_id", "store_id", "created_in", "default_billing", "default_shipping", "confirmation", "password_hash", "rp_token", "rp_token_created_at", "disable_auto_group_change", "dob", "gender", "middlename", "prefix", "suffix", "taxvat", "lock_expires", "failures_num", "first_failure"].includes(f.code)),
  };
}

/** A yes / no field stores 1 / 0; a choice stores its option's value. */
function activationOptions(f: CustomerField) {
  if (f.options.length) return f.options;
  return [{ value: "1", label: "Yes" }, { value: "0", label: "No" }];
}

const CUSTOMER_SORT: Record<string, string> = {
  name: "lastname", email: "email", createdAt: "created_at", group: "group_id",
};

function customerCriteria(p: Record<string, unknown>, page: number, pageSize: number) {
  const groups: Filter[][] = [];
  const search = String(p.search ?? "").trim();
  if (search) groups.push(["email", "firstname", "lastname"].map(field => [field, `%${search}%`, "like"] as Filter));
  groups.push(listParam(p.groupId).map(g => ["group_id", g, "eq"] as Filter));
  // The store's activation field: { code, values } — any of these values.
  // deno-lint-ignore no-explicit-any
  const activation = p.activation as any;
  if (activation?.code && /^[a-z0-9_]+$/.test(activation.code)) {
    groups.push(listParam(activation.values).map(v => [activation.code, v, "eq"] as Filter));
  }
  if (p.from) groups.push([["created_at", `${p.from} 00:00:00`, "gteq"]]);
  const sortField = CUSTOMER_SORT[String(p.sort ?? "")];
  const q = criteria(groups, { field: sortField ?? "created_at", dir: sortField ? (p.dir === "DESC" ? "DESC" : "ASC") : "DESC" }, page, pageSize);
  q.set("fields", `items[${CUSTOMER_LIST_FIELDS}],total_count`);
  return q;
}

/**
 * How many orders each customer on the page has placed with their account
 * (guest checkouts aren't tied to an account). The customer search can't
 * say, so the page's customers' orders are asked for — just their customer
 * id — 10 customers per call (a long id list makes too long a web address),
 * the calls side by side. If orders can't be read, counts stay unknown.
 */
async function addOrderCounts<T extends { id: unknown; orderCount?: number | null }>(customers: T[]): Promise<T[]> {
  if (!customers.length) return customers;
  const counts = new Map<string, number>();
  try {
    const ids = customers.map(c => String(c.id));
    const bodies = await Promise.all(skuBatches(ids).map(batch => {
      const q = criteria([batch.map(id => ["customer_id", id, "eq"] as Filter)], null, 1, 10000);
      return mg(`/orders?${q}&fields=items[customer_id],total_count`);
    }));
    // deno-lint-ignore no-explicit-any
    bodies.flatMap(b => b?.items ?? []).forEach((o: any) => {
      const id = String(o.customer_id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    });
    customers.forEach(c => (c.orderCount = counts.get(String(c.id)) ?? 0));
  } catch {
    customers.forEach(c => (c.orderCount = null));
  }
  return customers;
}

/**
 * Each order's company from its customer's account — the store's Company
 * field, else their main address's company — over the billing address's.
 * The page's customers are looked up 10 per call; guests, and any lookup
 * that fails, keep the billing company.
 */
async function addOrderCompanies<T extends { customerId: unknown; company: string }>(orders: T[]): Promise<T[]> {
  const ids = [...new Set(orders.map(o => o.customerId).filter(id => id !== null && id !== undefined).map(String))];
  if (!ids.length) return orders;
  try {
    const [fields, bodies] = await Promise.all([
      findCustomerFields(),
      Promise.all(skuBatches(ids).map(batch => {
        const q = criteria([batch.map(id => ["entity_id", id, "eq"] as Filter)], null, 1, batch.length);
        return mg(`/customers/search?${q}&fields=items[id,default_billing,custom_attributes,addresses[id,company]]`);
      })),
    ]);
    const code = fields.company?.code;
    const companies = new Map<string, string>();
    // deno-lint-ignore no-explicit-any
    bodies.flatMap(b => b?.items ?? []).forEach((c: any) => {
      // deno-lint-ignore no-explicit-any
      const custom = code ? (c.custom_attributes ?? []).find((a: any) => a.attribute_code === code)?.value : "";
      // deno-lint-ignore no-explicit-any
      const addresses: any[] = c.addresses ?? [];
      const main = addresses.find(a => String(a.id) === String(c.default_billing)) ?? addresses[0];
      const company = String(custom || main?.company || "").trim();
      if (company) companies.set(String(c.id), company);
    });
    orders.forEach(o => {
      const company = companies.get(String(o.customerId));
      if (company) o.company = company;
    });
  } catch {
    // The billing company stands.
  }
  return orders;
}

/** Magento's built-in order statuses; any custom ones are found from recent orders. */
const KNOWN_ORDER_STATUSES = ["pending", "pending_payment", "processing", "holded", "complete", "closed", "canceled", "payment_review", "fraud"];

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

// ── Events ───────────────────────────────────────────────────────────────────
//
// Events come from the store's events extension, not Magento itself, so
// their routes and field names aren't known ahead. They're read from the
// store's own API map (/rest/all/schema — only the routes this integration
// may call): the routes with "event" in them, grouped by resource; the list,
// get, create, update and delete routes picked from their methods; and the
// event's fields from its definition, matched by name (title, content,
// start, end, status). Needs the integration's Events permissions.
//
// Dates: the extension keeps a date-and-time in UTC and the admin shows it
// in the store's time zone. A start of "2027-10-19 00:00:00" (UTC midnight)
// shows as Oct 18, 5:00 PM in Pacific time. So the app saves the store's
// local midnight (2027-10-19 07:00:00 UTC), which the admin shows as
// Oct 19, 12:00 AM. Reading, an exact UTC midnight is taken as the date
// it names (how existing events were saved); any other time is converted
// to the store's time zone.

type EventsApi = {
  base: string;
  list: { path: string; criteria: boolean } | null;
  get: string | null;
  create: string | null;
  update: { path: string; method: string } | null;
  remove: string | null;
  bodyKey: string;
  // The event's own field names: { id, title, content, start, end, status }.
  fields: Record<string, string | null>;
  // Every field the event has, with its type, and the ones a save needs.
  properties: Record<string, string>;
  required: string[];
  routes: string[];
};

let eventsApiCache: { at: number; api: EventsApi } | null = null;

async function fetchSchema() {
  for (const scope of ["all", "default"]) {
    const res = await fetch(`${BASE}/rest/${scope}/schema?services=all`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    });
    if (res.ok) return await res.json();
  }
  throw new UserError("Couldn't read the store's API map (/rest/all/schema).", 502);
}

// deno-lint-ignore no-explicit-any
function resolveRef(schema: any, ref: unknown) {
  const name = String(ref ?? "").replace(/^#\/definitions\//, "");
  return name ? schema.definitions?.[name] ?? null : null;
}

async function findEventsApi(): Promise<EventsApi> {
  if (eventsApiCache && Date.now() - eventsApiCache.at < 10 * 60_000) return eventsApiCache.api;
  const schema = await fetchSchema();
  // deno-lint-ignore no-explicit-any
  const ops: { path: string; method: string; op: any }[] = [];
  // deno-lint-ignore no-explicit-any
  Object.entries(schema.paths ?? {}).forEach(([path, methods]: [string, any]) => {
    // deno-lint-ignore no-explicit-any
    Object.entries(methods ?? {}).forEach(([method, op]: [string, any]) => {
      // By its path, or its service's name (an extension's routes may not say "event").
      if (!/event/i.test(`${path} ${(op?.tags ?? []).join(" ")} ${op?.operationId ?? ""}`)) return;
      ops.push({ path: path.replace(/^\/V1/, ""), method: method.toUpperCase(), op });
    });
  });
  if (!ops.length) {
    // What the integration can call, by area, so it's clear what's there.
    const areas = new Map<string, number>();
    Object.keys(schema.paths ?? {}).forEach(p => {
      const area = p.replace(/^\/V1\//, "").split("/")[0];
      areas.set(area, (areas.get(area) ?? 0) + 1);
    });
    const list = [...areas.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} (${n})`).join(", ");
    throw new UserError(
      `Magento's API has no event routes this integration can call. A permission ticked in the integration only opens routes an extension provides — the events extension may have none. The integration can reach: ${list || "nothing"}.`,
      403,
    );
  }
  // A resource: the path without its {id} and trailing search / list words.
  const baseOf = (p: string) => p.replace(/\/\{[^}]+\}$/, "").replace(/\/(search|list|getList|getlist)$/i, "");
  const bases = new Map<string, number>();
  ops.forEach(o => bases.set(baseOf(o.path), (bases.get(baseOf(o.path)) ?? 0) + 1));
  // The events themselves: most routes, preferring one that ends in "event(s)".
  const base = [...bases.entries()]
    .sort((a, b) => Number(/events?$/i.test(b[0])) - Number(/events?$/i.test(a[0])) || b[1] - a[1])[0][0];
  const mine = ops.filter(o => baseOf(o.path) === base);
  const withId = (o: { path: string }) => /\/\{[^}]+\}$/.test(o.path);
  // deno-lint-ignore no-explicit-any
  const hasCriteria = (o: any) => (o.op.parameters ?? []).some((p: any) => /searchCriteria/.test(String(p.name)));
  const listOp = mine.find(o => o.method === "GET" && hasCriteria(o)) ?? mine.find(o => o.method === "GET" && !withId(o));
  const getOp = mine.find(o => o.method === "GET" && withId(o));
  const createOp = mine.find(o => o.method === "POST" && !withId(o));
  const updateOp = mine.find(o => o.method === "PUT" && withId(o)) ?? mine.find(o => o.method === "PUT")
    ?? mine.find(o => o.method === "POST" && withId(o));
  const removeOp = mine.find(o => o.method === "DELETE");

  // The event's definition, from a save's body ({ event: {…} }) or a get's reply.
  // deno-lint-ignore no-explicit-any
  const bodyOf = (o: any) => (o?.op.parameters ?? []).find((p: any) => p.in === "body")?.schema;
  let bodyKey = "event";
  // deno-lint-ignore no-explicit-any
  let def: any = null;
  const body = bodyOf(createOp) ?? bodyOf(updateOp);
  if (body?.properties) {
    bodyKey = Object.keys(body.properties).find(k => body.properties[k].$ref) ?? Object.keys(body.properties)[0] ?? bodyKey;
    def = resolveRef(schema, body.properties[bodyKey]?.$ref);
  }
  def ??= resolveRef(schema, getOp?.op.responses?.["200"]?.schema?.$ref);
  const properties: Record<string, string> = Object.fromEntries(
    // deno-lint-ignore no-explicit-any
    Object.entries(def?.properties ?? {}).map(([k, v]: [string, any]) => [k, String(v.type ?? (v.$ref ? "object" : ""))]),
  );
  const names = Object.keys(properties);
  const pick = (exact: RegExp, loose: RegExp) => names.find(n => exact.test(n)) ?? names.find(n => loose.test(n)) ?? null;
  const fields = {
    id: pick(/^(event_id|id|entity_id)$/i, /_id$/i),
    title: pick(/^(title|name|event_title|event_name)$/i, /title|name/i),
    content: pick(/^(content|description|event_content|event_description)$/i, /content|desc/i),
    start: pick(/^(start|start_date|start_time|event_start|start_at|date_start|from_date)$/i, /start|from/i),
    end: pick(/^(end|end_date|end_time|event_end|end_at|date_end|to_date)$/i, /end|to_date/i),
    status: pick(/^(status|is_active|enabled|is_enabled|active)$/i, /status|active|enable/i),
  };
  const api: EventsApi = {
    base,
    list: listOp ? { path: listOp.path, criteria: hasCriteria(listOp) } : null,
    get: getOp?.path ?? null,
    create: createOp?.path ?? null,
    update: updateOp ? { path: updateOp.path, method: updateOp.method } : null,
    remove: removeOp?.path ?? null,
    bodyKey,
    fields,
    properties,
    required: Array.isArray(def?.required) ? def.required.map(String) : [],
    routes: ops.map(o => `${o.method} /V1${o.path}`),
  };
  eventsApiCache = { at: Date.now(), api };
  return api;
}

/** A route with its {id} filled in. */
function eventPath(path: string, id: unknown) {
  return path.replace(/\{[^}]+\}/, encodeURIComponent(String(id)));
}

// ── The store's time zone ──

let storeTimezone: string | null = null;

async function getStoreTimezone() {
  if (storeTimezone) return storeTimezone;
  let tz = (Deno.env.get("MAGENTO_TIMEZONE") ?? "").trim();
  if (!tz) {
    try {
      // deno-lint-ignore no-explicit-any
      const configs: any[] = (await mg("/store/storeConfigs")) ?? [];
      // deno-lint-ignore no-explicit-any
      tz = String((configs.find((c: any) => Number(c.id) === 1) ?? configs[0])?.timezone ?? "");
    } catch {
      /* not allowed — the default below */
    }
  }
  storeTimezone = tz || "America/Los_Angeles";
  return storeTimezone;
}

/** Minutes the time zone is ahead of UTC at that moment (Pacific: -420 / -480). */
function tzOffsetMinutes(utcMs: number, tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs)).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60_000);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function utcString(ms: number) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/** "2027-10-19" → the store's midnight that day, in UTC: "2027-10-19 07:00:00". */
function storeMidnightUtc(ymd: string, tz: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let ms = guess - tzOffsetMinutes(guess, tz) * 60_000;
  // Across a daylight-saving change the offset at the answer can differ.
  ms = guess - tzOffsetMinutes(ms, tz) * 60_000;
  return utcString(ms);
}

/** A stored date (UTC) → the day it means, "YYYY-MM-DD" (see the note above). */
function eventDay(raw: unknown, tz: string) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return "";
  if (!m[2] || (m[2] === "00" && m[3] === "00" && (m[4] ?? "00") === "00")) return m[1];
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}Z`);
  const local = new Date(ms + tzOffsetMinutes(ms, tz) * 60_000);
  return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`;
}

/** Saved the old way: an exact UTC midnight, which the admin shows the day before. */
function isUtcMidnight(raw: unknown) {
  return /^\d{4}-\d{2}-\d{2}[ T]00:00(:00)?/.test(String(raw ?? ""));
}

// deno-lint-ignore no-explicit-any
function summarizeEvent(e: any, api: EventsApi, tz: string) {
  const f = api.fields;
  const get = (k: string | null) => (k ? e?.[k] : undefined);
  const status = get(f.status);
  return {
    id: get(f.id) ?? null,
    title: String(get(f.title) ?? ""),
    content: String(get(f.content) ?? ""),
    start: eventDay(get(f.start), tz),
    end: eventDay(get(f.end), tz),
    startRaw: String(get(f.start) ?? ""),
    endRaw: String(get(f.end) ?? ""),
    enabled: status === undefined ? null : ["1", "true", "enabled", "yes", "active"].includes(String(status).toLowerCase()),
    needsDateFix: isUtcMidnight(get(f.start)) || isUtcMidnight(get(f.end)),
  };
}

// deno-lint-ignore no-explicit-any
async function listRawEvents(api: EventsApi): Promise<any[]> {
  if (!api.list) throw new UserError("The integration can't list events — no events list route is open to it.", 403);
  if (!api.list.criteria) {
    const body = await mg(api.list.path);
    return Array.isArray(body) ? body : body?.items ?? [];
  }
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let page = 1; page <= 25; page++) {
    const body = await mg(`${api.list.path}?${criteria([], null, page, 200)}`);
    const items = Array.isArray(body) ? body : body?.items ?? [];
    out.push(...items);
    const total = Number(body?.total_count ?? out.length);
    if (!items.length || out.length >= total) break;
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function getRawEvent(api: EventsApi, id: unknown): Promise<any> {
  if (api.get) {
    const body = await mg(eventPath(api.get, id));
    return body?.[api.bodyKey] ?? body;
  }
  const all = await listRawEvents(api);
  const found = all.find(e => String(e?.[api.fields.id ?? "id"]) === String(id));
  if (!found) throw new UserError("That event isn't in Magento anymore.", 404);
  return found;
}

/** A field's value as the event keeps it: status 1 / 0 (or true / false), dates in UTC. */
function eventValue(api: EventsApi, key: string, value: unknown, tz: string, dateStyle: "datetime" | "date") {
  const name = api.fields[key];
  if (!name) return undefined;
  if (key === "status") {
    const on = Boolean(value);
    return api.properties[name] === "boolean" ? on : on ? 1 : 0;
  }
  if (key === "start" || key === "end") {
    const ymd = String(value ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new UserError(`Pick a ${key} date.`);
    return dateStyle === "date" ? ymd : storeMidnightUtc(ymd, tz);
  }
  return String(value ?? "");
}

/** "Fall Market 2027" → "fall-market-2027". */
function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 80);
}

/**
 * Save an event: changes { title?, content?, start?, end?, status? } onto
 * the event as Magento has it (a save takes the whole event). A new event
 * starts from an existing one's other settings (store views and the like),
 * so it's set up the way the store's events are.
 */
// deno-lint-ignore no-explicit-any
async function saveEvent(id: unknown, changes: Record<string, unknown>): Promise<any> {
  const api = await findEventsApi();
  const tz = await getStoreTimezone();
  const isNew = id === null || id === undefined || id === "";
  if (isNew ? !api.create : !api.update) {
    throw new UserError(`The integration can't ${isNew ? "create" : "change"} events — tick Manage Events in its API permissions.`, 403);
  }
  // deno-lint-ignore no-explicit-any
  let event: Record<string, any>;
  let dateStyle: "datetime" | "date" = "datetime";
  if (isNew) {
    const sample = (await listRawEvents(api).catch(() => []))[0] ?? {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(sample[api.fields.start ?? ""] ?? ""))) dateStyle = "date";
    // Settings copied from an existing event: not its own fields, ids, dates or URL.
    const own = new Set(Object.values(api.fields).filter(Boolean) as string[]);
    event = Object.fromEntries(Object.entries(sample).filter(([k]) =>
      !own.has(k) && !/(^|_)id$|created|updated|url|identifier|slug/i.test(k) || /store/i.test(k)));
    // A URL key, when the event has one, from the title.
    const urlKey = Object.keys(api.properties).find(k => /url_key|identifier|slug/i.test(k));
    if (urlKey) event[urlKey] = slugify(String(changes.title ?? "")) + `-${Date.now().toString(36).slice(-4)}`;
  } else {
    event = { ...(await getRawEvent(api, id)) };
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(event[api.fields.start ?? ""] ?? ""))) dateStyle = "date";
  }
  for (const key of ["title", "content", "start", "end", "status"]) {
    if (!(key in changes)) continue;
    const value = eventValue(api, key, changes[key], tz, dateStyle);
    if (value !== undefined) event[api.fields[key]!] = value;
  }
  if (isNew && api.fields.status && !(api.fields.status in event)) event[api.fields.status] = eventValue(api, "status", true, tz, dateStyle);
  const payload = JSON.stringify({ [api.bodyKey]: event });
  const saved = isNew
    ? await mg(api.create!, { method: "POST", body: payload }, "all")
    : await mg(eventPath(api.update!.path, id), { method: api.update!.method, body: payload }, "all");
  const raw = saved && typeof saved === "object" ? saved[api.bodyKey] ?? saved : { ...event, [api.fields.id ?? "id"]: saved ?? id };
  return summarizeEvent(raw, api, tz);
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
      // "" when the MAGENTO_ADMIN_URL secret isn't set (no admin links then).
      adminUrl: ADMIN_URL,
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

  // ── Orders ──

  async orders(params) {
    const { page, pageSize } = pageParams(params);
    const body = await mg(`/orders?${orderCriteria(params, page, pageSize, ORDER_LIST_FIELDS)}`);
    return { items: await addOrderCompanies((body?.items ?? []).map(summarizeOrder)), total: Number(body?.total_count ?? 0), page, pageSize };
  },

  /** How many orders have each status — only statuses in use (for the filter). */
  async orderFacets() {
    // Custom statuses aren't listed anywhere the API reaches, so recent
    // orders are looked at too.
    const recent = await mg(`/orders?${criteria([], { field: "created_at", dir: "DESC" }, 1, 300)}&fields=items[status]`);
    // deno-lint-ignore no-explicit-any
    const statuses = [...new Set([...KNOWN_ORDER_STATUSES, ...(recent?.items ?? []).map((o: any) => String(o.status ?? ""))])].filter(Boolean);
    const counts = await eachLimited(statuses, 4, async status => {
      const q = criteria([[["status", status, "eq"]]], null, 1, 1);
      return Number((await mg(`/orders?${q}&fields=total_count`))?.total_count ?? 0);
    });
    return Object.fromEntries(statuses.map((s, i) => [s, counts[i]]).filter(([, n]) => Number(n) > 0));
  },

  /** One order in full: items, totals, addresses, shipments, comments. */
  async order({ id }) {
    if (!id) throw new UserError("Which order?");
    const o = await mg(`/orders/${encodeURIComponent(id)}`);
    let shipments: unknown[] = [];
    let shipmentsProblem = "";
    try {
      const q = criteria([[["order_id", String(id), "eq"]]], null, 1, 50);
      // deno-lint-ignore no-explicit-any
      shipments = ((await mg(`/shipments?${q}`))?.items ?? []).map((s: any) => ({
        number: String(s.increment_id ?? ""),
        createdAt: s.created_at ?? "",
        qty: Number(s.total_qty ?? 0),
        // deno-lint-ignore no-explicit-any
        tracks: (s.tracks ?? []).map((t: any) => ({ title: t.title ?? t.carrier_code ?? "", number: t.track_number ?? "" })),
      }));
    } catch (err) {
      shipmentsProblem = err instanceof Error ? err.message : String(err);
    }
    return {
      ...summarizeOrder(o),
      // Child rows of configurable / bundle items repeat their parent.
      // deno-lint-ignore no-explicit-any
      items: (o.items ?? []).filter((i: any) => !i.parent_item_id).map((i: any) => ({
        name: i.name ?? "",
        sku: i.sku ?? "",
        qtyOrdered: Number(i.qty_ordered ?? 0),
        qtyShipped: Number(i.qty_shipped ?? 0),
        qtyRefunded: Number(i.qty_refunded ?? 0),
        qtyCanceled: Number(i.qty_canceled ?? 0),
        price: i.price ?? null,
        rowTotal: i.row_total ?? null,
        discount: i.discount_amount ?? 0,
      })),
      totals: {
        subtotal: o.subtotal ?? null,
        shipping: o.shipping_amount ?? null,
        discount: o.discount_amount ?? 0,
        tax: o.tax_amount ?? 0,
        grandTotal: o.grand_total ?? null,
        paid: o.total_paid ?? null,
        refunded: o.total_refunded ?? null,
        due: o.total_due ?? null,
      },
      billingAddress: summarizeAddress(o.billing_address),
      // The payment's details as Magento lists them under Payment Information.
      // deno-lint-ignore no-explicit-any
      paymentInfo: (Array.isArray(o.payment?.additional_information) ? o.payment.additional_information : Object.values(o.payment?.additional_information ?? {}))
        .map((v: unknown) => String(v ?? "").trim()).filter(Boolean),
      shippingAddress: summarizeAddress(o.extension_attributes?.shipping_assignments?.[0]?.shipping?.address),
      couponCode: o.coupon_code ?? "",
      // deno-lint-ignore no-explicit-any
      history: (o.status_histories ?? []).map((h: any) => ({
        createdAt: h.created_at ?? "",
        status: h.status ?? "",
        comment: h.comment ?? "",
        notified: Boolean(h.is_customer_notified),
      })),
      shipments,
      shipmentsProblem,
    };
  },

  // ── Customers ──

  async customers(params) {
    const { page, pageSize } = pageParams(params);
    const body = await mg(`/customers/search?${customerCriteria(params, page, pageSize)}`);
    const items = (body?.items ?? []).map(summarizeCustomer);
    return { items: await addOrderCounts(items), total: Number(body?.total_count ?? 0), page, pageSize };
  },

  /** Customer groups, with how many customers each has (only groups in use count). */
  /**
   * The store's Company and Is Activated customer fields (found by label),
   * with how many customers have each activation value; and every custom
   * field, for when nothing matched.
   */
  async customerFields() {
    const found = await findCustomerFields();
    let activationCounts: Record<string, number> = {};
    if (found.activation) {
      const options = activationOptions(found.activation);
      const counts = await eachLimited(options, 4, async o => {
        const q = criteria([[[found.activation!.code, o.value, "eq"]]], null, 1, 1);
        return Number((await mg(`/customers/search?${q}&fields=total_count`))?.total_count ?? 0);
      });
      activationCounts = Object.fromEntries(options.map((o, i) => [o.value, counts[i]]));
    }
    return {
      company: found.company,
      license: found.license,
      activation: found.activation ? { ...found.activation, options: activationOptions(found.activation) } : null,
      activationCounts,
      all: found.all.map(f => ({ code: f.code, label: f.label, input: f.input })),
    };
  },

  /**
   * Change a customer's activation. Only the store's activation field can be
   * set here. The whole customer is read, that one field changed, and the
   * whole customer saved back — a partial save could drop addresses.
   */
  async setCustomerActivation({ id, value }) {
    if (!id) throw new UserError("Which customer?");
    const { activation } = await findCustomerFields();
    if (!activation) throw new UserError("This store has no Is Activated customer field the app could find.");
    const allowed = activationOptions(activation).map(o => o.value);
    if (!allowed.includes(String(value))) throw new UserError(`"${value}" isn't one of ${activation.label}'s choices.`);

    const customer = await mg(`/customers/${encodeURIComponent(id)}`);
    // deno-lint-ignore no-explicit-any
    const custom = (customer.custom_attributes ?? []).filter((a: any) => a.attribute_code !== activation.code);
    custom.push({ attribute_code: activation.code, value: String(value) });
    customer.custom_attributes = custom;
    const saved = await mg(`/customers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ customer }) });
    return summarizeCustomer(saved);
  },

  async customerGroups() {
    const body = await mg(`/customerGroups/search?${criteria([], null, 1, 200)}`);
    // deno-lint-ignore no-explicit-any
    const groups = (body?.items ?? []).map((g: any) => ({ id: String(g.id), code: String(g.code ?? "") }));
    const counts = await eachLimited(groups, 4, async (g: { id: string }) => {
      const q = criteria([[["group_id", g.id, "eq"]]], null, 1, 1);
      return Number((await mg(`/customers/search?${q}&fields=total_count`))?.total_count ?? 0);
    });
    return groups.map((g: { id: string; code: string }, i: number) => ({ ...g, count: counts[i] }));
  },

  /** One customer: details, addresses, and their orders (newest first) with totals. */
  async customer({ id }) {
    if (!id) throw new UserError("Which customer?");
    const [c, ordersBody] = await Promise.all([
      mg(`/customers/${encodeURIComponent(id)}`),
      mg(`/orders?${orderCriteria({ customerId: id }, 1, 100, ORDER_LIST_FIELDS)}`),
    ]);
    const orders = (ordersBody?.items ?? []).map(summarizeOrder);
    return {
      ...summarizeCustomer(c),
      dob: c.dob ?? "",
      orders,
      orderCount: Number(ordersBody?.total_count ?? orders.length),
      // Lifetime spend over the orders listed (the newest 100), not counting canceled ones.
      lifetime: orders
        .filter((o: { status: string }) => o.status !== "canceled")
        .reduce((sum: number, o: { total: number | null }) => sum + Number(o.total ?? 0), 0),
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

  // ── Events ──

  /** Every event, with what the integration can do to them. */
  async events() {
    const api = await findEventsApi();
    const tz = await getStoreTimezone();
    const items = (await listRawEvents(api)).map(e => summarizeEvent(e, api, tz));
    return {
      items,
      timezone: tz,
      can: { create: Boolean(api.create), update: Boolean(api.update), remove: Boolean(api.remove) },
      fields: api.fields,
    };
  },

  /** What was found in the store's API map — for when events don't line up. */
  async eventsApi() {
    eventsApiCache = null;
    return { ...(await findEventsApi()), timezone: await getStoreTimezone() };
  },

  /** Create (no id) or change an event. changes: { title, content, start, end, status }. */
  async saveEvent({ id, changes }) {
    if (!changes || typeof changes !== "object") throw new UserError("Nothing to save.");
    if ("title" in changes && !String(changes.title ?? "").trim()) throw new UserError("An event needs a title.");
    if (changes.start && changes.end && String(changes.end) < String(changes.start)) throw new UserError("The end date can't be before the start date.");
    return await saveEvent(id, changes);
  },

  async deleteEvent({ id }) {
    if (!id) throw new UserError("Which event?");
    const api = await findEventsApi();
    if (!api.remove) throw new UserError("The integration can't delete events — tick Manage Events in its API permissions.", 403);
    await mg(eventPath(api.remove, id), { method: "DELETE" }, "all");
    return { id };
  },

  /**
   * Re-save the events saved at UTC midnight (which the admin shows as the
   * evening before) at the store's midnight instead — same days.
   */
  async fixEventDates() {
    const api = await findEventsApi();
    const tz = await getStoreTimezone();
    const events = (await listRawEvents(api)).map(e => summarizeEvent(e, api, tz)).filter(e => e.needsDateFix);
    const results = await eachLimited(events, 3, async e => {
      try {
        await saveEvent(e.id, { start: e.start, end: e.end || e.start });
        return "";
      } catch (err) {
        return `${e.title}: ${err instanceof Error ? err.message : String(err)}`;
      }
    });
    const failed = results.filter(Boolean);
    return { fixed: events.length - failed.length, failed };
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
