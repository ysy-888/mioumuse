/**
 * Magento → Orders and Customers. Read-only, except a customer's
 * activation (the store's own "Is Activated" field), which can be changed
 * from the table or the pane, and canceling orders (js/magento-n41.js).
 *
 * Two lists from the store, each filtered, searched, sorted and paged by
 * Magento (the helper's orders / customers actions), and one side pane that
 * shows an order (items, totals, addresses, shipments, comments) or a
 * customer (details, addresses, their orders). From a customer's orders an
 * order opens; from an order its customer does; Back returns.
 *
 * Orders: Status header filter (only statuses in use, with counts), Placed
 * quick filter (All / Today / 7 / 30 days), search by order #, name, email.
 * Customers: Group header filter, Joined quick filter, search by name, email.
 *
 * Needs the integration's Sales → Operations → Orders (+ Shipments for
 * tracking) and Customers → All Customers permissions; a missing one is
 * named in the table.
 */

const MG_SALES = {
  orders: {
    table: "mgOrdersTable",
    body: "mgOrdersBody",
    noun: ["order", "orders"],
    sortable: new Set(["number", "date", "customer", "email", "status", "qty", "total"]),
    query: { page: 1, pageSize: 50, sort: null, dir: "ASC", search: "", status: null, from: "", flagged: false },
  },
  customers: {
    table: "mgCustomersTable",
    body: "mgCustomersBody",
    noun: ["customer", "customers"],
    sortable: new Set(["name", "email", "group", "createdAt"]),
    // activation: the ticked values of the store's Is Activated field (null = all).
    query: { page: 1, pageSize: 50, sort: null, dir: "ASC", search: "", groupId: null, activation: null, from: "" },
  },
};
Object.values(MG_SALES).forEach(s => Object.assign(s, { page: { items: [], total: 0 }, loading: false, error: "", loaded: false, seq: 0 }));

/** status → count, statuses in use (orderFacets). */
let mgOrderStatusCounts = null;
/** [{ id, code, count }] (customerGroups). */
let mgCustomerGroups = null;
/**
 * The store's own customer fields (customerFields): { company, activation:
 * { code, label, input, options }, activationCounts, all } — Company and Is
 * Activated aren't Magento's own, so they're found by label.
 */
let mgCustomerFields = null;
let mgCustomerFieldsWarned = false;

const MG_ORDER_STATUS_LABELS = {
  holded: "On Hold",
  pending_payment: "Pending Payment",
  payment_review: "Payment Review",
  canceled: "Canceled",
};

function mgOrderStatusLabel(status) {
  return MG_ORDER_STATUS_LABELS[status] ?? String(status || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function mgGroupName(id) {
  return mgCustomerGroups?.find(g => g.id === String(id))?.code ?? (id === null || id === undefined ? "" : `Group ${id}`);
}

function isMgSalesView(view = mgSubview) {
  return view === "orders" || view === "customers";
}

function formatMgMoney(value, currency) {
  if (value === null || value === undefined || value === "") return EMPTY_DISPLAY;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || mgStore?.currency || "USD" }).format(Number(value));
  } catch {
    return Number(value).toFixed(2);
  }
}

/** "2026-10-20 14:03:11" (UTC) → local "10/20/26 7:03 AM" (time optional). */
function formatMgDateTime(value, { time = false } = {}) {
  if (!value) return EMPTY_DISPLAY;
  const d = new Date(`${String(value).replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return formatMgDate(value);
  return d.toLocaleString(undefined, time
    ? { month: "2-digit", day: "2-digit", year: "2-digit", hour: "numeric", minute: "2-digit" }
    : { month: "2-digit", day: "2-digit", year: "2-digit" });
}

/** YYYY-MM-DD this many days back (0 = today), or "" for all. */
function mgDaysAgo(days) {
  if (days === "" || days === undefined) return "";
  const d = new Date();
  d.setDate(d.getDate() - Number(days));
  return todayYmdFrom(d);
}

function todayYmdFrom(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Loading ──────────────────────────────────────────────────────────────────

async function loadMgSales(kind) {
  const s = MG_SALES[kind];
  const seq = ++s.seq;
  // A header filter with nothing ticked matches nothing.
  if (s.query.status?.length === 0 || s.query.groupId?.length === 0 || s.query.activation?.length === 0) {
    s.page = { items: [], total: 0 };
    s.loading = false;
    s.error = "";
    renderMgSales(kind);
    return;
  }
  s.loading = true;
  s.error = "";
  renderMgSales(kind);
  try {
    const page = kind === "orders" && s.query.flagged
      ? await loadMgFlaggedPage(s.query.page, s.query.pageSize) // js/magento-n41.js
      : await callMagento(kind, mgSalesParams(kind));
    if (seq !== s.seq) return;
    s.page = page;
  } catch (err) {
    if (seq !== s.seq) return;
    s.error = err.message || `Couldn't load ${s.noun[1]}.`;
    s.page = { items: [], total: 0 };
  }
  s.loading = false;
  s.loaded = true;
  renderMgSales(kind);
}

/** What's sent to Magento — the activation filter with its field's code. */
function mgSalesParams(kind, extra = {}) {
  const q = { ...MG_SALES[kind].query, ...extra };
  if (kind === "customers") {
    const code = mgCustomerFields?.activation?.code;
    q.activation = code && q.activation ? { code, values: q.activation } : null;
  }
  return q;
}

