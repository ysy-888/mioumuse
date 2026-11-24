// ── N41 Orders ───────────────────────────────────────────────────────────────
//
// N41's sales orders, by customer, from Import N41 Sales Orders (header menu
// ⋮ — N41's Sales Orders export, .csv: division, orderdate, … orderno, sod_id
// …, one row per order line). The page lists each customer with their SOs;
// clicking an SO opens its full page — the customer, every line with its
// sizes, totals and memo — with the team's comments on the right.
//
// Stored in n41_so_lines (a row per sod_id) and n41_so_comments
// (supabase/migrations/20261117210000_n41_sales_orders.sql). The same import
// still saves each web order's status (n41_orders) for Magento → Orders.

const SO_CUSTOMERS_PER_PAGE = 40;
const SO_STATUS_ORDER = ["Open", "Hold", "Closed"];

const so = {
  lines: null, // [SoLine] once loaded
  orders: new Map(), // order_no → SoOrder
  customers: [], // [{ key, name, orders: [SoOrder] }], newest first
  commentCounts: new Map(),
  importedAt: "",
  loading: null,
  filters: { q: "", status: "", type: "" },
  shown: SO_CUSTOMERS_PER_PAGE,
  open: null, // order_no of the SO page showing
  comments: [],
  commentsFor: "",
  channel: null,
  editing: "", // comment id being edited
};

// ── The export: reading it ───────────────────────────────────────────────────

/** "10/18/2026 00:00:00" → "2026-10-18"; "" when it isn't a date. */
function soYmd(value) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(value ?? "").trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
}

