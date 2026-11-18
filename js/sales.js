/**
 * Sales Dashboard ("sales"), built on the N41 SO import (js/n41-orders.js).
 * Open SOs / Allocated / Pick Tickets sit in the app header.
 *
 *  Top: the open orders, a list each for FAIRE / FG / MAGENTO / INHOUSE /
 *    SHOW (every "2026 NY 09"-style type) / OTHER (Phone, Email, the rest),
 *    side by side, scrolling sideways when they don't fit.
 *
 *  Below: the customers (one row each, SO count on the right) and the SO
 *    Manager — three tables side by side, each with its buttons in its header:
 *    Open        — every open line on their open SOs; select → Allocate
 *    Allocated   — allocated, not on a ticket yet; select → Create pick ticket
 *    Pick Tickets — lines by ticket (Open / Picked); mark picked, reopen, or
 *                   void (lines go back to Allocated)
 *
 * The page fits the window: the lists keep their height, the SO Manager takes
 * the rest and scrolls inside.
 *
 * Allocation is kept in the app (so_allocations, one row per SO line with the
 * open units by size; pick_tickets) — N41 isn't written to. A line is allocated
 * whole: all of its open units at the time.
 */

const sales = {
  allocs: null, // sod_id → allocation row
  tickets: new Map(), // id → pick ticket row
  loading: null,
  channel: null,
  reloadTimer: 0,
  customer: "",
  search: "",
  selOpen: new Set(), // sod_id
  selAlloc: new Set(), // allocation id
  ticketFilter: "open",
  selTickets: new Set(), // pick ticket ids
  busy: false,
};

// ── Data ─────────────────────────────────────────────────────────────────────

async function loadSalesAllocations() {
  const client = requireClient();
  const allocs = [];
  for (let from = 0; ; from += 1000) {
    const res = await client.from("so_allocations").select("*").order("created_at").range(from, from + 999);
    throwIfError(res);
    allocs.push(...res.data);
    if (res.data.length < 1000) break;
  }
  const tickets = [];
  for (let from = 0; ; from += 1000) {
    const res = await client.from("pick_tickets").select("*").order("ticket_no").range(from, from + 999);
    throwIfError(res);
    tickets.push(...res.data);
    if (res.data.length < 1000) break;
  }
  sales.allocs = new Map(allocs.map(a => [String(a.sod_id), { ...a, sizes: Array.isArray(a.sizes) ? a.sizes : [] }]));
  sales.tickets = new Map(tickets.map(t => [t.id, t]));
}

async function ensureSalesData({ force = false } = {}) {
  if (!force && so.lines && sales.allocs) return;
  if (!sales.loading || force) {
    sales.loading = Promise.all([ensureN41SoData({ force }), loadSalesAllocations()]).finally(() => { sales.loading = null; });
  }
  await sales.loading;
  subscribeSales();
}

/** Teammates' allocating shows up here as it happens. */
function subscribeSales() {
  if (sales.channel) return;
  try {
    const reload = () => {
      clearTimeout(sales.reloadTimer);
      sales.reloadTimer = setTimeout(async () => {
        if (sales.busy) return;
        await loadSalesAllocations().catch(() => {});
        rerenderSalesViews();
      }, 400);
    };
    sales.channel = requireClient().channel("sales-allocations")
      .on("postgres_changes", { event: "*", schema: "public", table: "so_allocations" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "pick_tickets" }, reload)
      .subscribe();
  } catch { /* live updates are a bonus */ }
}

function rerenderSalesViews() {
  if (getCurrentAppView() !== "sales") return;
  renderSalesBoard();
  renderCustomersView();
}

/** A line still has units to ship. */
function isOpenSoLine(l) {
  return (Number(l.open_qty) || 0) > 0 && l.status !== "Closed";
}

/** Its sizes with open units: [{ size, qty }]. */
function openSizesOf(l) {
  return (l.sizes ?? []).filter(s => (Number(s.open) || 0) > 0).map(s => ({ size: s.size, qty: Number(s.open) }));
}