/** The filter options: statuses in use, customer groups and fields. Quietly skipped if not allowed. */
async function loadMgSalesFacets(kind) {
  if (kind === "orders") {
    const [counts] = await Promise.all([
      callMagento("orderFacets").catch(() => mgOrderStatusCounts),
      refreshMgN41(), // js/magento-n41.js
    ]);
    mgOrderStatusCounts = counts;
    renderMgOrderStatusButtons();
    if (MG_SALES.orders.query.flagged) await loadMgSales("orders");
  } else {
    const [groups, fields] = await Promise.all([
      callMagento("customerGroups").catch(() => mgCustomerGroups),
      callMagento("customerFields").catch(err => ({ error: err.message })),
    ]);
    mgCustomerGroups = groups;
    mgCustomerFields = fields?.error ? (mgCustomerFields ?? fields) : fields;
    syncMgActivationHeader();
    // No Is Activated field found: say which fields the store has.
    if (!mgCustomerFieldsWarned && mgCustomerFields && !mgCustomerFields.activation) {
      mgCustomerFieldsWarned = true;
      const names = (mgCustomerFields.all ?? []).map(f => `${f.label} (${f.code})`).join(", ");
      showIndicator(mgCustomerFields.error
        ? `Couldn't read the store's customer fields: ${mgCustomerFields.error}`
        : `Couldn't find an "Is Activated" customer field. The store's own customer fields: ${names || "none"}.`, "error");
    }
  }
  renderMgSales(kind);
  if (mgSalesPane?.kind === "customers") renderMgSalesPane();
}

/** The column's header says what the store calls the field. */
function syncMgActivationHeader() {
  const label = document.querySelector('#mgCustomersTable th[data-col="activation"] .th-label')
    ?? document.querySelector('#mgCustomersTable th[data-col="activation"]');
  if (label && mgCustomerFields?.activation) label.textContent = mgCustomerFields.activation.label;
  // The toolbar's Activated / Not activated shortcuts, once there's a field.
  const found = Boolean(mgCustomerFields?.activation);
  ["mgActivationFilters", "mgActivationDivider"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = !found;
  });
  syncMgSalesButtons();
}

/**
 * The values the Activated / Not activated buttons stand for. A yes / no
 * field: 1 / 0. A choice: the "approved / active / yes" options, and the
 * rest (Pending, Declined…).
 */
function mgActivationGroup(which) {
  const f = mgCustomerFields?.activation;
  if (!f) return null;
  if (isMgBooleanActivation(f)) return [which === "on" ? "1" : "0"];
  const isOn = o => /^(approved|activ(e|ated)|yes|enabled)\b/i.test(o.label);
  return f.options.filter(o => (which === "on") === isOn(o)).map(o => o.value);
}

/** A button: sets the header filter to its values (All clears it). */
function setMgActivationButton(which) {
  const values = which ? mgActivationGroup(which) : null;
  setColumnFilterSelection("mgCustomersTable", "activation", values);
  setMgSalesQuery("customers", { activation: values });
}

/** The order statuses, in the order an order moves through them; any others after. */
const MG_ORDER_STATUS_ORDER = ["pending", "pending_payment", "payment_review", "processing", "holded", "complete", "closed", "canceled", "fraud"];

/**
 * The toolbar's status buttons — All, then one per status in use. Each sets
 * the Status header filter to just that status.
 */
function renderMgOrderStatusButtons() {
  const group = document.getElementById("mgOrderStatusFilters");
  if (!group) return;
  const rank = s => (MG_ORDER_STATUS_ORDER.indexOf(s) + 1) || MG_ORDER_STATUS_ORDER.length + 1;
  const statuses = Object.keys(mgOrderStatusCounts ?? {}).sort((a, b) => rank(a) - rank(b));
  const button = (status, label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn";
    btn.dataset.status = status;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      const values = status ? [status] : null;
      setColumnFilterSelection("mgOrdersTable", "status", values);
      setMgSalesQuery("orders", { status: values });
    });
    return btn;
  };
  group.replaceChildren(button("", "All"), ...statuses.map(s => button(s, mgOrderStatusLabel(s))));
  [group, document.getElementById("mgOrderStatusDivider")].forEach(el => { if (el) el.hidden = !statuses.length; });
  syncMgSalesButtons();
}

// ── Admin links and the license ──────────────────────────────────────────────

/**
 * A customer's or order's page in the Magento admin — when the helper's
 * MAGENTO_ADMIN_URL secret is set. (Magento's "Add Secret Key to URLs" must
 * be off for these to open the page itself rather than the Dashboard.)
 */
function mgAdminUrl(kind, id) {
  const base = mgStore?.adminUrl;
  if (!base || id === null || id === undefined) return "";
  return kind === "orders"
    ? `${base}/sales/order/view/order_id/${encodeURIComponent(id)}/`
    : `${base}/customer/index/edit/id/${encodeURIComponent(id)}/`;
}

/**
 * The uploaded business license's file name — the store's file field (found
 * by label). The API gives its stored path (/b/u/license.pdf); the file
 * itself is only viewable in the Magento admin.
 */
function mgLicenseFile(row) {
  const code = mgCustomerFields?.license?.code;
  const value = code ? row.custom?.[code] : null;
  if (!value) return "";
  const path = typeof value === "object" ? value.file ?? value.name ?? value.value ?? "" : String(value);
  return path.split("/").pop();
}

const MG_EXTERNAL_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>';

/**
 * An icon link to a customer's (or order's) page in the Magento admin —
 * the icon says it's another site. Nothing when MAGENTO_ADMIN_URL isn't set.
 */
function createMgAdminIcon(kind, id, label) {
  const url = mgAdminUrl(kind, id);
  if (!url) return null;
  const link = document.createElement("a");
  link.className = "mg-admin-icon";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.title = `${label} — opens the Magento admin in a new tab`;
  link.setAttribute("aria-label", label);
  link.innerHTML = MG_EXTERNAL_ICON;
  // Opening Magento shouldn't also open the row's pane.
  link.addEventListener("click", e => e.stopPropagation());
  return link;
}