function soNum(value) {
  const n = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Read CSV one row at a time, without a worksheet object containing millions of cell properties. */
function* n41SoCsvRows(text) {
  let headers = null;
  let row = [];
  let cell = "";
  let quoted = false;
  const record = cells => {
    if (cells.every(value => value === "")) return null;
    if (!headers) {
      headers = cells.map(value => value.trim());
      return null;
    }
    return Object.fromEntries(headers.map((name, i) => [name, cells[i] ?? ""]));
  };
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      const value = record(row);
      if (value) yield value;
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field. Export it again from N41.");
  if (cell !== "" || row.length) {
    row.push(cell);
    const value = record(row);
    if (value) yield value;
  }
}

/** The export's rows as objects by header (the .csv is read as text, Windows or UTF-8). */
async function readN41SoFile(file) {
  if (/\.csv$/i.test(file.name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder("windows-1252").decode(bytes); }
    return n41SoCsvRows(text);
  }
  await loadSheetJs();
  const book = XLSX.read(await file.arrayBuffer(), { type: "array", dense: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error("That file has no sheets.");
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

/**
 * The export's lines (n41_so_lines rows), and each web order's status for
 * Magento → Orders: a web order's Customer PO reads "Web:00000061"; it's
 * Closed only if every line is.
 */
function parseN41SoRows(rows) {
  const need = ["orderno", "sod_id", "status", "customer", "style", "color"];
  const iterator = rows[Symbol.iterator]();
  const firstRow = iterator.next();
  const first = firstRow.value ?? {};
  const missing = need.filter(k => !(k in first));
  if (missing.length) {
    throw new Error(`That isn't N41's Sales Orders export — it's missing ${missing.join(", ")}. Export the order lines (.csv with orderno, sod_id …).`);
  }
  const s = v => String(v ?? "").trim();
  const lines = [];
  const webOrders = new Map();
  const seen = new Set();
  let otherRows = 0;
  let repeated = 0;
  for (let entry = firstRow; !entry.done; entry = iterator.next()) {
    const r = entry.value;
    const sodId = parseInt(s(r.sod_id), 10);
    const orderNo = s(r.orderno).replace(/\.0+$/, "");
    if (!Number.isFinite(sodId) || !orderNo) continue; // blank or total rows
    if (seen.has(sodId)) { repeated += 1; continue; }
    seen.add(sodId);
    const sizes = [];
    for (let i = 1; i <= 15; i += 1) {
      const size = s(r[`Size${i}`]);
      const qty = soNum(r[`unit${i}`]);
      const open = soNum(r[`Bal_unit${i}`]);
      if (size || qty || open) sizes.push({ size: size || `#${i}`, qty, open });
    }
    const openQty = sizes.reduce((t, x) => t + x.open, 0);
    const price = soNum(r.price);
    lines.push({
      sod_id: sodId,
      order_no: orderNo,
      line: parseInt(s(r.line), 10) || null,
      status: s(r.status),
      order_type: s(r.orderType),
      order_date: soYmd(r.orderdate) || null,
      ship_date: soYmd(r.shipdate) || null,
      cancel_date: soYmd(r.canceldate) || null,
      line_cancel_date: soYmd(r.sod_CancelDate) || null,
      customer: s(r.customer),
      store: s(r.store),
      cust_name: s(r.cust_name),
      customer_type: s(r.customerType),
      contact: s(r.contact),
      email: s(r.email),
      phone: s(r.phone1),
      address: s(r.address1),
      city: s(r.city),
      state: s(r.state),
      zip: s(r.zip),
      customer_po: s(r.customerPo),
      terms: s(r.terms),
      payment_code: s(r.paymentcode),
      ship_via: s(r.shipvia),
      price_level: s(r.pricelevel),
      style_no: s(r.style),
      color: s(r.color),
      description: s(r.descript),
      category: s(r.category),
      season: s(r.season),
      size_cat: s(r.Sizecat),
      sizes,
      total_units: soNum(r.totalunit),
      price,
      ext_price: soNum(r.extPrice),
      ship_qty: soNum(r.ship_qty),
      inv_qty: soNum(r.inv_qty),
      inv_amt: soNum(r.inv_Amt),
      cancel_qty: soNum(r.cancel_qty),
      cancel_amt: soNum(r.Cancel_amt),
      open_qty: openQty,
      open_amt: Math.round(openQty * price * 100) / 100,
      memo: s(r.memo),
    });
    // Web orders, for Magento → Orders (n41_orders).
    const po = s(r.customerPo);
    const key = /^web\s*:/i.test(po) ? mgOrderKey(po) : "";
    if (!key) { otherRows += 1; continue; }
    const web = webOrders.get(key);
    if (!web) webOrders.set(key, { poNo: po, soNo: orderNo, customer: s(r.cust_name) || s(r.customer), status: s(r.status) });
    else {
      web.soNo = [...new Set([...web.soNo.split(", "), orderNo])].filter(Boolean).join(", ");
      if (isMgN41Closed(web) && !isMgN41Closed({ status: s(r.status) })) web.status = s(r.status);
    }
  }
  if (!lines.length) throw new Error("No order lines found in that file.");
  return { lines, webOrders, otherRows, repeated };
}

// ── Loading and saving ───────────────────────────────────────────────────────

const SO_LINE_COLUMNS = "sod_id,order_no,line,status,order_type,order_date,ship_date,cancel_date,line_cancel_date,customer,store,cust_name,customer_type,contact,email,phone,address,city,state,zip,customer_po,terms,payment_code,ship_via,style_no,color,description,category,season,size_cat,sizes,total_units,price,ext_price,ship_qty,inv_qty,inv_amt,cancel_qty,cancel_amt,open_qty,open_amt,memo,imported_at";

async function saveN41SoLines(lines, onProgress) {
  const client = requireClient();
  const importedAt = new Date().toISOString();
  const BATCH = 500;
  for (let i = 0; i < lines.length; i += BATCH) {
    const batch = lines.slice(i, i + BATCH).map(l => ({ ...l, imported_at: importedAt }));
    throwIfError(await client.from("n41_so_lines").upsert(batch, { onConflict: "user_id,sod_id" }));
    onProgress?.(Math.min(i + BATCH, lines.length), lines.length);
  }
}

async function loadN41SoData() {
  const client = requireClient();
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await client.from("n41_so_lines").select(SO_LINE_COLUMNS).order("sod_id").range(from, from + 999);
    throwIfError(res);
    rows.push(...res.data);
    if (res.data.length < 1000) break;
  }
  const counts = new Map();
  for (let from = 0; ; from += 1000) {
    const res = await client.from("n41_so_comments").select("order_no").range(from, from + 999);
    if (res.error) break;
    res.data.forEach(c => counts.set(c.order_no, (counts.get(c.order_no) ?? 0) + 1));
    if (res.data.length < 1000) break;
  }
  so.lines = rows.map(r => ({ ...r, sizes: Array.isArray(r.sizes) ? r.sizes : [] }));
  so.commentCounts = counts;
  so.importedAt = rows.reduce((m, r) => (r.imported_at > m ? r.imported_at : m), "");
  buildSoOrders();
}

/** Lines → SOs → customers. */
function buildSoOrders() {
  so.orders = new Map();
  for (const l of so.lines ?? []) {
    let o = so.orders.get(l.order_no);
    if (!o) {
      o = { orderNo: l.order_no, lines: [], head: l };
      so.orders.set(l.order_no, o);
    }
    o.lines.push(l);
  }
  for (const o of so.orders.values()) {
    o.lines.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.sod_id - b.sod_id);
    o.head = o.lines[0];
    const sum = k => o.lines.reduce((t, l) => t + (Number(l[k]) || 0), 0);
    o.units = sum("total_units");
    o.amount = sum("ext_price");
    o.openQty = sum("open_qty");
    o.openAmt = sum("open_amt");
    o.invQty = sum("inv_qty");
    o.invAmt = sum("inv_amt");
    o.cancelQty = sum("cancel_qty");
    o.styles = new Set(o.lines.map(l => l.style_no)).size;
    // Each style + colour on the SO, its lines' units summed, in line order.
    const styleMap = new Map();
    for (const l of o.lines) {
      const key = `${l.style_no}\u0000${l.color ?? ""}`;
      if (!styleMap.has(key)) styleMap.set(key, { styleNo: l.style_no ?? "", color: l.color ?? "", units: 0, open: 0 });
      const s = styleMap.get(key);
      s.units += Number(l.total_units) || 0;
      s.open += Number(l.open_qty) || 0;
    }
    o.styleList = [...styleMap.values()];
    // The SO's status: Open while any line is, then Hold, else Closed.
    const statuses = new Set(o.lines.map(l => l.status));
    o.status = SO_STATUS_ORDER.find(st => statuses.has(st)) ?? o.head.status;
    o.mixed = statuses.size > 1;
  }
  const byCustomer = new Map();
  for (const o of so.orders.values()) {
    const key = o.head.customer || o.head.cust_name || "—";
    if (!byCustomer.has(key)) byCustomer.set(key, { key, name: key, orders: [] });
    byCustomer.get(key).orders.push(o);
  }
  so.customers = [...byCustomer.values()];
  for (const c of so.customers) {
    c.orders.sort((a, b) => String(b.head.order_date ?? "").localeCompare(String(a.head.order_date ?? "")) || b.orderNo.localeCompare(a.orderNo, undefined, { numeric: true }));
    c.latest = c.orders[0]?.head.order_date ?? "";
  }
  so.customers.sort((a, b) => String(b.latest).localeCompare(String(a.latest)) || a.name.localeCompare(b.name));
}

async function ensureN41SoData({ force = false } = {}) {
  if (so.lines && !force) return;
  if (!so.loading || force) {
    so.loading = loadN41SoData().finally(() => { so.loading = null; });
  }
  await so.loading;
}

// ── Formatting ───────────────────────────────────────────────────────────────

function soEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function soMoney(n) {
  return `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function soQty(n) {
  const v = Number(n) || 0;
  return v ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "–";
}
function soDate(ymdValue) {
  return ymdValue ? formatMdy(ymdValue) : "–";
}
function soStatusPill(status) {
  return `<span class="so-status" data-status="${soEsc(String(status).toLowerCase())}">${soEsc(status || "–")}</span>`;
}
/** The person's name when it isn't just the account's own name again. */
function soPersonName(head) {
  const n = (head.cust_name || "").trim();
  return n && n.replace(/\s+/g, " ").toUpperCase() !== (head.customer || "").toUpperCase() ? n.replace(/\s+/g, " ") : "";
}

// ── The page: customers and their SOs ───────────────────────────────────────

function soOrderMatches(o, q) {
  const h = o.head;
  return `${o.orderNo} ${h.customer} ${h.cust_name} ${h.store} ${h.customer_po} ${h.email} ${h.contact} ${h.city} ${h.state} ${o.lines.map(l => `${l.style_no} ${l.color}`).join(" ")}`
    .toLowerCase().includes(q);
}

function filteredSoCustomers() {
  const f = so.filters;
  const q = f.q.toLowerCase();
  return so.customers.map(c => {
    const orders = c.orders.filter(o =>
      (!f.status || o.status === f.status)
      && (!f.type || o.head.order_type === f.type)
      && (!q || soOrderMatches(o, q)));
    return orders.length ? { ...c, orders } : null;
  }).filter(Boolean);
}

function renderN41OrdersFilters() {
  const all = [...so.orders.values()];
  // Status buttons, only for statuses there are.
  const counts = new Map();
  all.forEach(o => counts.set(o.status, (counts.get(o.status) ?? 0) + 1));
  const statuses = SO_STATUS_ORDER.filter(st => counts.has(st)).concat([...counts.keys()].filter(st => !SO_STATUS_ORDER.includes(st)));
  if (so.filters.status && !counts.has(so.filters.status)) so.filters.status = "";
  document.getElementById("soStatusFilters").innerHTML = [["", "All", all.length], ...statuses.map(st => [st, st, counts.get(st)])]
    .map(([key, label, n]) => `<button type="button" class="filter-btn${so.filters.status === key ? " active" : ""}" data-so-status="${soEsc(key)}">${soEsc(label)} <span class="so-filter-count">${n.toLocaleString()}</span></button>`).join("");
  // Order types there are.
  const types = [...new Set(all.map(o => o.head.order_type).filter(Boolean))].sort();
  const type = document.getElementById("soTypeFilter");
  if (so.filters.type && !types.includes(so.filters.type)) so.filters.type = "";
  type.innerHTML = `<option value="">All types</option>${types.map(t => `<option value="${soEsc(t)}">${soEsc(t)}</option>`).join("")}`;
  type.value = so.filters.type;
  type.hidden = !types.length;
}

function renderN41OrdersList() {
  const list = document.getElementById("soList");
  if (!list) return;
  if (!so.lines) {
    list.innerHTML = `<div class="so-empty">Loading orders…</div>`;
    return;
  }
  if (!so.lines.length) {
    list.innerHTML = `<div class="so-empty">No sales orders yet — use <strong>Import N41 Sales Orders</strong> in the menu (⋮) with N41's Sales Orders export (.csv).</div>`;
    document.getElementById("soCount").textContent = "";
    return;
  }
  const customers = filteredSoCustomers();
  const orderCount = customers.reduce((t, c) => t + c.orders.length, 0);
  document.getElementById("soCount").textContent = `${customers.length.toLocaleString()} customer${customers.length === 1 ? "" : "s"} · ${orderCount.toLocaleString()} SO${orderCount === 1 ? "" : "s"}`;
  const imported = document.getElementById("soImported");
  if (imported) imported.textContent = so.importedAt ? `Imported ${new Date(so.importedAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" })}` : "";
  if (!customers.length) {
    list.innerHTML = `<div class="so-empty">No orders match these filters.</div>`;
    return;
  }
  const shown = customers.slice(0, so.shown);
  const rows = shown.map(c => {
    const h = c.orders[0].head;
    const units = c.orders.reduce((t, o) => t + o.units, 0);
    const amount = c.orders.reduce((t, o) => t + o.amount, 0);
    const open = c.orders.reduce((t, o) => t + o.openQty, 0);
    const where = [h.city, h.state].filter(x => x && x !== "NA").join(", ");
    const person = soPersonName(h);
    const head = `<tr class="so-customer-row">
      <td colspan="7">
        <span class="so-customer-name">${soEsc(c.name)}</span>
        ${person ? `<span class="so-customer-sub">${soEsc(person)}</span>` : ""}
        ${h.customer_type ? `<span class="so-customer-type">${soEsc(h.customer_type)}</span>` : ""}
        ${where ? `<span class="so-customer-sub">${soEsc(where)}</span>` : ""}
      </td>
      <td class="num">${soQty(units)}</td>
      <td class="num">${soMoney(amount)}</td>
      <td class="num">${soQty(open)}</td>
      <td class="num so-customer-orders">${c.orders.length} SO${c.orders.length === 1 ? "" : "s"}</td>
    </tr>`;
    const orders = c.orders.map(o => {
      const comments = so.commentCounts.get(o.orderNo) ?? 0;
      return `<tr class="so-order-row clickable-row${so.open === o.orderNo ? " is-pane-row" : ""}" data-so="${soEsc(o.orderNo)}" title="Open SO ${soEsc(o.orderNo)}">
        <td class="so-col-no">${soEsc(o.orderNo)}</td>
        <td>${soDate(o.head.order_date)}</td>
        <td>${soDate(o.head.ship_date)}</td>
        <td>${soDate(o.head.cancel_date)}</td>
        <td class="so-col-type">${soEsc(o.head.order_type || "–")}</td>
        <td class="so-col-po" title="${soEsc(o.head.customer_po)}">${soEsc(o.head.customer_po || "–")}</td>
        <td>${soStatusPill(o.status)}${o.mixed ? `<span class="so-mixed" title="Its lines aren't all ${soEsc(o.status)}">mixed</span>` : ""}</td>
        <td class="num">${soQty(o.units)}<span class="so-sub-num">${o.styles} style${o.styles === 1 ? "" : "s"}</span></td>
        <td class="num">${soMoney(o.amount)}</td>
        <td class="num${o.openQty ? " is-open" : ""}">${soQty(o.openQty)}</td>
        <td class="num">${comments ? `<span class="so-comment-count" title="${comments} comment${comments === 1 ? "" : "s"}">💬 ${comments}</span>` : ""}</td>
      </tr>`;
    }).join("");
    return head + orders;
  }).join("");
  list.innerHTML = `<table class="so-table">
    <colgroup><col class="so-c-no"><col class="so-c-date"><col class="so-c-date"><col class="so-c-date"><col class="so-c-type"><col class="so-c-po"><col class="so-c-status"><col class="so-c-num"><col class="so-c-amt"><col class="so-c-num"><col class="so-c-com"></colgroup>
    <thead><tr><th>SO #</th><th>Order</th><th>Ship</th><th>Cancel</th><th>Type</th><th>Customer PO</th><th>Status</th><th class="num">Units</th><th class="num">Amount</th><th class="num" title="Units still open (not shipped or canceled)">Open</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>${customers.length > shown.length ? `<div class="so-more"><button type="button" class="btn" id="soMoreBtn">Show more customers (${(customers.length - shown.length).toLocaleString()} more)</button></div>` : ""}`;
}

// ── The page: an SO table (the by-customer list above is kept, unused) ──────
//
// A regular table, a row per SO: SO #, Customer, Order Date, Type (a colour
// per type), Customer PO (without its "FR:" / "FG:" … prefix), Status (Open
// green), Total Qty, Styles, then Style # / Color with the style's OH / WIP /
// ATS — for one style, on the row; for several, ▸ opens a row for each.
// A style opens its style pane; anywhere else on the row opens the SO's page.
// (Picked / Allocated / AA come later, beside OH / WIP / ATS.)

/** "table" (now) or "customers" (the earlier list, by customer) — to bring it back. */
const SO_LIST_LAYOUT = "table";

const soTable = {
  page: 1,
  pageSize: TABLE_PAGE_SIZE_DEFAULT,
  pagedFor: "",
  sort: { col: null, dir: 1 },
  expanded: new Set(),
  rows: [],
};

/** "FR:D5ZKGY5XU6" → "D5ZKGY5XU6" (FR:, FG:, Web: …). */
function soCleanPo(po) {
  return String(po ?? "").replace(/^[A-Za-z]{1,6}\s*:\s*/, "").trim();
}

/** A colour for each order type: the sales channels their own, a trade show by its show (any year). */
function soTypeTone(type) {
  const t = String(type ?? "").toUpperCase();
  const channels = { FAIRE: "faire", INHOUSE: "inhouse", FG: "fg", MAGENTO: "magento", EMAIL: "email", PHONE: "phone", COMPANY: "company", OFFPRICE: "offprice" };
  if (channels[t]) return channels[t];
  for (const show of ["MAGIC", "NY", "ATL", "DAL", "CHI", "LV", "LA"]) {
    if (new RegExp(`\\b${show}\\b`).test(t)) return `show-${show.toLowerCase()}`;
  }
  return "other";
}

function soTypePillHtml(type) {
  return type ? `<span class="so-type" data-tone="${soEsc(soTypeTone(type))}">${soEsc(type)}</span>` : EMPTY_DISPLAY;
}

const SO_SORT_COLUMNS = {
  orderNo: o => Number(o.orderNo) || 0,
  customer: o => o.head.customer,
  orderDate: o => o.head.order_date ?? "",
  type: o => o.head.order_type,
  customerPo: o => soCleanPo(o.head.customer_po),
  status: o => SO_STATUS_ORDER.indexOf(o.status),
  qty: o => o.units,
  styles: o => o.styleList.length,
};

/** Type header filter: the types there are, most SOs first. */
function soTypeFilterOptions() {
  const counts = new Map();
  for (const o of so.orders.values()) {
    const key = o.head.order_type || BLANK_FILTER_LABEL;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, label: key === BLANK_FILTER_LABEL ? "No type" : key, count }));
}