// ── Sales Dashboard ──────────────────────────────────────────────────────────

async function renderSalesPage() {
  rerenderSalesViews();
  try {
    await ensureSalesData();
  } catch (err) {
    showIndicator(err.message || "Couldn't load the orders.", "error");
    return;
  }
  rerenderSalesViews();
}

/**
 * The lists, in this order. SHOW is every trade-show type ("2026 NY 09" …,
 * anything starting with a year); OTHER is the rest (Phone, Email, Company …).
 */
const SALES_BOARD_GROUPS = [
  { key: "FAIRE", tone: "faire" },
  { key: "FG", tone: "fg" },
  { key: "MAGENTO", tone: "magento" },
  { key: "INHOUSE", tone: "inhouse" },
  { key: "SHOW", tone: "show" },
  { key: "OTHER", tone: "other" },
];

function salesBoardGroup(type) {
  const t = String(type ?? "").trim().toUpperCase();
  if (/^\d{4}\b/.test(t)) return "SHOW";
  return SALES_BOARD_GROUPS.some(g => g.key === t && g.key !== "SHOW" && g.key !== "OTHER") ? t : "OTHER";
}

/** Open SOs · Allocated · Open pick tickets, in the app header. */
function renderSalesHeaderStats(open) {
  const box = document.getElementById("salesHeaderStats");
  if (!box) return;
  if (!so.lines || !sales.allocs) { box.innerHTML = ""; return; }
  const allocated = [...sales.allocs.values()].filter(a => !a.pick_ticket_id);
  const units = allocated.reduce((t, a) => t + (Number(a.qty) || 0), 0);
  const tickets = [...sales.tickets.values()].filter(t => t.status === "open").length;
  const stat = (label, value, title) => `<span class="sales-header-stat" title="${title}"><span>${label}</span><strong>${value}</strong></span>`;
  box.innerHTML = stat("Open SOs", open.length.toLocaleString(), "Open sales orders")
    + stat("Allocated", soQty(units) === "–" ? "0" : soQty(units), `${allocated.length} lines allocated, not on a pick ticket yet`)
    + stat("Pick Tickets", tickets.toLocaleString(), "Open pick tickets");
}