/** The pane: the file's name with the icon to view it in Magento. */
function createMgLicensePaneValue(c) {
  const file = mgLicenseFile(c);
  const wrap = document.createElement("span");
  wrap.className = "mg-with-icon";
  if (!file) {
    wrap.textContent = "Not uploaded";
    wrap.classList.add("mg-muted");
    return wrap;
  }
  wrap.appendChild(Object.assign(document.createElement("span"), { textContent: file }));
  const icon = createMgAdminIcon("customers", c.id, "View the license in Magento");
  if (icon) wrap.appendChild(icon);
  else wrap.title = "Add the MAGENTO_ADMIN_URL secret in Supabase to link to the Magento admin, where the file can be viewed.";
  return wrap;
}

// ── Company and activation ───────────────────────────────────────────────────

/** The account's Company field when the store has one, else the address's company. */
function mgCustomerCompany(row) {
  const code = mgCustomerFields?.company?.code;
  return (code && row.custom?.[code]) || row.company || "";
}

function isMgBooleanActivation(f) {
  return f.input === "boolean" || f.options.every(o => o.value === "0" || o.value === "1");
}

function mgActivationLabel(value) {
  const f = mgCustomerFields?.activation;
  if (!f || value === null || value === undefined || value === "") return "";
  return f.options.find(o => o.value === String(value))?.label ?? String(value);
}

/**
 * The customer's activation, editable: a switch for a yes / no field, a
 * dropdown for a choice. Saves straight to Magento.
 */
function createMgActivationControl(row) {
  const f = mgCustomerFields?.activation;
  if (!f) {
    const span = document.createElement("span");
    span.className = "mg-activation-unknown";
    span.textContent = mgCustomerFields ? "?" : "…";
    span.title = mgCustomerFields ? "No Is Activated field found in this store's customer fields." : "Checking the store's customer fields…";
    return span;
  }
  const value = row.custom?.[f.code];

  if (isMgBooleanActivation(f)) {
    const on = String(value) === "1";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `mg-status-switch mg-activation-switch${on ? " is-on" : ""}`;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.innerHTML = `<span class="mg-switch-track" aria-hidden="true"><span class="mg-switch-knob"></span></span><span class="mg-switch-label">${on ? "Activated" : "Not activated"}</span>`;
    btn.title = on ? "Activated — click to deactivate" : "Not activated — click to activate";
    btn.addEventListener("click", e => {
      e.stopPropagation();
      saveMgActivation(row, on ? "0" : "1", btn);
    });
    return btn;
  }

  const select = document.createElement("select");
  select.className = "form-input mg-activation-select";
  select.setAttribute("aria-label", `${f.label} for ${row.name || row.email}`);
  if (value === null || value === undefined || value === "") select.appendChild(new Option(EMPTY_DISPLAY, ""));
  f.options.forEach(o => select.appendChild(new Option(o.label, o.value)));
  select.value = value === null || value === undefined ? "" : String(value);
  select.dataset.activation = select.value;
  select.addEventListener("click", e => e.stopPropagation());
  select.addEventListener("change", () => saveMgActivation(row, select.value, select));
  return select;
}

async function saveMgActivation(row, value, control) {
  const f = mgCustomerFields?.activation;
  if (!f || value === "") return;
  const who = row.name || row.email;
  // Turning someone off stops them signing in — check first.
  if (isMgBooleanActivation(f) && value === "0" && !confirm(`Deactivate ${who}? They won't be able to sign in to the store.`)) return;
  control.disabled = true;
  try {
    const saved = await callMagento("setCustomerActivation", { id: row.id, value });
    row.custom = saved.custom;
    // The same customer elsewhere on screen (list row, pane).
    MG_SALES.customers.page.items.forEach(c => {
      if (String(c.id) === String(row.id)) c.custom = saved.custom;
    });
    if (mgSalesPane?.kind === "customers" && String(mgSalesPane.id) === String(row.id) && mgSalesPane.data) {
      mgSalesPane.data.custom = saved.custom;
      renderMgSalesPane();
    }
    renderMgSales("customers");
    showIndicator(`${who}: ${f.label} — ${mgActivationLabel(value)}`, "success");
    // The filter's counts move.
    callMagento("customerFields").then(fields => { mgCustomerFields = fields; }).catch(() => {});
  } catch (err) {
    showIndicator(err.message || `Couldn't change ${f.label}.`, "error");
    if (control.tagName === "SELECT") control.value = control.dataset.activation ?? "";
  } finally {
    control.disabled = false;
  }
}

/** Showing a list: loads it the first time. */
function enterMgSales(kind) {
  renderMgSales(kind);
  if (MG_SALES[kind].loaded || MG_SALES[kind].loading) return;
  loadMgSales(kind);
  loadMgSalesFacets(kind);
}

/** Refresh: the lists already seen, again. */
function reloadMgSales() {
  Object.keys(MG_SALES).forEach(kind => {
    if (!MG_SALES[kind].loaded) return;
    loadMgSales(kind);
    loadMgSalesFacets(kind);
  });
}

function setMgSalesQuery(kind, changes) {
  const s = MG_SALES[kind];
  s.query = { ...s.query, ...changes, page: changes.page ?? 1 };
  syncMgSalesButtons();
  loadMgSales(kind);
}

// ── Tables ───────────────────────────────────────────────────────────────────

function createMgOrderStatusPill(status) {
  const pill = document.createElement("span");
  pill.className = "mg-order-status";
  pill.dataset.status = status;
  pill.textContent = mgOrderStatusLabel(status) || EMPTY_DISPLAY;
  return pill;
}

