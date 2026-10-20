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
 *                visibility, categoryId }
 *                                   one page of products; status, type,
 *                                   visibility and categoryId each take
 *                                   one value or a list (any matches)
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

// The store's address only — anything from "/rest" on (pasted from an API
// URL) is dropped, so "https://shop.com/rest/V1" still works.
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
    // An HTML error page — usually the wrong MAGENTO_BASE_URL.
    if (!res.ok) throw new UserError(`Magento answered ${res.status} without JSON — check MAGENTO_BASE_URL.`, 502);
  }
  if (!res.ok) {
    const message = magentoMessage(body) || `Magento error ${res.status}`;
    if (res.status === 401) throw new UserError(`Magento refused the token: ${message}`, 502);
    throw new UserError(message, res.status === 404 ? 404 : 502);
  }
  return body;
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
// A found list is kept for 10 minutes; a failed lookup isn't kept, so
// fixing the permission takes effect on the next page. `colorProblem` says
// why the names couldn't be found, for the app to show.

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

async function getColorOptions(): Promise<ColorOption[]> {
  if (colorCache && Date.now() - colorCache.at < 10 * 60 * 1000) return colorCache.options;
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
// back empty), so quantities are asked for separately:
//   1. Inventory source items (MSI) — one call for the whole page; a SKU's
//      qty is the total across its sources, in stock if any source is.
//   2. Failing that, each product's legacy stock item, a few at a time.
// Grouped products hold no stock of their own and are skipped.

type Stocked = { sku: string; type: string; qty: number | null; inStock: boolean | null };

async function addStock<T extends Stocked>(items: T[]): Promise<T[]> {
  const need = items.filter(p => p.type !== "grouped" && p.qty === null);
  if (!need.length) return items;
  const bySku = new Map(need.map(p => [p.sku, p]));

  try {
    const q = new URLSearchParams();
    // Any of these SKUs (one filter group = OR).
    need.forEach((p, i) => {
      q.set(`searchCriteria[filter_groups][0][filters][${i}][field]`, "sku");
      q.set(`searchCriteria[filter_groups][0][filters][${i}][value]`, p.sku);
      q.set(`searchCriteria[filter_groups][0][filters][${i}][condition_type]`, "eq");
    });
    q.set("searchCriteria[pageSize]", String(need.length * 20));
    const body = await mg(`/inventory/source-items?${q}`);
    const found = new Set<string>();
    // deno-lint-ignore no-explicit-any
    (body?.items ?? []).forEach((s: any) => {
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
    return items;
  } catch {
    // No MSI (or not allowed): the legacy stock item, per product.
  }

  await eachLimited(need, 4, async p => {
    try {
      const s = await mg(`/stockItems/${encodeURIComponent(p.sku)}`);
      p.qty = Number(s?.qty ?? 0);
      p.inStock = Boolean(s?.is_in_stock);
    } catch {
      /* left unknown */
    }
  });
  return items;
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
    const { query, pageSize } = buildSearchCriteria(params);
    query.set("fields", `items[${LIST_FIELDS}],total_count`);
    const [body, colors] = await Promise.all([mg(`/products?${query}`), getColorNames()]);
    // deno-lint-ignore no-explicit-any
    const items = await addStock((body?.items ?? []).map((p: any) => summarize(p, colors)));
    return {
      items,
      total: Number(body?.total_count ?? 0),
      page: Math.max(Number(params.page) || 1, 1),
      pageSize,
    };
  },

  /**
   * How many products have each status, type and visibility — so the
   * header filters list only values that exist. One tiny count query per
   * value, a few at a time.
   */
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
    const options = (await getColorOptions()).sort((a, b) => a.label.localeCompare(b.label));
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

  // Only a signed-in user of the app gets through — the anon key alone isn't enough.
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return reply({ error: "Sign in to use Magento." }, 401);

  if (!BASE || !TOKEN) {
    return reply({ error: "Magento isn't connected yet — add the MAGENTO_BASE_URL and MAGENTO_ACCESS_TOKEN secrets in Supabase." }, 503);
  }

  try {
    const { action, ...params } = await req.json();
    const run = actions[action];
    if (!run) return reply({ error: `Unknown action "${action}".` }, 400);
    return reply({ data: await run(params) });
  } catch (err) {
    const status = err instanceof UserError ? err.status : 500;
    return reply({ error: err instanceof Error ? err.message : String(err) }, status);
  }
});