/** Show the SO table, the earlier list, or an SO's page. */
function syncSoLayers() {
  if (getCurrentAppView() !== "n41Orders") return;
  const detail = Boolean(so.open);
  const table = !detail && SO_LIST_LAYOUT === "table";
  document.getElementById("soToolbar").hidden = detail;
  document.getElementById("soTableWrap").hidden = !table;
  document.getElementById("soPager").hidden = !table;
  document.getElementById("n41OrdersWrap").hidden = table;
  document.getElementById("soListView").hidden = detail || table;
  document.getElementById("soDetail").hidden = !detail;
}

function renderSoList() {
  if (SO_LIST_LAYOUT === "table") renderSoTable();
  else renderN41OrdersList();
}

function renderSoTable() {
  const tbody = document.getElementById("soTableBody");
  if (!tbody) return;
  const cols = [...document.querySelectorAll("#soTable thead th[data-col]")].map(th => th.dataset.col);
  const counter = document.getElementById("soCount");
  const imported = document.getElementById("soImported");
  if (imported) imported.textContent = so.importedAt ? `Imported ${new Date(so.importedAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" })}` : "";
  const state = msg => {
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${msg}</td></tr>`;
    renderSoPager();
  };
  if (!so.lines) return state("Loading…");
  if (!so.lines.length) {
    if (counter) counter.textContent = "0 SOs";
    return state("No sales orders yet — use <strong>Import N41 Sales Orders</strong> in the menu (⋮) with N41's Sales Orders export (.csv).");
  }

  const f = so.filters;
  const q = f.q.toLowerCase();
  setActiveSearchQuery(q);
  const rows = [...so.orders.values()].filter(o =>
    (!f.status || o.status === f.status)
    && columnFilterPasses("soTable", "type", o.head.order_type || BLANK_FILTER_LABEL)
    && (!q || soOrderMatches(o, q)));
  // Newest first, then by SO #.
  rows.sort((a, b) => String(b.head.order_date ?? "").localeCompare(String(a.head.order_date ?? "")) || (Number(b.orderNo) || 0) - (Number(a.orderNo) || 0));
  applyColumnSort(rows, soTable.sort, SO_SORT_COLUMNS);
  soTable.rows = rows;
  const pagedFor = [f.status, q, getColumnFilterSelection("soTable", "type")?.join(",") ?? ""].join("|");
  soTable.page = pagedFor === soTable.pagedFor ? clampTablePage(soTable.page, rows.length, soTable.pageSize) : 1;
  soTable.pagedFor = pagedFor;
  if (counter) counter.textContent = rows.length === 1 ? "1 SO" : `${rows.length.toLocaleString()} SOs`;
  if (!rows.length) return state("No SOs match the current filters.");

  const page = rows.slice((soTable.page - 1) * soTable.pageSize, soTable.page * soTable.pageSize);
  tbody.replaceChildren(...page.flatMap(o => createSoRows(o, cols)));
  renderSoPager();
  syncStylePaneRows();
}

/** A style's OH / WIP / ATS cells (the Styles table's figures and colours). */
function soQtyCell(td, col, styleNo, color) {
  const style = findStyle(styleNo, color);
  if (!style) { setDisplayText(td, EMPTY_DISPLAY); td.title = "Not in the Styles database"; return; }
  const fig = styleQtyFigures(style).find(x => x.col === col);
  td.textContent = fig?.text ?? EMPTY_DISPLAY;
  td.className = `so-qty${fig?.tone ? ` is-${fig.tone}` : ""}`;
}

/** The style's link: opens its style pane. */
function soStyleLinkHtml(s) {
  const q = getActiveSearchQuery();
  return `<button type="button" class="so-style-link" data-style-no="${soEsc(s.styleNo)}" data-color="${soEsc(s.color)}" title="Open ${soEsc(s.styleNo)} ${soEsc(s.color)}">`
    + `<strong>${buildSearchHighlightedHtml(s.styleNo, q)}</strong><span>${buildSearchHighlightedHtml(s.color, q)}</span></button>`;
}

/** The SO's row, and — opened — a row for each of its styles. */
function createSoRows(o, cols) {
  const h = o.head;
  const one = o.styleList.length === 1 ? o.styleList[0] : null;
  const open = !one && soTable.expanded.has(o.orderNo);
  const tr = document.createElement("tr");
  tr.className = "clickable-row so-row" + (open ? " is-open" : "");
  tr.dataset.so = o.orderNo;
  tr.title = `Open SO ${o.orderNo}`;
  cols.forEach(col => {
    const td = document.createElement("td");
    td.dataset.col = col;
    switch (col) {
      case "orderNo": mountSearchHighlightedText(td, o.orderNo); td.classList.add("so-no"); break;
      case "customer": {
        mountSearchHighlightedText(td, h.customer);
        const person = soPersonName(h);
        td.title = person ? `${h.customer} · ${person}` : h.customer;
        break;
      }
      case "orderDate": setDisplayText(td, h.order_date ? formatMdy(h.order_date) : EMPTY_DISPLAY); break;
      case "type": td.innerHTML = soTypePillHtml(h.order_type); break;
      case "customerPo": {
        mountSearchHighlightedText(td, soCleanPo(h.customer_po));
        if (h.customer_po) td.title = h.customer_po;
        break;
      }
      case "status":
        td.innerHTML = soStatusPill(o.status);
        break;
      case "qty": td.textContent = soQty(o.units); td.classList.add("so-num"); break;
      case "styles": td.textContent = String(o.styleList.length); td.classList.add("so-num"); break;
      case "style":
        td.classList.add("so-style-cell");
        if (one) td.innerHTML = soStyleLinkHtml(one);
        else {
          td.innerHTML = `<button type="button" class="so-expand" data-expand aria-expanded="${open}" title="${open ? "Hide" : "Show"} the ${o.styleList.length} styles">`
            + `<span class="so-expand-arrow" aria-hidden="true">▸</span>${o.styleList.length} styles</button>`;
        }
        break;
      case "oh": case "wip": case "ats":
        if (one) soQtyCell(td, col, one.styleNo, one.color);
        break;
      case "comments": {
        const n = so.commentCounts.get(o.orderNo) ?? 0;
        if (n) td.innerHTML = `<span class="so-comment-count" title="${n} comment${n === 1 ? "" : "s"}">💬 ${n}</span>`;
        break;
      }
    }
    tr.appendChild(td);
  });
  if (!open) return [tr];
  // Opened: each style with its qty on the SO and its OH / WIP / ATS.
  const subs = o.styleList.map((s, i) => {
    const sub = document.createElement("tr");
    sub.className = "so-sub-row clickable-row" + (i === o.styleList.length - 1 ? " is-last" : "");
    sub.dataset.styleNo = s.styleNo;
    sub.dataset.color = s.color;
    sub.title = `Open ${s.styleNo} ${s.color}`;
    cols.forEach(col => {
      const td = document.createElement("td");
      td.dataset.col = col;
      if (col === "qty") { td.textContent = soQty(s.units); td.classList.add("so-num"); }
      else if (col === "style") { td.classList.add("so-style-cell"); td.innerHTML = soStyleLinkHtml(s); }
      else if (col === "oh" || col === "wip" || col === "ats") soQtyCell(td, col, s.styleNo, s.color);
      sub.appendChild(td);
    });
    return sub;
  });
  return [tr, ...subs];
}

function renderSoPager() {
  renderTablePager("soPager", {
    total: soTable.rows.length,
    page: soTable.page,
    pageSize: soTable.pageSize,
    noun: "SOs",
    onPage: n => {
      soTable.page = n;
      renderSoTable();
      document.getElementById("soTableWrap")?.scrollTo({ top: 0 });
    },
    onPageSize: n => {
      soTable.pageSize = n;
      saveTablePageSize("soTable", n);
      soTable.page = 1;
      renderSoTable();
    },
  });
}

async function renderN41OrdersPage() {
  syncSoLayers();
  if (so.open) return renderSoDetail();
  renderSoList();
  try {
    await ensureN41SoData();
  } catch (err) {
    showIndicator(err.message || "Couldn't load the orders.", "error");
    return;
  }
  if (getCurrentAppView() !== "n41Orders" || so.open) return;
  renderN41OrdersFilters();
  renderSoList();
}

// ── An SO's page ─────────────────────────────────────────────────────────────

async function openSoDetail(orderNo) {
  // Where it was opened from, when that's another page — the back arrow returns there.
  if (getCurrentAppView() !== "n41Orders") so.openedFrom = getCurrentAppView();
  else if (!so.open) so.openedFrom = "";
  so.open = String(orderNo);
  updateAppBackButton();
  if (getCurrentAppView() !== "n41Orders") switchAppView("n41Orders");
  else renderSoDetail();
  await ensureN41SoData().catch(() => {});
  if (so.open === String(orderNo)) renderSoDetail();
  loadSoComments(so.open);
  subscribeSoComments(so.open);
}

function closeSoDetail() {
  if (!so.open) return;
  so.open = null;
  so.editing = "";
  unsubscribeSoComments();
  closeStylePane();
  syncSoLayers();
  updateAppBackButton();
  renderN41OrdersFilters();
  renderSoList();
}

function soField(label, value, { html = false } = {}) {
  const v = html ? value : soEsc(value || "–");
  return `<div class="so-field"><span class="so-field-label">${soEsc(label)}</span><span class="so-field-value">${v || "–"}</span></div>`;
}

function soSizesHtml(l) {
  const sizes = (l.sizes ?? []).filter(x => x.qty || x.open);
  if (!sizes.length) return "–";
  return `<span class="so-sizes">${sizes.map(x => `<span class="so-size" title="${soEsc(x.size)}: ${soQty(x.qty)} ordered${x.open ? `, ${soQty(x.open)} open` : ""}"><span class="so-size-name">${soEsc(x.size)}</span><span class="so-size-qty">${soQty(x.qty)}</span></span>`).join("")}</span>`;
}

function renderSoDetail() {
  syncSoLayers();
  const o = so.orders.get(so.open);
  const main = document.getElementById("soDetailMain");
  if (!o) {
    document.getElementById("soDetailTitle").textContent = `SO # ${so.open}`;
    document.getElementById("soDetailTags").innerHTML = "";
    document.getElementById("soDetailMeta").innerHTML = "";
    main.innerHTML = `<div class="so-empty">${so.lines ? "This SO isn't in the imported orders." : "Loading…"}</div>`;
    renderSoComments();
    return;
  }
  const h = o.head;
  document.getElementById("soDetailTitle").textContent = `SO # ${o.orderNo}`;
  document.getElementById("soDetailTags").innerHTML = `${soStatusPill(o.status)}${h.order_type ? soTypePillHtml(h.order_type) : ""}`;
  document.getElementById("soDetailMeta").innerHTML = [
    ["Customer", `<button type="button" class="so-link" data-so-customer="${soEsc(h.customer)}">${soEsc(h.customer || "–")}</button>`, true],
    ["Customer PO", h.customer_po],
    ["Order date", soDate(h.order_date)],
    ["Ship date", soDate(h.ship_date)],
    ["Cancel date", soDate(h.cancel_date)],
  ].map(([label, value, html]) => `<div class="po-detail-meta-item"><span class="po-detail-meta-label">${soEsc(label)}</span><span class="po-detail-meta-value">${html ? value : soEsc(value || "–")}</span></div>`).join("");

  // The customer and how it ships / pays.
  const na = v => (v && v !== "NA" ? v : "");
  const address = [na(h.address), [na(h.city), na(h.state)].filter(Boolean).join(", "), na(h.zip)].filter(Boolean).join(" · ");
  const customerOrders = so.customers.find(c => c.key === (h.customer || h.cust_name || "—"))?.orders ?? [];
  const others = customerOrders.filter(x => x.orderNo !== o.orderNo);
  const customerCard = `<section class="po-detail-section so-card">
    <div class="po-detail-section-head"><h3>Customer</h3></div>
    <div class="so-fields">
      ${soField("Name", soPersonName(h) || h.customer)}
      ${soField("Contact", na(h.contact))}
      ${soField("Email", na(h.email) ? `<a href="mailto:${soEsc(h.email)}">${soEsc(h.email)}</a>` : "", { html: true })}
      ${soField("Phone", na(h.phone))}
      ${soField("Address", address)}
      ${soField("Type", h.customer_type)}
      ${soField("Terms", h.terms)}
      ${soField("Payment", h.payment_code)}
      ${soField("Ship via", h.ship_via)}
    </div>
    ${others.length ? `<div class="so-others"><span class="so-field-label">Other orders</span><span class="so-others-list">${others.slice(0, 30).map(x => `<button type="button" class="po-detail-other" data-so="${soEsc(x.orderNo)}" title="${soEsc(x.status)} · ${soDate(x.head.order_date)}">${soEsc(x.orderNo)}</button>`).join("")}${others.length > 30 ? `<span class="so-sub-num">+${others.length - 30} more</span>` : ""}</span></div>` : ""}
  </section>`;

  const lineRows = o.lines.map(l => {
    const style = findStyle(l.style_no, l.color);
    return `<tr class="${style ? "clickable-row so-line-row" : ""}" data-style-no="${soEsc(l.style_no)}" data-color="${soEsc(l.color)}"${style ? ` title="Open ${soEsc(l.style_no)} ${soEsc(l.color)}"` : ""}>
      <td class="so-line-thumb" data-thumb></td>
      <td class="so-line-style"><strong>${soEsc(l.style_no)}</strong><span>${soEsc(l.color)}</span></td>
      <td class="so-line-desc" title="${soEsc(l.description)}">${soEsc(l.description || "–")}${l.category ? `<span class="so-sub-num">${soEsc(l.category)}</span>` : ""}</td>
      <td>${soSizesHtml(l)}</td>
      <td class="num">${soQty(l.total_units)}</td>
      <td class="num">${soMoney(l.price)}</td>
      <td class="num">${soMoney(l.ext_price)}</td>
      <td class="num">${soQty(l.inv_qty)}</td>
      <td class="num">${soQty(l.cancel_qty)}</td>
      <td class="num${l.open_qty ? " is-open" : ""}">${soQty(l.open_qty)}</td>
      <td>${soStatusPill(l.status)}</td>
    </tr>`;
  }).join("");
  const linesCard = `<section class="po-detail-section so-card">
    <div class="po-detail-section-head"><h3>Lines</h3><span class="po-detail-count">${o.lines.length}</span></div>
    <div class="so-lines-scroll"><table class="so-lines">
      <thead><tr><th aria-label="Photo"></th><th>Style</th><th>Description</th><th>Sizes</th><th class="num">Units</th><th class="num">Price</th><th class="num">Amount</th><th class="num">Invoiced</th><th class="num">Canceled</th><th class="num">Open</th><th>Status</th></tr></thead>
      <tbody>${lineRows}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="num">${soQty(o.units)}</td><td></td><td class="num">${soMoney(o.amount)}</td><td class="num">${soQty(o.invQty)}</td><td class="num">${soQty(o.cancelQty)}</td><td class="num">${soQty(o.openQty)}</td><td></td></tr></tfoot>
    </table></div>
    <div class="so-totals">
      ${soField("Invoiced", soMoney(o.invAmt))}
      ${soField("Open", soMoney(o.openAmt))}
    </div>
  </section>`;
  const memo = [...new Set(o.lines.map(l => l.memo).filter(Boolean))].join("\n\n");
  const memoCard = memo ? `<section class="po-detail-section so-card"><div class="po-detail-section-head"><h3>Memo</h3></div><div class="so-memo">${soEsc(memo)}</div></section>` : "";
  main.innerHTML = customerCard + linesCard + memoCard;
  main.querySelectorAll("td[data-thumb]").forEach(td => {
    const tr = td.closest("tr");
    td.appendChild(createStyleThumb(tr.dataset.styleNo, tr.dataset.color));
  });
  syncStylePaneRows?.();
  renderSoComments();
}