/** The yellow "First order" tag — the store's First Order field is set. */
function createMgFirstOrderTag() {
  const tag = document.createElement("span");
  tag.className = "mg-first-order";
  tag.textContent = "First order";
  tag.title = "This customer's first order";
  return tag;
}

function renderMgSales(kind) {
  if (mgSubview === kind) {
    updateMgCounter();
    renderMgSalesPager(kind);
  }
  if (kind === "orders") syncMgOrderSelectionUi();
  const s = MG_SALES[kind];
  const tbody = document.getElementById(s.body);
  if (!tbody) return;
  const cols = [...document.querySelectorAll(`#${s.table} thead th[data-col]`)].map(th => th.dataset.col);
  const message = text => {
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(text)}</td></tr>`;
  };
  if (mgStore?.error) return message(mgStore.error);
  if (s.error) return message(s.error);
  if (s.loading && !s.page.items.length) return message(`Loading ${s.noun[1]}…`);
  if (!s.page.items.length) {
    const q = s.query;
    const filtered = q.search || q.from || q.status || q.groupId || q.flagged;
    return message(filtered ? `No ${s.noun[1]} match the current filters.` : `No ${s.noun[1]} yet.`);
  }

  setActiveSearchQuery(s.query.search.toLowerCase());
  tbody.replaceChildren(...s.page.items.map(row => {
    const tr = document.createElement("tr");
    tr.className = "clickable-row";
    tr.dataset.id = row.id;
    if (kind === "orders" && isMgOrderFlagged(row)) tr.classList.add("mg-order-flagged");
    if (mgSalesPane?.kind === kind && String(mgSalesPane.id) === String(row.id)) tr.classList.add("is-open");
    cols.forEach(col => {
      const td = document.createElement("td");
      td.dataset.col = col;
      fillMgSalesCell(kind, col, row, td);
      tr.appendChild(td);
    });
    return tr;
  }));
  tbody.closest("table")?.classList.toggle("is-loading", s.loading);
}

function fillMgSalesCell(kind, col, row, td) {
  const text = value => mountSearchHighlightedText(td, value || EMPTY_DISPLAY);
  if (kind === "orders") {
    if (col === "select") {
      const box = createMgOrderCheckbox(row);
      if (box) td.appendChild(box);
      // The row opens the order; this cell is for the tick box.
      td.addEventListener("click", e => e.stopPropagation());
    }
    else if (col === "number") {
      text(row.number);
      td.dataset.copy = row.number;
      if (row.firstOrder) td.appendChild(createMgFirstOrderTag());
    }
    else if (col === "date") td.textContent = formatMgDateTime(row.createdAt, { time: true });
    else if (col === "customer") {
      text(row.customerName);
      if (row.guest) {
        const tag = document.createElement("span");
        tag.className = "mg-guest-tag";
        tag.textContent = "Guest";
        td.append(" ", tag);
      }
    } else if (col === "email") text(row.email);
    else if (col === "company") text(row.company);
    else if (col === "status") td.appendChild(createMgOrderStatusPill(row.status));
    else if (col === "n41") td.appendChild(createMgN41StatusCell(row));
    else if (col === "n41Customer") td.textContent = mgN41For(row.number)?.customer || EMPTY_DISPLAY;
    else if (col === "n41Order") td.textContent = mgN41For(row.number)?.soNo || EMPTY_DISPLAY;
    else if (col === "qty") { td.className = "mg-num"; td.textContent = row.qty ? String(row.qty) : EMPTY_DISPLAY; }
    else if (col === "total") { td.className = "mg-num"; td.textContent = formatMgMoney(row.total, row.currency); }
    else if (col === "shipTo") td.textContent = row.shipTo || EMPTY_DISPLAY;
    else if (col === "payment") td.textContent = row.payment || EMPTY_DISPLAY;
    else if (col === "shipping") td.textContent = row.shipping || EMPTY_DISPLAY;
    else if (col === "comment") text(row.comment);
    if (["customer", "email", "company", "n41Customer", "n41Order", "shipTo", "payment", "shipping", "comment"].includes(col)) td.title = td.textContent;
  } else {
    if (col === "name") {
      // The name, then the icon to this customer's page in the Magento admin.
      const wrap = document.createElement("span");
      wrap.className = "mg-with-icon";
      const name = document.createElement("span");
      name.className = "mg-ellipsis";
      mountSearchHighlightedText(name, row.name || EMPTY_DISPLAY);
      wrap.appendChild(name);
      const icon = createMgAdminIcon("customers", row.id, "Open in Magento");
      if (icon) wrap.appendChild(icon);
      td.appendChild(wrap);
    }
    else if (col === "email") text(row.email);
    else if (col === "group") td.textContent = mgGroupName(row.groupId) || EMPTY_DISPLAY;
    else if (col === "company") td.textContent = mgCustomerCompany(row) || EMPTY_DISPLAY;
    else if (col === "activation") td.appendChild(createMgActivationControl(row));
    else if (col === "orders") {
      td.className = "mg-num";
      td.textContent = row.orderCount === null || row.orderCount === undefined ? EMPTY_DISPLAY : row.orderCount.toLocaleString();
    }
    else if (col === "location") td.textContent = row.location || EMPTY_DISPLAY;
    else if (col === "phone") td.textContent = row.phone || EMPTY_DISPLAY;
    else if (col === "createdAt") td.textContent = formatMgDateTime(row.createdAt);
    if (["name", "email", "company", "location"].includes(col)) td.title = td.textContent;
  }
}

function renderMgSalesPager(kind) {
  const pager = document.getElementById("mgPager");
  if (!pager) return;
  const s = MG_SALES[kind];
  const { total } = s.page;
  if (!total) {
    pager.replaceChildren();
    return;
  }
  const pages = Math.max(Math.ceil(total / s.query.pageSize), 1);
  const from = (s.query.page - 1) * s.query.pageSize + 1;
  const to = Math.min(s.query.page * s.query.pageSize, total);
  const info = document.createElement("span");
  info.className = "mg-pager-info";
  info.textContent = `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`;
  const btn = (label, page, disabled, title) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = label;
    b.title = title;
    b.disabled = disabled || s.loading;
    b.addEventListener("click", () => setMgSalesQuery(kind, { page }));
    return b;
  };
  const pageLabel = document.createElement("span");
  pageLabel.className = "mg-pager-page";
  pageLabel.textContent = `Page ${s.query.page.toLocaleString()} of ${pages.toLocaleString()}`;
  const size = document.createElement("select");
  size.className = "form-input mg-pager-size";
  size.setAttribute("aria-label", `${s.noun[1]} per page`);
  MG_PAGE_SIZES.forEach(n => size.appendChild(new Option(`${n} per page`, n)));
  size.value = String(s.query.pageSize);
  size.addEventListener("change", () => setMgSalesQuery(kind, { pageSize: Number(size.value) }));
  pager.replaceChildren(
    info,
    btn("« First", 1, s.query.page <= 1, "First page"),
    btn("‹ Prev", s.query.page - 1, s.query.page <= 1, "Previous page"),
    pageLabel,
    btn("Next ›", s.query.page + 1, s.query.page >= pages, "Next page"),
    btn("Last »", pages, s.query.page >= pages, "Last page"),
    size,
  );
}

/** "1,234 orders", with where the time went on hover. */
function describeMgSalesCount(kind) {
  const s = MG_SALES[kind];
  if (s.loading && !s.page.items.length) return { text: `— ${s.noun[1]}`, title: "" };
  const n = s.page.total;
  return { text: n === 1 ? `1 ${s.noun[0]}` : `${n.toLocaleString()} ${s.noun[1]}`, title: describeMgPageTiming(kind) };
}

// ── Sorting and filters ──────────────────────────────────────────────────────

/** Ascending → descending → back to the default (newest first). */
function sortMgSalesBy(kind, col) {
  const s = MG_SALES[kind];
  if (!s.sortable.has(col)) return;
  if (s.query.sort !== col) setMgSalesQuery(kind, { sort: col, dir: "ASC" });
  else if (s.query.dir === "ASC") setMgSalesQuery(kind, { dir: "DESC" });
  else setMgSalesQuery(kind, { sort: null, dir: "ASC" });
  syncMgSalesSortHeaders(kind);
}

function syncMgSalesSortHeaders(kind) {
  const s = MG_SALES[kind];
  document.querySelectorAll(`#${s.table} thead th[data-col]`).forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.col === s.query.sort) th.classList.add(s.query.dir === "ASC" ? "sorted-asc" : "sorted-desc");
  });
}