function renderSalesBoard() {
  const board = document.getElementById("salesBoard");
  if (!board) return;
  if (!so.lines) {
    renderSalesHeaderStats([]);
    board.innerHTML = `<div class="sales-empty">Loading…</div>`;
    return;
  }
  const open = [...so.orders.values()].filter(o => o.status === "Open");
  renderSalesHeaderStats(open);
  if (!open.length) {
    board.innerHTML = `<div class="sales-empty">No open orders — import N41's Sales Orders from the menu (⋮) on N41 Orders.</div>`;
    return;
  }
  const groups = new Map(SALES_BOARD_GROUPS.map(g => [g.key, []]));
  open.forEach(o => groups.get(salesBoardGroup(o.head.order_type)).push(o));
  board.innerHTML = SALES_BOARD_GROUPS.map(({ key, tone }) => {
    const orders = groups.get(key);
    orders.sort((a, b) => String(b.head.order_date ?? "").localeCompare(String(a.head.order_date ?? "")) || (Number(b.orderNo) || 0) - (Number(a.orderNo) || 0));
    // On SHOW and OTHER, which show / type each SO is.
    const mixed = key === "SHOW" || key === "OTHER";
    const rows = orders.map(o => {
      const type = o.head.order_type || "";
      const sub = mixed && type ? `<span class="sales-subtype" data-tone="${soEsc(soTypeTone(type))}" title="${soEsc(type)}">${soEsc(key === "SHOW" ? type.replace(/^\d{4}\s*/, "") : type)}</span>` : "";
      return `<tr data-so="${soEsc(o.orderNo)}" title="Open SO ${soEsc(o.orderNo)}">
        <td class="sales-so">${soEsc(o.orderNo)}</td>
        <td class="sales-cust"><span class="sales-cust-cell"><button type="button" class="sales-cust-link" data-cust="${soEsc(o.head.customer)}" title="${soEsc(o.head.customer)} — open below">${soEsc(o.head.customer)}</button>${sub}</span></td>
        <td class="sales-date">${o.head.order_date ? soEsc(formatMdy(o.head.order_date)) : "–"}</td>
        <td class="sales-num">${soQty(o.openQty)}</td>
      </tr>`;
    }).join("");
    return `<section class="sales-card">
      <header class="sales-card-head">
        <span class="so-type" data-tone="${tone}">${key}</span>
        <span class="sales-card-count">${orders.length.toLocaleString()} open</span>
      </header>
      <div class="sales-card-body">
        ${orders.length ? `<table class="sales-table">
          <colgroup><col style="width:62px"><col><col style="width:68px"><col style="width:48px"></colgroup>
          <thead><tr><th>SO #</th><th>Customer</th><th>Date</th><th class="sales-num">Open</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>` : `<div class="cust-note">None open.</div>`}
      </div>
    </section>`;
  }).join("");
}

// ── Customers (below the lists) ──────────────────────────────────────────────

function openSalesCustomer(name) {
  sales.customer = name;
  sales.selOpen.clear();
  sales.selAlloc.clear();
  sales.selTickets.clear();
  if (getCurrentAppView() !== "sales") switchAppView("sales");
  else renderCustomersView();
}

function renderCustomersView() {
  renderCustomerList();
  renderCustomerMain();
}

/** Each customer with anything to work: open lines, allocated lines or a ticket. */
function buildSalesCustomers() {
  const map = new Map();
  const get = name => {
    if (!map.has(name)) map.set(name, { name, orders: new Set(), latest: "" });
    return map.get(name);
  };
  for (const l of so.lines ?? []) {
    if (!isOpenSoLine(l)) continue;
    const c = get(l.customer || "—");
    c.orders.add(l.order_no);
    if ((l.order_date ?? "") > c.latest) c.latest = l.order_date;
  }
  for (const a of sales.allocs?.values() ?? []) get(a.customer).orders.add(a.order_no);
  for (const t of sales.tickets.values()) if (t.status === "open") get(t.customer);
  return [...map.values()].sort((a, b) => String(b.latest).localeCompare(String(a.latest)) || a.name.localeCompare(b.name));
}

/** One row each: the customer, and their SO count on the right. */
function renderCustomerList() {
  const list = document.getElementById("custList");
  if (!list) return;
  if (!so.lines || !sales.allocs) { list.innerHTML = `<div class="cust-note">Loading…</div>`; return; }
  const q = sales.search.trim().toLowerCase();
  const all = buildSalesCustomers();
  const shown = all.filter(c => !q || c.name.toLowerCase().includes(q));
  if (!shown.length) {
    list.innerHTML = `<div class="cust-note">${all.length ? "No customers match." : "No open orders."}</div>`;
    return;
  }
  list.innerHTML = shown.map(c => `<button type="button" class="cust-row${c.name === sales.customer ? " is-active" : ""}" data-cust="${soEsc(c.name)}" title="${soEsc(c.name)}">
      <span class="cust-row-name">${buildSearchHighlightedHtml(c.name, q)}</span>
      <span class="cust-row-count">${c.orders.size}</span>
    </button>`).join("");
  list.querySelector(".cust-row.is-active")?.scrollIntoView({ block: "nearest" });
}

// ── SO Manager: a customer's lines — Open / Allocated / Pick Tickets ─────────
//
// A table per panel (side by side): Order Date, Type, SO #, Customer PO #, Style # / Color,
// Order Qty, then the style's OH / OO / WIP / ATS, AA (available to allocate:
// OH less everything allocated or on a pick ticket, any customer) and its
// Available month / IHD. Pick Tickets adds the Pick Ticket #.

const SO_MANAGER_TABS = [
  { key: "open", label: "Open" },
  { key: "alloc", label: "Allocated" },
  { key: "pt", label: "Pick Tickets" },
];

const SO_MANAGER_COLS = [
  { key: "pt", label: "Pick Ticket #", width: 90, only: "pt" },
  { key: "date", label: "Order Date", width: 74 },
  { key: "type", label: "Type", width: 88 },
  { key: "so", label: "SO #", width: 62 },
  { key: "po", label: "Customer PO #", width: 100 },
  { key: "style", label: "Style # / Color", width: 150 },
  { key: "qty", label: "Order Qty", width: 70, num: true },
  { key: "oh", label: "OH", width: 54, num: true },
  { key: "oo", label: "OO", width: 54, num: true },
  { key: "wip", label: "WIP", width: 54, num: true },
  { key: "ats", label: "ATS", width: 54, num: true },
  { key: "aa", label: "AA", width: 54, num: true, title: "Available to allocate: OH less what's allocated or on a pick ticket" },
  { key: "avail", label: "Available", width: 112 },
];

/** Units allocated or on a pick ticket, per style + colour, across every customer. */
function allocatedByStyle() {
  const map = new Map();
  for (const a of sales.allocs?.values() ?? []) {
    const key = `${a.style_no}\u0000${a.color ?? ""}`;
    map.set(key, (map.get(key) ?? 0) + (Number(a.qty) || 0));
  }
  return map;
}

/** The rows on each tab for the customer picked. */
function buildSoManagerRows(name) {
  const lineBySod = new Map((so.lines ?? []).map(l => [String(l.sod_id), l]));
  const row = (key, line, alloc, qty, sizes, ticket = null) => {
    const orderNo = alloc?.order_no ?? line?.order_no;
    const head = so.orders.get(orderNo)?.head ?? line ?? {};
    return {
      key, line, alloc, ticket, qty, sizes, orderNo,
      date: head.order_date ?? "", type: head.order_type ?? "", po: head.customer_po ?? "",
      styleNo: alloc?.style_no ?? line?.style_no ?? "", color: alloc?.color ?? line?.color ?? "",
      lineNo: line?.line ?? 0,
    };
  };
  const byDate = (a, b) => String(b.date).localeCompare(String(a.date)) || (Number(b.orderNo) || 0) - (Number(a.orderNo) || 0) || a.lineNo - b.lineNo;
  const open = (so.lines ?? [])
    .filter(l => (l.customer || "—") === name && isOpenSoLine(l) && !sales.allocs.has(String(l.sod_id)))
    .map(l => row(String(l.sod_id), l, null, Number(l.open_qty) || 0, openSizesOf(l)))
    .sort(byDate);
  const allocs = [...sales.allocs.values()].filter(a => a.customer === name);
  const alloc = allocs.filter(a => !a.pick_ticket_id)
    .map(a => row(a.id, lineBySod.get(String(a.sod_id)), a, Number(a.qty) || 0, a.sizes))
    .sort(byDate);
  const pt = allocs.filter(a => a.pick_ticket_id && sales.tickets.get(a.pick_ticket_id)?.status === sales.ticketFilter)
    .map(a => row(a.id, lineBySod.get(String(a.sod_id)), a, Number(a.qty) || 0, a.sizes, sales.tickets.get(a.pick_ticket_id)))
    .sort((a, b) => b.ticket.ticket_no - a.ticket.ticket_no || byDate(a, b));
  const tickets = [...sales.tickets.values()].filter(t => t.customer === name);
  return { open, alloc, pt, openTickets: tickets.filter(t => t.status === "open").length, pickedTickets: tickets.filter(t => t.status === "picked").length };
}

/** The selection set for a tab, and the id a row puts in it. */
function soManagerSelection(tab) {
  if (tab === "open") return { set: sales.selOpen, idOf: r => r.key };
  if (tab === "alloc") return { set: sales.selAlloc, idOf: r => r.key };
  return { set: sales.selTickets, idOf: r => r.ticket.id };
}

function soManagerCellHtml(col, r, aa) {
  switch (col.key) {
    case "pt":
      return `<span class="som-pt">PT ${soEsc(r.ticket.ticket_no)}</span>`;
    case "date": return r.date ? soEsc(formatMdy(r.date)) : EMPTY_DISPLAY;
    case "type": return r.type ? soTypePillHtml(r.type) : EMPTY_DISPLAY;
    case "so": return `<button type="button" class="som-link" data-open-so="${soEsc(r.orderNo)}" title="Open SO ${soEsc(r.orderNo)}">${soEsc(r.orderNo)}</button>`;
    case "po": {
      const po = soCleanPo(r.po);
      return po ? `<span title="${soEsc(r.po)}">${soEsc(po)}</span>` : EMPTY_DISPLAY;
    }
    case "style":
      return `<button type="button" class="som-style" data-style-no="${soEsc(r.styleNo)}" data-color="${soEsc(r.color)}" title="Open ${soEsc(r.styleNo)} ${soEsc(r.color)}">`
        + `<strong>${soEsc(r.styleNo)}</strong><span>${soEsc(r.color)}</span></button>`;
    case "qty": {
      const sizes = (r.sizes ?? []).map(s => `${s.size} ${soQty(s.qty)}`).join(" · ");
      return `<span title="${soEsc(sizes)}">${soQty(r.qty)}</span>`;
    }
    case "oh": case "oo": case "wip": case "ats": {
      const style = findStyle(r.styleNo, r.color);
      if (!style) return `<span class="som-muted" title="Not in the Styles database">${EMPTY_DISPLAY}</span>`;
      const fig = styleQtyFigures(style).find(f => f.col === col.key);
      return `<span class="som-fig${fig?.tone ? ` is-${fig.tone}` : ""}">${soEsc(fig?.text ?? EMPTY_DISPLAY)}</span>`;
    }
    case "aa": {
      const style = findStyle(r.styleNo, r.color);
      const oh = style ? Number(style.oh) || 0 : null;
      if (oh === null) return `<span class="som-muted">${EMPTY_DISPLAY}</span>`;
      const n = oh - (aa.get(`${r.styleNo}\u0000${r.color}`) ?? 0);
      return `<span class="som-fig ${n > 0 ? "is-pos" : "is-neg"}" title="OH ${oh.toLocaleString()} less ${(oh - n).toLocaleString()} allocated / picked">${n.toLocaleString()}</span>`;
    }
    case "avail": {
      const style = findStyle(r.styleNo, r.color);
      return style ? createAvailableWithIhd(style).outerHTML : EMPTY_DISPLAY;
    }
  }
  return "";
}

/** One panel: its header (title, count, selection, buttons) over its table. */
function soManagerPanelHtml(tab, data, aa) {
  const rows = data[tab];
  const { set, idOf } = soManagerSelection(tab);
  // Drop picks that aren't in the panel any more.
  const ids = new Set(rows.map(idOf));
  [...set].forEach(id => { if (!ids.has(id)) set.delete(id); });

  const cols = SO_MANAGER_COLS.filter(c => !c.only || c.only === tab);
  const allOn = rows.length > 0 && rows.every(r => set.has(idOf(r)));
  const someOn = !allOn && rows.some(r => set.has(idOf(r)));
  const width = 32 + cols.reduce((t, c) => t + c.width, 0);
  const colgroup = `<colgroup><col style="width:32px">${cols.map(c => `<col style="width:${c.width}px">`).join("")}</colgroup>`;
  const thead = `<thead><tr><th class="som-check"><input type="checkbox" class="cust-check" data-som-all ${allOn ? "checked" : ""} ${someOn ? "data-mixed" : ""} aria-label="Select all"></th>`
    + cols.map(c => `<th class="${c.num ? "som-num" : ""}"${c.title ? ` title="${soEsc(c.title)}"` : ""}>${c.label}</th>`).join("") + `</tr></thead>`;
  let prevTicket = "";
  const tbody = rows.map(r => {
    const id = idOf(r);
    const on = set.has(id);
    // Pick tickets: a rule between tickets.
    const first = tab === "pt" && r.ticket.id !== prevTicket;
    prevTicket = tab === "pt" ? r.ticket.id : "";
    return `<tr class="som-row${on ? " is-picked" : ""}${first ? " is-ticket-start" : ""}" data-som-id="${soEsc(id)}">
      <td class="som-check"><input type="checkbox" class="cust-check" data-som-pick="${soEsc(id)}" ${on ? "checked" : ""} aria-label="Select"></td>
      ${cols.map(c => `<td class="som-${c.key}${c.num ? " som-num" : ""}">${soManagerCellHtml(c, r, aa)}</td>`).join("")}
    </tr>`;
  }).join("");

  const picked = rows.filter(r => set.has(idOf(r)));
  const units = picked.reduce((t, r) => t + r.qty, 0);
  const total = rows.reduce((t, r) => t + r.qty, 0);
  const note = tab === "pt"
    ? (set.size ? `${set.size} ticket${set.size === 1 ? "" : "s"} selected` : "")
    : (picked.length ? `${picked.length} selected · ${soQty(units)}` : (rows.length ? `${soQty(total)} units` : ""));
  const off = picked.length ? "" : "disabled";
  const actions = {
    open: `<button type="button" class="btn btn-sm btn-primary" data-act="allocate" ${off}>Allocate →</button>`,
    alloc: `<button type="button" class="btn btn-sm" data-act="unallocate" ${off} title="Put the selected lines back to Open">← Unallocate</button>
      <button type="button" class="btn btn-sm btn-primary" data-act="ticket" ${off}>Create pick ticket →</button>`,
    pt: (sales.ticketFilter === "open"
      ? `<button type="button" class="btn btn-sm" data-act="picked" ${off}>Mark picked</button>`
      : `<button type="button" class="btn btn-sm" data-act="reopen" ${off}>Reopen</button>`)
      + `<button type="button" class="btn btn-sm btn-danger" data-act="void" ${off} title="Delete the tickets; their lines go back to Allocated">Void</button>`,
  }[tab];
  const filter = tab === "pt"
    ? `<div class="som-filter" role="group" aria-label="Pick ticket status">${[["open", "Open", data.openTickets], ["picked", "Picked", data.pickedTickets]].map(([k, label, n]) =>
      `<button type="button" class="som-filter-btn${sales.ticketFilter === k ? " is-active" : ""}" data-pt-filter="${k}">${label} <span>${n}</span></button>`).join("")}</div>`
    : "";
  const count = tab === "pt" ? data.openTickets : rows.length;
  const title = SO_MANAGER_TABS.find(t => t.key === tab).label;
  const empty = {
    open: "Nothing open to allocate.",
    alloc: "Nothing allocated yet — select lines on Open and Allocate.",
    pt: sales.ticketFilter === "open" ? "No open pick tickets — select lines on Allocated and Create pick ticket." : "No picked tickets.",
  }[tab];
  return `<section class="som-panel" data-som-panel="${tab}">
    <header class="som-panel-head">
      <div class="som-panel-title">
        <h3>${title}</h3><span class="som-count">${count}</span>
        ${filter}
        <span class="som-picked">${note}</span>
      </div>
      <div class="som-actions">${actions}</div>
    </header>
    <div class="som-scroll">
      ${rows.length
        ? `<table class="som-table" style="width:${width}px">${colgroup}${thead}<tbody>${tbody}</tbody></table>`
        : `<div class="cust-note som-empty">${empty}</div>`}
    </div>
  </section>`;
}

function renderCustomerMain() {
  const main = document.getElementById("custMain");
  if (!main) return;
  if (!so.lines || !sales.allocs) { main.innerHTML = `<div class="cust-placeholder">Loading…</div>`; return; }
  const name = sales.customer;
  if (!name) {
    main.innerHTML = `<div class="cust-placeholder"><strong>Pick a customer</strong><span>Their open lines, what's allocated and their pick tickets show here side by side.</span></div>`;
    return;
  }
  const data = buildSoManagerRows(name);
  const aa = allocatedByStyle();
  const lines = so.lines.filter(l => (l.customer || "—") === name);
  const head = lines.slice().sort((a, b) => String(b.order_date ?? "").localeCompare(String(a.order_date ?? "")))[0] ?? {};
  const contact = [head.customer ? soPersonName(head) : "", head.email, head.phone, [head.city, head.state].filter(Boolean).join(", ")].filter(Boolean);
  main.innerHTML = `
    <header class="som-head">
      <h2 class="cust-name">${soEsc(name)}</h2>
      ${contact.length ? `<span class="cust-contact">${contact.map(soEsc).join(" · ")}</span>` : ""}
    </header>
    <div class="som-panels">${SO_MANAGER_TABS.map(t => soManagerPanelHtml(t.key, data, aa)).join("")}</div>`;
  main.querySelectorAll("[data-mixed]").forEach(box => { box.indeterminate = true; });
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function runSalesAction(fn, done) {
  if (sales.busy) return;
  sales.busy = true;
  document.getElementById("custMain")?.classList.add("is-busy");
  try {
    await fn();
    await loadSalesAllocations();
    if (done) showIndicator(done);
  } catch (err) {
    showIndicator(err.message || "That didn't save.", "error");
  } finally {
    sales.busy = false;
    document.getElementById("custMain")?.classList.remove("is-busy");
    rerenderSalesViews();
  }
}

function allocateSelected() {
  const ids = new Set(sales.selOpen);
  const lines = so.lines.filter(l => ids.has(String(l.sod_id)) && isOpenSoLine(l));
  if (!lines.length) return;
  return runSalesAction(async () => {
    const rows = lines.map(l => ({
      sod_id: l.sod_id, order_no: l.order_no, customer: l.customer || "—",
      style_no: l.style_no, color: l.color, sizes: openSizesOf(l), qty: Number(l.open_qty) || 0,
    }));
    throwIfError(await requireClient().from("so_allocations").insert(rows));
    sales.selOpen.clear();
  }, `Allocated ${lines.length} line${lines.length === 1 ? "" : "s"}`);
}

function unallocateSelected() {
  const ids = [...sales.selAlloc];
  if (!ids.length) return;
  return runSalesAction(async () => {
    throwIfError(await requireClient().from("so_allocations").delete().in("id", ids));
    sales.selAlloc.clear();
  }, `Back to open: ${ids.length} line${ids.length === 1 ? "" : "s"}`);
}

function createPickTicket() {
  const ids = [...sales.selAlloc];
  if (!ids.length) return;
  let ticket = null;
  return runSalesAction(async () => {
    const client = requireClient();
    const res = await client.from("pick_tickets").insert({ customer: sales.customer }).select().single();
    throwIfError(res);
    ticket = res.data;
    const upd = await client.from("so_allocations").update({ pick_ticket_id: ticket.id }).in("id", ids);
    if (upd.error) {
      await client.from("pick_tickets").delete().eq("id", ticket.id);
      throwIfError(upd);
    }
    sales.selAlloc.clear();
    sales.ticketFilter = "open";
  }, "Pick ticket created");
}

function ptNames(ids) {
  return ids.map(id => `PT ${sales.tickets.get(id)?.ticket_no ?? "?"}`).join(", ");
}

function setPickTicketStatus(ids, status) {
  if (!ids.length) return;
  return runSalesAction(async () => {
    throwIfError(await requireClient().from("pick_tickets")
      .update({ status, picked_at: status === "picked" ? new Date().toISOString() : null }).in("id", ids));
    sales.selTickets.clear();
  }, `${ptNames(ids)} ${status === "picked" ? "marked picked" : "reopened"}`);
}

function voidPickTickets(ids) {
  if (!ids.length) return;
  const names = ptNames(ids);
  if (!confirm(`Void ${names}? Their lines go back to Allocated.`)) return;
  return runSalesAction(async () => {
    throwIfError(await requireClient().from("pick_tickets").delete().in("id", ids));
    sales.selTickets.clear();
  }, `${names} voided`);
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function initSales() {
  // The lists: an SO opens its page; a customer opens in the SO Manager below.
  document.getElementById("salesBoard")?.addEventListener("click", e => {
    const cust = e.target.closest("[data-cust]");
    if (cust) return openSalesCustomer(cust.dataset.cust);
    const row = e.target.closest("tr[data-so]");
    if (row) openSoDetail(row.dataset.so);
  });

  const search = document.getElementById("custSearch");
  search?.addEventListener("input", () => { sales.search = search.value; renderCustomerList(); });
  document.getElementById("custList")?.addEventListener("click", e => {
    const row = e.target.closest("[data-cust]");
    if (row) openSalesCustomer(row.dataset.cust);
  });

  const main = document.getElementById("custMain");
  // Re-draw, keeping each panel's table where it was scrolled.
  const rerender = () => {
    const at = [...main.querySelectorAll(".som-scroll")].map(s => [s.closest("[data-som-panel]").dataset.somPanel, s.scrollTop, s.scrollLeft]);
    renderCustomerMain();
    at.forEach(([panel, top, left]) => {
      const s = main.querySelector(`[data-som-panel="${panel}"] .som-scroll`);
      if (s) { s.scrollTop = top; s.scrollLeft = left; }
    });
  };
  const panelOf = el => el.closest("[data-som-panel]")?.dataset.somPanel;
  main?.addEventListener("click", e => {
    const style = e.target.closest(".som-style");
    if (style) return openStylePane(style.dataset.styleNo, style.dataset.color);
    const soLink = e.target.closest("[data-open-so]");
    if (soLink) return openSoDetail(soLink.dataset.openSo);
    const filter = e.target.closest("[data-pt-filter]");
    if (filter) { sales.ticketFilter = filter.dataset.ptFilter; sales.selTickets.clear(); return rerender(); }
    const act = e.target.closest("[data-act]");
    if (act) {
      const a = act.dataset.act;
      if (a === "allocate") return allocateSelected();
      if (a === "unallocate") return unallocateSelected();
      if (a === "ticket") return createPickTicket();
      if (a === "picked") return setPickTicketStatus([...sales.selTickets], "picked");
      if (a === "reopen") return setPickTicketStatus([...sales.selTickets], "open");
      if (a === "void") return voidPickTickets([...sales.selTickets]);
      return;
    }
    // A click anywhere else on a row ticks it.
    const row = e.target.closest("tr[data-som-id]");
    if (row && !e.target.closest("input, button, a")) {
      const { set } = soManagerSelection(panelOf(row));
      const id = row.dataset.somId;
      if (set.has(id)) set.delete(id);
      else set.add(id);
      rerender();
    }
  });
  main?.addEventListener("change", e => {
    const box = e.target.closest(".cust-check");
    if (!box) return;
    const panel = panelOf(box);
    const { set, idOf } = soManagerSelection(panel);
    if (box.dataset.somPick) {
      if (box.checked) set.add(box.dataset.somPick);
      else set.delete(box.dataset.somPick);
    } else if (box.hasAttribute("data-som-all")) {
      set.clear();
      if (box.checked) buildSoManagerRows(sales.customer)[panel].forEach(r => set.add(idOf(r)));
    }
    rerender();
  });
}