// ── Comments ─────────────────────────────────────────────────────────────────

async function loadSoComments(orderNo) {
  if (typeof chat !== "undefined" && !chat.people?.size) {
    try { await loadChatPeople(); } catch { /* names fall back */ }
  }
  const res = await requireClient().from("n41_so_comments").select("id, order_no, author_id, body, created_at, edited_at")
    .eq("order_no", orderNo).order("created_at");
  if (so.open !== orderNo) return;
  if (res.error) {
    so.comments = [];
    so.commentsFor = orderNo;
    renderSoComments(res.error.message);
    return;
  }
  so.comments = res.data;
  so.commentsFor = orderNo;
  so.commentCounts.set(orderNo, res.data.length);
  renderSoComments();
}

function renderSoComments(error = "") {
  const list = document.getElementById("soCommentList");
  const count = document.getElementById("soCommentCount");
  if (!list) return;
  const ready = so.commentsFor === so.open;
  count.textContent = ready && so.comments.length ? String(so.comments.length) : "";
  if (error) { list.innerHTML = `<div class="so-empty is-small">${soEsc(error)}</div>`; return; }
  if (!ready) { list.innerHTML = `<div class="so-empty is-small">Loading…</div>`; return; }
  if (!so.comments.length) {
    list.innerHTML = `<div class="so-empty is-small">No comments yet. Notes for the team on this order go here.</div>`;
    return;
  }
  const me = typeof chat !== "undefined" ? chat.me : null;
  list.innerHTML = so.comments.map(c => {
    const mine = c.author_id === me;
    const when = new Date(c.created_at);
    const time = when.toLocaleString(undefined, { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" });
    const editing = so.editing === c.id;
    return `<article class="so-comment" data-comment="${soEsc(c.id)}">
      ${chatAvatarHtml(c.author_id, "sm")}
      <div class="so-comment-body">
        <div class="so-comment-head">
          <span class="so-comment-author">${soEsc(chatPerson(c.author_id).name)}</span>
          <time title="${soEsc(when.toLocaleString())}">${soEsc(time)}${c.edited_at ? " · edited" : ""}</time>
          ${mine && !editing ? `<span class="so-comment-actions"><button type="button" class="btn-link" data-comment-edit>Edit</button><button type="button" class="btn-link" data-comment-delete>Delete</button></span>` : ""}
        </div>
        ${editing
          ? `<textarea class="so-comment-input" data-comment-edit-box rows="3">${soEsc(c.body)}</textarea>
             <div class="so-comment-edit-actions"><button type="button" class="btn" data-comment-cancel>Cancel</button><button type="button" class="btn btn-primary" data-comment-save>Save</button></div>`
          : `<div class="so-comment-text">${soEsc(c.body)}</div>`}
      </div>
    </article>`;
  }).join("");
  if (so.editing) list.querySelector("[data-comment-edit-box]")?.focus();
  else list.scrollTop = list.scrollHeight;
}

async function postSoComment() {
  const box = document.getElementById("soCommentInput");
  const body = box.value.trim();
  if (!body || !so.open) return;
  const btn = document.getElementById("soCommentSend");
  btn.disabled = true;
  try {
    throwIfError(await requireClient().from("n41_so_comments").insert({ order_no: so.open, body }));
    box.value = "";
    await loadSoComments(so.open);
  } catch (err) {
    showIndicator(err.message || "Couldn't post the comment.", "error");
  } finally {
    btn.disabled = false;
    box.focus();
  }
}

async function saveSoCommentEdit(id, body) {
  const text = body.trim();
  if (!text) return;
  try {
    throwIfError(await requireClient().from("n41_so_comments").update({ body: text, edited_at: new Date().toISOString() }).eq("id", id));
    so.editing = "";
    await loadSoComments(so.open);
  } catch (err) {
    showIndicator(err.message || "Couldn't save the comment.", "error");
  }
}

async function deleteSoComment(id) {
  if (!confirm("Delete this comment?")) return;
  try {
    throwIfError(await requireClient().from("n41_so_comments").delete().eq("id", id));
    await loadSoComments(so.open);
  } catch (err) {
    showIndicator(err.message || "Couldn't delete the comment.", "error");
  }
}

/** Teammates' comments on the open SO appear as they're posted. */
function subscribeSoComments(orderNo) {
  unsubscribeSoComments();
  try {
    so.channel = requireClient().channel(`so-comments-${orderNo}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "n41_so_comments", filter: `order_no=eq.${orderNo}` }, () => {
        if (so.open === orderNo && !so.editing) loadSoComments(orderNo);
      })
      .subscribe();
  } catch { /* live updates are a bonus */ }
}

function unsubscribeSoComments() {
  if (so.channel) {
    try { requireClient().removeChannel(so.channel); } catch { /* gone already */ }
    so.channel = null;
  }
}

// ── After an import ──────────────────────────────────────────────────────────

async function refreshN41OrdersAfterImport() {
  if (!so.lines && getCurrentAppView() !== "n41Orders") return;
  await ensureN41SoData({ force: true }).catch(() => {});
  if (getCurrentAppView() === "n41Orders") renderN41OrdersPage();
}

function initN41Orders() {
  const search = document.getElementById("soSearch");
  let timer = 0;
  search?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { so.filters.q = search.value.trim(); so.shown = SO_CUSTOMERS_PER_PAGE; renderSoList(); }, 200);
  });
  document.getElementById("soStatusFilters")?.addEventListener("click", e => {
    const btn = e.target.closest("[data-so-status]");
    if (!btn) return;
    so.filters.status = btn.dataset.soStatus;
    so.shown = SO_CUSTOMERS_PER_PAGE;
    renderN41OrdersFilters();
    renderSoList();
  });
  // The table: sort, the Type filter, ▸ to open an SO's styles, a style → its pane, a row → the SO.
  soTable.pageSize = readTablePageSize("soTable");
  initColumnSort("soTable", soTable.sort, SO_SORT_COLUMNS, renderSoTable);
  initColumnFilter("soTable", "type", { options: soTypeFilterOptions, onChange: renderSoTable });
  document.getElementById("soTableBody")?.addEventListener("click", e => {
    const expand = e.target.closest("[data-expand]");
    if (expand) {
      const no = expand.closest("tr[data-so]").dataset.so;
      if (soTable.expanded.has(no)) soTable.expanded.delete(no);
      else soTable.expanded.add(no);
      return renderSoTable();
    }
    const style = e.target.closest(".so-style-link, tr.so-sub-row");
    if (style) return openStylePane(style.dataset.styleNo, style.dataset.color);
    const row = e.target.closest("tr[data-so]");
    if (row) openSoDetail(row.dataset.so);
  });
  document.getElementById("soTypeFilter")?.addEventListener("change", e => {
    so.filters.type = e.target.value;
    so.shown = SO_CUSTOMERS_PER_PAGE;
    renderN41OrdersList();
  });
  document.getElementById("soRefresh")?.addEventListener("click", async () => {
    await ensureN41SoData({ force: true }).catch(err => showIndicator(err.message, "error"));
    renderN41OrdersPage();
  });
  document.getElementById("soList")?.addEventListener("click", e => {
    if (e.target.closest("#soMoreBtn")) {
      so.shown += SO_CUSTOMERS_PER_PAGE;
      return renderN41OrdersList();
    }
    const row = e.target.closest("tr[data-so]");
    if (row) openSoDetail(row.dataset.so);
  });
  document.getElementById("soDetail")?.addEventListener("click", e => {
    const other = e.target.closest("[data-so]");
    if (other) return openSoDetail(other.dataset.so);
    const customer = e.target.closest("[data-so-customer]");
    if (customer) {
      so.filters = { q: customer.dataset.soCustomer, status: "", type: "" };
      const s = document.getElementById("soSearch");
      if (s) s.value = so.filters.q;
      return closeSoDetail();
    }
    const line = e.target.closest("tr.so-line-row");
    if (line && !e.target.closest("button, a, input")) openStylePane(line.dataset.styleNo, line.dataset.color);
  });
  // Comments: Enter posts, Shift+Enter is a new line.
  const input = document.getElementById("soCommentInput");
  input?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      postSoComment();
    }
  });
  document.getElementById("soCommentSend")?.addEventListener("click", postSoComment);
  document.getElementById("soCommentList")?.addEventListener("click", e => {
    const el = e.target.closest("[data-comment]");
    if (!el) return;
    const id = el.dataset.comment;
    if (e.target.closest("[data-comment-edit]")) { so.editing = id; return renderSoComments(); }
    if (e.target.closest("[data-comment-cancel]")) { so.editing = ""; return renderSoComments(); }
    if (e.target.closest("[data-comment-save]")) return saveSoCommentEdit(id, el.querySelector("[data-comment-edit-box]").value);
    if (e.target.closest("[data-comment-delete]")) return deleteSoComment(id);
  });
  document.getElementById("soCommentList")?.addEventListener("keydown", e => {
    const box = e.target.closest("[data-comment-edit-box]");
    if (!box) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveSoCommentEdit(box.closest("[data-comment]").dataset.comment, box.value); }
    if (e.key === "Escape") { e.stopPropagation(); so.editing = ""; renderSoComments(); }
  });
  // Esc on the SO page goes back to the list (a style pane open over it closes first).
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !so.open || getCurrentAppView() !== "n41Orders") return;
    if (paneStyle || e.target.closest?.("input, textarea, select") || document.querySelector(".modal-backdrop.open")) return;
    closeSoDetail();
  });
}