/** The toolbar's date buttons follow the query. */
function syncMgSalesButtons() {
  [["mgOrderDateFilters", "orders"], ["mgCustomerDateFilters", "customers"]].forEach(([id, kind]) => {
    document.querySelectorAll(`#${id} .filter-btn`).forEach(btn => {
      btn.classList.toggle("active", mgDaysAgo(btn.dataset.days) === MG_SALES[kind].query.from);
    });
  });
  syncMgN41FlaggedButton(); // js/magento-n41.js
  // Status: lit when the filter is just that status (All when off).
  const status = MG_SALES.orders.query.status;
  document.querySelectorAll("#mgOrderStatusFilters .filter-btn").forEach(btn => {
    const s = btn.dataset.status;
    btn.classList.toggle("active", s ? status?.length === 1 && status[0] === s : !status?.length);
  });
  // Activation: lit when the filter holds exactly a button's values (All when off);
  // a mix ticked in the header filter lights none.
  const current = MG_SALES.customers.query.activation;
  const same = (a, b) => a && b && a.length === b.length && a.every(v => b.includes(v));
  document.querySelectorAll("#mgActivationFilters .filter-btn").forEach(btn => {
    const which = btn.dataset.activation;
    btn.classList.toggle("active", which ? same(current, mgActivationGroup(which)) : current === null);
  });
}

// ── The pane ─────────────────────────────────────────────────────────────────

/** { kind: "orders" | "customers", id, data, loading, error, back } */
let mgSalesPane = null;

function isMgSalesPaneOpen() {
  return mgSalesPane !== null;
}

async function openMgSalesPane(kind, id, { back = null } = {}) {
  const pane = document.getElementById("mgSalesPane");
  if (!pane) return;
  closeMagentoPane();
  mgSalesPane = { kind, id, data: null, loading: true, error: "", back };
  pane.hidden = false;
  pane.querySelector(".item-pane-body")?.scrollTo({ top: 0 });
  renderMgSalesPane();
  renderMgSales(kind);
  try {
    const data = await callMagento(kind === "orders" ? "order" : "customer", { id });
    if (mgSalesPane?.kind !== kind || mgSalesPane.id !== id) return;
    mgSalesPane = { ...mgSalesPane, data, loading: false };
  } catch (err) {
    if (mgSalesPane?.kind !== kind || mgSalesPane.id !== id) return;
    mgSalesPane = { ...mgSalesPane, loading: false, error: err.message || "Couldn't load it." };
  }
  renderMgSalesPane();
}

function closeMgSalesPane() {
  if (!mgSalesPane) return;
  const kind = mgSalesPane.kind;
  mgSalesPane = null;
  const pane = document.getElementById("mgSalesPane");
  if (pane) pane.hidden = true;
  renderMgSales(kind);
}

/** A labelled grid of facts. */
function mgPaneSummary(fields) {
  const grid = document.createElement("div");
  grid.className = "item-pane-summary";
  fields.filter(([, value]) => value !== null && value !== undefined && value !== "").forEach(([label, value]) => {
    const l = document.createElement("span");
    l.className = "item-pane-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "item-pane-value";
    if (value instanceof Node) v.appendChild(value);
    else v.textContent = value;
    grid.append(l, v);
  });
  return grid;
}

function mgPaneSection(title, content, count = "") {
  const section = document.createElement("section");
  section.className = "item-pane-section";
  const head = document.createElement("div");
  head.className = "item-pane-section-head";
  head.innerHTML = `<span class="item-pane-section-title"></span><span class="item-pane-section-count"></span>`;
  head.firstChild.textContent = title;
  head.lastChild.textContent = count;
  section.append(head, ...[].concat(content));
  return section;
}

function mgAddressBlock(a) {
  const block = document.createElement("div");
  block.className = "mg-address";
  if (!a) {
    block.textContent = EMPTY_DISPLAY;
    return block;
  }
  [a.name, a.company, a.street, [a.city, a.region, a.postcode].filter(Boolean).join(", "), a.country, a.phone]
    .filter(Boolean)
    .forEach(line => block.appendChild(Object.assign(document.createElement("div"), { textContent: line })));
  return block;
}

/** A small table: header row, then rows of cells (text or nodes). */
function mgMiniTable(className, header, rows, { onRow } = {}) {
  const table = document.createElement("table");
  table.className = `mg-mini-table ${className}`;
  const thead = table.createTHead().insertRow();
  header.forEach(h => thead.appendChild(Object.assign(document.createElement("th"), { textContent: h })));
  const tbody = table.createTBody();
  rows.forEach((cells, i) => {
    const tr = tbody.insertRow();
    cells.forEach(c => {
      const td = tr.insertCell();
      if (c instanceof Node) td.appendChild(c);
      else td.textContent = c;
    });
    if (onRow) {
      tr.className = "clickable-row";
      tr.addEventListener("click", () => onRow(i));
    }
  });
  return table;
}

function renderMgSalesPane() {
  if (!mgSalesPane) return;
  const { kind, data, loading, error, back } = mgSalesPane;
  const title = document.getElementById("mgSalesPaneTitle");
  const subtitle = document.getElementById("mgSalesPaneSubtitle");
  const body = document.getElementById("mgSalesPaneBody");
  const backBtn = document.getElementById("mgSalesPaneBack");
  if (backBtn) backBtn.hidden = !back;
  // "Open in Magento": this customer or order in the admin.
  const admin = document.getElementById("mgSalesPaneAdmin");
  if (admin) {
    const url = mgAdminUrl(kind, mgSalesPane.id);
    admin.hidden = !url;
    if (url) admin.href = url;
  }

  if (loading || error || !data) {
    title.textContent = kind === "orders" ? "Order" : "Customer";
    subtitle.textContent = "";
    body.replaceChildren(Object.assign(document.createElement("div"), {
      className: "item-tasks-empty mg-pane-message",
      textContent: error || "Loading from Magento…",
    }));
    return;
  }
  if (kind === "orders") renderMgOrderPane(data, title, subtitle, body);
  else renderMgCustomerPane(data, title, subtitle, body);
}

function renderMgOrderPane(o, title, subtitle, body) {
  title.textContent = `Order #${o.number}`;
  title.appendChild(createMgOrderStatusPill(o.status));
  if (o.firstOrder) title.appendChild(createMgFirstOrderTag());
  subtitle.textContent = formatMgDateTime(o.createdAt, { time: true });
  const money = v => formatMgMoney(v, o.currency);

  // The customer — a link to their pane when they have an account.
  let customer = o.customerName || o.email;
  if (o.customerId && !o.guest) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "mg-link";
    link.textContent = o.customerName || o.email;
    link.title = "Open this customer";
    link.addEventListener("click", () => openMgSalesPane("customers", o.customerId, { back: { kind: "orders", id: o.id } }));
    customer = link;
  } else if (o.guest) customer = `${o.customerName || o.email} (guest)`;

  const n41 = mgN41For(o.number);
  const summary = mgPaneSummary([
    ["N41 Status", n41 ? createMgN41StatusCell(o) : ""],
    ["N41 Customer Name", n41?.customer],
    ["Company", o.company],
    ["Customer", customer],
    ["N41 Order #", n41?.soNo],
    ["Shipping", o.shipping],
    ["Coupon", o.couponCode],
  ]);

  const items = mgMiniTable("mg-order-items", ["Item", "SKU", "Qty", "Shipped", "Price", "Total"], o.items.map(i => [
    i.name,
    i.sku,
    String(i.qtyOrdered) + (i.qtyCanceled ? ` (${i.qtyCanceled} canceled)` : "") + (i.qtyRefunded ? ` (${i.qtyRefunded} refunded)` : ""),
    String(i.qtyShipped),
    money(i.price),
    money(i.rowTotal),
  ]));

  // Payment Information: the method, the card, and the details Magento lists.
  const card = o.card;
  const payment = document.createElement("div");
  payment.appendChild(mgPaneSummary([
    ["Method", o.payment],
    ["Credit Card Number", card?.number],
    ["Card type", card?.type],
    ["Name on card", card?.owner],
    ["Expires", card?.expires],
  ]));
  const extra = (o.paymentInfo ?? []).filter(v => v !== o.payment && v !== card?.number);
  if (extra.length) {
    const list = document.createElement("div");
    list.className = "mg-payment-info";
    extra.forEach(v => list.appendChild(Object.assign(document.createElement("div"), { textContent: v })));
    payment.appendChild(list);
  }

  const comment = o.comment
    ? Object.assign(document.createElement("div"), { className: "mg-order-comment", textContent: o.comment })
    : Object.assign(document.createElement("div"), { className: "item-tasks-empty", textContent: "No order comment." });

  const t = o.totals;
  const totals = mgPaneSummary([
    ["Subtotal", money(t.subtotal)],
    ["Shipping", money(t.shipping)],
    ["Discount", Number(t.discount) ? money(t.discount) : ""],
    ["Tax", Number(t.tax) ? money(t.tax) : ""],
    ["Grand total", money(t.grandTotal)],
    ["Paid", money(t.paid)],
    ["Refunded", Number(t.refunded) ? money(t.refunded) : ""],
    ["Due", Number(t.due) ? money(t.due) : ""],
  ]);
  totals.classList.add("mg-totals");

  const addresses = document.createElement("div");
  addresses.className = "mg-address-pair";
  [["Bill to", o.billingAddress], ["Ship to", o.shippingAddress]].forEach(([label, a]) => {
    const col = document.createElement("div");
    col.appendChild(Object.assign(document.createElement("div"), { className: "item-pane-label", textContent: label }));
    col.appendChild(mgAddressBlock(a));
    addresses.appendChild(col);
  });

  const shipments = o.shipmentsProblem
    ? Object.assign(document.createElement("div"), { className: "item-tasks-empty", textContent: o.shipmentsProblem })
    : o.shipments.length
      ? mgMiniTable("mg-shipments", ["Shipment", "Date", "Qty", "Tracking"], o.shipments.map(s => [
        s.number,
        formatMgDateTime(s.createdAt),
        String(s.qty),
        s.tracks.map(tr => `${tr.title} ${tr.number}`.trim()).join(", ") || EMPTY_DISPLAY,
      ]))
      : Object.assign(document.createElement("div"), { className: "item-tasks-empty", textContent: "Not shipped yet." });

  const history = o.history.length
    ? o.history.map(h => {
      const row = document.createElement("div");
      row.className = "mg-history-row";
      const meta = document.createElement("div");
      meta.className = "mg-history-meta";
      meta.textContent = [formatMgDateTime(h.createdAt, { time: true }), mgOrderStatusLabel(h.status), h.notified ? "customer notified" : ""].filter(Boolean).join(" · ");
      const text = document.createElement("div");
      text.className = "mg-history-text";
      // Comments are HTML from Magento; keep the words, not the markup (an
      // inert parse — nothing in it runs or loads).
      text.textContent = h.comment ? new DOMParser().parseFromString(String(h.comment), "text/html").body.textContent.trim() : "";
      row.append(meta, text);
      return row;
    })
    : [Object.assign(document.createElement("div"), { className: "item-tasks-empty", textContent: "No comments." })];

  body.replaceChildren(
    summary,
    mgPaneSection("Order Comment", comment),
    mgPaneSection("Payment Information", payment),
    mgPaneSection("Items", items, String(o.items.length)),
    mgPaneSection("Totals", totals),
    mgPaneSection("Addresses", addresses),
    mgPaneSection("Shipments", shipments, o.shipments.length ? String(o.shipments.length) : ""),
    mgPaneSection("Comments", history, o.history.length ? String(o.history.length) : ""),
  );
}

function renderMgCustomerPane(c, title, subtitle, body) {
  title.textContent = c.name || c.email;
  subtitle.textContent = [c.email, mgGroupName(c.groupId)].filter(Boolean).join(" · ");
  const currency = c.orders[0]?.currency;

  const summary = mgPaneSummary([
    ["Email", c.email],
    ["Group", mgGroupName(c.groupId)],
    ["Company", mgCustomerCompany(c)],
    [mgCustomerFields?.activation?.label ?? "Is Activated", mgCustomerFields ? createMgActivationControl(c) : ""],
    [mgCustomerFields?.license?.label ?? "Business License", mgCustomerFields?.license ? createMgLicensePaneValue(c) : ""],
    ["Phone", c.phone],
    ["Joined", formatMgDateTime(c.createdAt)],
    ["Birthday", c.dob ? formatMdy(String(c.dob).slice(0, 10)) : ""],
    ["Orders", c.orderCount.toLocaleString()],
    ["Spent", `${formatMgMoney(c.lifetime, currency)}${c.orderCount > c.orders.length ? ` (last ${c.orders.length} orders)` : ""}`],
  ]);

  const addresses = c.addresses.length
    ? (() => {
      const wrap = document.createElement("div");
      wrap.className = "mg-address-list";
      c.addresses.forEach(a => wrap.appendChild(mgAddressBlock(a)));
      return wrap;
    })()
    : Object.assign(document.createElement("div"), { className: "item-tasks-empty", textContent: "No saved addresses." });

  const orders = c.orders.length
    ? mgMiniTable("mg-customer-orders", ["Order #", "Placed", "Status", "Total"], c.orders.map(o => [
      o.number,
      formatMgDateTime(o.createdAt),
      createMgOrderStatusPill(o.status),
      formatMgMoney(o.total, o.currency),
    ]), { onRow: i => openMgSalesPane("orders", c.orders[i].id, { back: { kind: "customers", id: c.id } }) })
    : Object.assign(document.createElement("div"), { className: "item-tasks-empty", textContent: "No orders yet." });

  body.replaceChildren(
    summary,
    mgPaneSection("Orders", orders, c.orderCount ? c.orderCount.toLocaleString() : ""),
    mgPaneSection("Addresses", addresses, c.addresses.length ? String(c.addresses.length) : ""),
  );
}

// ── CSV export ───────────────────────────────────────────────────────────────

async function exportMgSalesCsv(kind) {
  const s = MG_SALES[kind];
  if (!s.page.total) {
    showIndicator("Nothing to export", "error");
    return;
  }
  const rows = [];
  setAppLoading(true, `Exporting ${s.noun[1]} from Magento…`);
  try {
    for (let page = 1; ; page++) {
      const res = kind === "orders" && s.query.flagged
        ? await loadMgFlaggedPage(page, 200)
        : await callMagento(kind, mgSalesParams(kind, { page, pageSize: 200 }));
      rows.push(...(res?.items ?? []));
      setAppLoading(true, `Exporting ${s.noun[1]} from Magento… ${rows.length.toLocaleString()} of ${res.total.toLocaleString()}`);
      if (!res?.items?.length || page * 200 >= res.total) break;
    }
  } catch (err) {
    showIndicator(err.message || "Couldn't export from Magento.", "error");
    return;
  } finally {
    setAppLoading(false);
  }
  if (kind === "orders") {
    downloadCsv(`Magento orders ${todayYmd()}`,
      ["Order #", "Placed", "Status", "N41 Status", "N41 Customer", "N41 Order #", "Closed on N41", "Customer", "Guest", "Email", "Company", "First Order", "Items", "Total", "Currency", "Ship To", "Payment", "Shipping", "Order Comment"],
      rows.map(o => [o.number, o.createdAt, mgOrderStatusLabel(o.status), mgN41For(o.number)?.status ?? "", mgN41For(o.number)?.customer ?? "", mgN41For(o.number)?.soNo ?? "", isMgOrderFlagged(o) ? "Yes" : "", o.customerName, o.guest ? "Yes" : "No", o.email, o.company, o.firstOrder ? "Yes" : o.firstOrder === false ? "No" : "", o.qty, o.total ?? "", o.currency, o.shipTo, o.payment, o.shipping, o.comment]));
  } else {
    const activation = mgCustomerFields?.activation;
    downloadCsv(`Magento customers ${todayYmd()}`,
      ["Name", "Email", "Group", "Company", activation?.label ?? "Is Activated", "Orders", "Location", "Phone", "Joined", "Magento Admin"],
      rows.map(c => [c.name, c.email, mgGroupName(c.groupId), mgCustomerCompany(c), activation ? mgActivationLabel(c.custom?.[activation.code]) : "", c.orderCount ?? "", c.location, c.phone, c.createdAt, mgAdminUrl("customers", c.id)]));
  }
  showIndicator(`Exported ${rows.length.toLocaleString()} ${s.noun[1]}`, "success");
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initMagentoSales() {
  Object.entries(MG_SALES).forEach(([kind, s]) => {
    document.querySelectorAll(`#${s.table} thead th[data-col]`).forEach(th => {
      if (!s.sortable.has(th.dataset.col)) th.classList.add("th-no-sort");
      th.addEventListener("click", () => sortMgSalesBy(kind, th.dataset.col));
    });
    document.getElementById(s.body)?.addEventListener("click", e => {
      const tr = e.target.closest("tr[data-id]");
      if (tr) openMgSalesPane(kind, tr.dataset.id);
    });
    // Right-click: an order # or an email copies it (js/copy-menu.js).
    document.getElementById(s.body)?.addEventListener("contextmenu", e => {
      const td = e.target.closest('td[data-col="number"], td[data-col="email"]');
      const value = (td?.dataset.copy ?? td?.textContent ?? "").trim();
      if (value && value !== EMPTY_DISPLAY) openCopyMenu(e, value);
    });
  });

  // Header filters — only values in use, with counts (column-filter.js).
  initColumnFilter("mgOrdersTable", "status", {
    options: () => Object.entries(mgOrderStatusCounts ?? {})
      .map(([key, count]) => ({ key, label: mgOrderStatusLabel(key), count }))
      .sort((a, b) => b.count - a.count),
    onChange: () => setMgSalesQuery("orders", { status: getColumnFilterSelection("mgOrdersTable", "status") }),
  });
  initColumnFilter("mgCustomersTable", "group", {
    options: () => (mgCustomerGroups ?? []).filter(g => g.count > 0).map(g => ({ key: g.id, label: g.code, count: g.count })),
    onChange: () => setMgSalesQuery("customers", { groupId: getColumnFilterSelection("mgCustomersTable", "group") }),
  });
  initColumnFilter("mgCustomersTable", "activation", {
    options: () => {
      const f = mgCustomerFields?.activation;
      if (!f) return [];
      const counts = mgCustomerFields.activationCounts ?? {};
      return f.options.map(o => ({ key: o.value, label: o.label, count: counts[o.value] ?? 0 })).filter(o => o.count > 0);
    },
    onChange: () => setMgSalesQuery("customers", { activation: getColumnFilterSelection("mgCustomersTable", "activation") }),
  });

  [["mgOrderDateFilters", "orders"], ["mgCustomerDateFilters", "customers"]].forEach(([id, kind]) => {
    document.querySelectorAll(`#${id} .filter-btn`).forEach(btn => {
      btn.addEventListener("click", () => setMgSalesQuery(kind, { from: mgDaysAgo(btn.dataset.days) }));
    });
  });
  document.querySelectorAll("#mgActivationFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => setMgActivationButton(btn.dataset.activation));
  });
  syncMgSalesButtons();

  document.getElementById("mgSalesPaneClose")?.addEventListener("click", closeMgSalesPane);
  document.getElementById("mgSalesPaneBack")?.addEventListener("click", () => {
    const back = mgSalesPane?.back;
    if (back) openMgSalesPane(back.kind, back.id);
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !isMgSalesPaneOpen()) return;
    if (document.querySelector(".modal-backdrop.open")) return;
    closeMgSalesPane();
  });
}
