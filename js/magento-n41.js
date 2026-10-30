/**
 * Magento → Orders against N41's Sales Orders report.
 *
 * Orders go from Magento to N41, and invoicing on N41 updates Magento — but
 * canceling on N41 doesn't, so those orders sit Pending or Processing on
 * Magento forever. Import N41 Sales Orders reads the report here in the
 * browser (.xlsx, .xls or .csv) and saves each web order's status
 * (n41_orders):
 *
 *   Column C  Cust. Name
 *   Column H  Order # (the SO #; an order on several rows has one for each)
 *   Column I  Status
 *   Column P  Cust. PO # — "Web:00000061" is Magento order 61; any other PO
 *             isn't from the web store and is skipped
 *
 * An order can fill several rows; it's Closed only if every row is. Reports
 * cover a date range, so an import adds and updates, and never clears.
 *
 * The Orders table then shows N41 Status, and flags an order that's Closed on
 * N41 but Pending or Processing on Magento. Magento can't filter on the app's
 * data, so the Closed on N41 button compares the report with every open order
 * (the helper's openOrders) and filters, sorts and pages that list here; only
 * the page on screen is then read in full.
 *
 * Tick orders and Cancel orders cancels them on Magento (the helper's
 * cancelOrders): everything not invoiced yet is canceled. This can't be undone.
 */

/** orderKey → { poNo, soNo, customer, status }; empty until a report is imported. */
let mgN41 = new Map();
let mgN41ImportedAt = "";
/** false when the n41_orders table isn't there yet. */
let mgN41TableReady = true;
/** The file read, waiting for "Update N41 Status". */
let mgN41Pending = null;
/** Every Pending / Processing order, in brief; null until read. */
let mgOpenOrders = null;
let mgOpenOrdersError = "";
/** Ticked orders, across pages: id → { id, number, status }. */
let mgOrderSelected = new Map();

const MG_N41_CLOSED = "closed";
const MG_CANCELABLE_STATUSES = ["pending", "processing"];
/** Orders sent to the helper at a time, so a long list can't outrun it. */
const MG_CANCEL_BATCH = 20;

/** "Web:00000061" and "000000061" are both 61 — the two pad differently. */
function mgOrderKey(value) {
  return String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

function mgN41For(number) {
  return mgN41.get(mgOrderKey(number)) ?? null;
}

function isMgN41Closed(entry) {
  return String(entry?.status ?? "").trim().toLowerCase() === MG_N41_CLOSED;
}

function isMgOrderCancelable(row) {
  return MG_CANCELABLE_STATUSES.includes(row.status);
}

/** Closed on N41, still open on Magento. */
function isMgOrderFlagged(row) {
  return isMgOrderCancelable(row) && isMgN41Closed(mgN41For(row.number));
}

// ── Loading ──────────────────────────────────────────────────────────────────

async function loadMgN41() {
  try {
    const loaded = await loadN41OrderRows();
    mgN41TableReady = loaded !== null;
    mgN41 = loaded?.orders ?? new Map();
    mgN41ImportedAt = loaded?.importedAt ?? "";
  } catch (err) {
    showIndicator(err.message || "Couldn't load the N41 report.", "error");
  }
}

/** Nothing to compare until a report is imported. */
async function loadMgOpenOrders() {
  if (!mgN41.size) return;
  try {
    mgOpenOrders = await callMagento("openOrders");
    mgOpenOrdersError = "";
  } catch (err) {
    mgOpenOrdersError = err.message || "Couldn't read the open orders.";
  }
}

async function refreshMgN41() {
  await loadMgN41();
  await loadMgOpenOrders();
  syncMgN41FlaggedButton();
}

/** The open orders the Closed on N41 button stands for, with the table's filters and sort. */
function mgFlaggedOrders() {
  const q = MG_SALES.orders.query;
  const search = q.search.trim().toLowerCase();
  const list = (mgOpenOrders ?? []).filter(o => {
    if (!isMgOrderFlagged(o)) return false;
    if (q.status && !q.status.includes(o.status)) return false;
    if (q.from && o.createdAt < `${q.from} 00:00:00`) return false;
    return !search || [o.number, o.customerName, o.email].some(v => v.toLowerCase().includes(search));
  });
  const field = { number: "number", date: "createdAt", customer: "customerName", email: "email", status: "status", qty: "qty", total: "total" }[q.sort] ?? "createdAt";
  const dir = q.sort && q.dir === "ASC" ? 1 : -1;
  return list.sort((a, b) => dir * (typeof a[field] === "number" ? a[field] - b[field] : a[field].localeCompare(b[field])));
}

/** One page of the flagged list, in full: the same shape as the orders action. */
async function loadMgFlaggedPage(page, pageSize) {
  if (!mgOpenOrders) throw new Error(mgOpenOrdersError || "Still reading the open orders from Magento — try again in a moment.");
  const list = mgFlaggedOrders();
  const numbers = list.slice((page - 1) * pageSize, page * pageSize).map(o => o.number);
  if (!numbers.length) return { items: [], total: list.length };
  const res = await callMagento("orders", { numbers, page: 1, pageSize: numbers.length });
  const rank = new Map(numbers.map((n, i) => [n, i]));
  return { ...res, items: [...(res?.items ?? [])].sort((a, b) => rank.get(a.number) - rank.get(b.number)), total: list.length };
}

// ── Table ────────────────────────────────────────────────────────────────────

/** Closed on N41 while open on Magento stands out; no report row is a dash. */
function createMgN41StatusCell(row) {
  const n41 = mgN41For(row.number);
  if (!n41) {
    const none = document.createElement("span");
    none.textContent = EMPTY_DISPLAY;
    none.title = "Not on an imported N41 report";
    return none;
  }
  const pill = document.createElement("span");
  pill.className = "mg-n41-status";
  pill.dataset.status = n41.status.trim().toLowerCase();
  pill.textContent = n41.status || EMPTY_DISPLAY;
  const flagged = isMgOrderFlagged(row);
  pill.classList.toggle("is-flagged", flagged);
  pill.title = [
    flagged ? `Closed on N41 but ${mgOrderStatusLabel(row.status)} on Magento` : "",
    n41.poNo,
    n41.customer,
  ].filter(Boolean).join(" · ");
  return pill;
}

/** Only an open order can be canceled, so only an open order has a tick box. */
function createMgOrderCheckbox(row) {
  if (!isMgOrderCancelable(row)) return null;
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "row-select";
  cb.checked = mgOrderSelected.has(String(row.id));
  cb.setAttribute("aria-label", `Select order ${row.number}`);
  cb.addEventListener("change", () => {
    setMgOrderSelected(row, cb.checked);
    syncMgOrderSelectionUi();
  });
  return cb;
}

function setMgOrderSelected(row, on) {
  if (on) mgOrderSelected.set(String(row.id), { id: row.id, number: row.number, status: row.status });
  else mgOrderSelected.delete(String(row.id));
}

function syncMgOrderSelectionUi() {
  const open = MG_SALES.orders.page.items.filter(isMgOrderCancelable);
  const all = document.getElementById("mgOrderSelectAll");
  if (all) {
    const onPage = open.filter(o => mgOrderSelected.has(String(o.id))).length;
    all.disabled = !open.length;
    all.checked = onPage > 0 && onPage === open.length;
    all.indeterminate = onPage > 0 && onPage < open.length;
  }
  const bar = document.getElementById("mgOrderSelectionBar");
  if (bar) bar.hidden = mgOrderSelected.size === 0;
  const count = document.getElementById("mgOrderSelectionCount");
  if (count) count.textContent = `${mgOrderSelected.size.toLocaleString()} selected`;
}

function clearMgOrderSelection() {
  mgOrderSelected = new Map();
  renderMgSales("orders");
}

/** The button: how many are flagged, shown once there's a report. */
function syncMgN41FlaggedButton() {
  const btn = document.getElementById("mgN41FlaggedBtn");
  if (!btn) return;
  const on = Boolean(MG_SALES.orders.query.flagged);
  const show = mgN41.size > 0;
  btn.hidden = !show;
  const divider = document.getElementById("mgN41FlaggedDivider");
  if (divider) divider.hidden = !show;
  btn.classList.toggle("active", on);
  const n = mgOpenOrders?.filter(isMgOrderFlagged).length;
  btn.textContent = n === undefined ? "Closed on N41" : `Closed on N41 (${n.toLocaleString()})`;
  btn.title = `Closed on N41 but Pending or Processing on Magento. N41 report imported ${mgN41ImportedAt ? new Date(mgN41ImportedAt).toLocaleString() : ""}.`;
}

// ── Cancel ───────────────────────────────────────────────────────────────────

function describeMgCancelConfirm(orders) {
  const n = orders.length;
  const numbers = orders.slice(0, 10).map(o => o.number).join(", ") + (n > 10 ? ` and ${n - 10} more` : "");
  const notClosed = orders.filter(o => !isMgN41Closed(mgN41For(o.number))).length;
  return [
    `Cancel ${n === 1 ? "this order" : `these ${n.toLocaleString()} orders`} on Magento?`,
    numbers,
    "Everything not invoiced yet is canceled. This can't be undone.",
    notClosed ? `${notClosed === 1 ? "1 of them isn't" : `${notClosed.toLocaleString()} of them aren't`} Closed on N41.` : "",
  ].filter(Boolean).join("\n\n");
}

/** "Canceled 3 orders: 2 Canceled, 1 Complete." */
function describeMgCancelResults(results) {
  const done = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  const counts = new Map();
  done.forEach(r => counts.set(r.status, (counts.get(r.status) ?? 0) + 1));
  const statuses = [...counts].map(([status, n]) => `${n.toLocaleString()} ${mgOrderStatusLabel(status)}`).join(", ");
  const parts = [];
  if (done.length) parts.push(`Canceled ${done.length.toLocaleString()} ${done.length === 1 ? "order" : "orders"}: ${statuses}.`);
  if (counts.has("processing")) parts.push("Processing means invoiced items are still to ship.");
  if (failed.length) parts.push(`${failed.length.toLocaleString()} not canceled — #${failed[0].number || failed[0].id}: ${failed[0].error}`);
  return parts.join(" ");
}

async function cancelMgSelectedOrders() {
  const orders = [...mgOrderSelected.values()];
  if (!orders.length || !confirm(describeMgCancelConfirm(orders))) return;
  const results = [];
  let stopped = "";
  setAppLoading(true, "Canceling on Magento…");
  try {
    for (let i = 0; i < orders.length; i += MG_CANCEL_BATCH) {
      const res = await callMagento("cancelOrders", { ids: orders.slice(i, i + MG_CANCEL_BATCH).map(o => o.id) });
      results.push(...(res?.results ?? []));
      setAppLoading(true, `Canceling on Magento… ${results.length.toLocaleString()} of ${orders.length.toLocaleString()}`);
    }
  } catch (err) {
    stopped = err.message || "Couldn't cancel on Magento.";
  } finally {
    setAppLoading(false);
  }
  // What didn't cancel stays ticked, to look at or try again.
  results.filter(r => r.ok).forEach(r => mgOrderSelected.delete(String(r.id)));
  const message = stopped || describeMgCancelResults(results);
  showIndicator(message, stopped || results.some(r => !r.ok) ? "error" : "success");
  await loadMgOpenOrders();
  syncMgN41FlaggedButton();
  loadMgSales("orders");
  loadMgSalesFacets("orders");
}

// ── The import ───────────────────────────────────────────────────────────────

/** The report's rows, cell by column letter. */
async function readMgN41Rows(file) {
  await loadSheetJs();
  const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error("That file has no sheets.");
  return XLSX.utils.sheet_to_json(sheet, { header: "A", defval: "", raw: false, blankrows: true });
}

/** The web orders on the report, plus what the file says about them. */
function extractN41Orders(rows) {
  const cell = (r, col) => String(r[col] ?? "").trim();
  const header = rows.slice(0, 40).findIndex(r => /^status$/i.test(cell(r, "I")) && /cust\.?\s*po/i.test(cell(r, "P")));
  if (header < 0) {
    throw new Error("That isn't an N41 Sales Orders report — it needs Status in column I and Cust. PO # in column P.");
  }
  const orders = new Map();
  let otherRows = 0;
  let repeatedRows = 0;
  rows.slice(header + 1).forEach(r => {
    const poNo = cell(r, "P");
    const status = cell(r, "I");
    const soNo = cell(r, "H").replace(/\.0+$/, "");
    if (!poNo || !status) return; // blank rows and totals
    const key = /^web\s*:/i.test(poNo) ? mgOrderKey(poNo) : "";
    if (!key) {
      otherRows += 1;
      return;
    }
    const seen = orders.get(key);
    if (!seen) {
      orders.set(key, { poNo, soNo, customer: cell(r, "C"), status });
      return;
    }
    repeatedRows += 1;
    seen.soNo = [...new Set([...seen.soNo.split(", "), soNo])].filter(Boolean).join(", ");
    // Closed only if every row is.
    if (isMgN41Closed(seen) && !isMgN41Closed({ status })) seen.status = status;
  });
  if (!orders.size) throw new Error('No web orders found — Cust. PO # should read "Web:00000061".');
  return { orders, otherRows, repeatedRows };
}

function openMgN41Import() {
  const input = document.getElementById("mgImportN41File");
  if (!input) return;
  input.value = "";
  input.click();
}

async function readMgN41File(file) {
  if (!file) return;
  setAppLoading(true, "Reading the report…");
  try {
    mgN41Pending = { ...extractN41Orders(await readMgN41Rows(file)), fileName: file.name };
    renderMgN41Import();
    document.getElementById("mgN41ImportOverlay")?.classList.add("open");
  } catch (err) {
    showIndicator(err.message || "Couldn't read that file.", "error");
  } finally {
    setAppLoading(false);
  }
}

function closeMgN41Import() {
  mgN41Pending = null;
  document.getElementById("mgN41ImportOverlay")?.classList.remove("open");
}

/** What the file holds, and how it differs from the statuses the app has now. */
function renderMgN41Import() {
  const p = mgN41Pending;
  if (!p) return;
  const list = [...p.orders.values()];
  const closed = list.filter(isMgN41Closed).length;
  document.getElementById("mgN41ImportIntro").textContent =
    `${p.fileName} — ${p.orders.size.toLocaleString()} web orders. Only each order's N41 Status is saved; nothing changes in N41 or on Magento.`;

  const after = new Map([...mgN41, ...p.orders]);
  const flagged = mgOpenOrders?.filter(o => isMgN41Closed(after.get(mgOrderKey(o.number)))).length;
  const fields = [
    ["Closed", closed.toLocaleString()],
    ["Not closed", (list.length - closed).toLocaleString()],
    ["Rows for orders already listed", p.repeatedRows.toLocaleString()],
    ["Other POs, skipped", p.otherRows.toLocaleString()],
  ];
  if (flagged !== undefined) fields.push(["Closed on N41, open on Magento", flagged.toLocaleString()]);
  document.getElementById("mgN41ImportSummary").replaceChildren(...fields.flatMap(([label, value]) => {
    const l = document.createElement("span");
    l.className = "item-pane-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "item-pane-value";
    v.textContent = value;
    return [l, v];
  }));

  // Against what's saved.
  const changes = document.getElementById("mgN41ImportChanges");
  if (!mgN41.size) changes.textContent = "First import — every order above will be saved.";
  else {
    const added = [...p.orders.keys()].filter(k => !mgN41.has(k)).length;
    const changed = [...p.orders].filter(([k, o]) => mgN41.has(k) && mgN41.get(k).status !== o.status).length;
    changes.textContent = `${added.toLocaleString()} new, ${changed.toLocaleString()} with a new status. Orders not on this report keep the status they have.`;
  }
  document.getElementById("mgN41ImportMessage").textContent = "";
  document.getElementById("mgN41ImportSaveBtn").disabled = false;
}

async function saveMgN41Import() {
  const p = mgN41Pending;
  if (!p) return;
  const save = document.getElementById("mgN41ImportSaveBtn");
  const message = document.getElementById("mgN41ImportMessage");
  save.disabled = true;
  message.textContent = "Saving…";
  message.className = "modal-footer-message";
  try {
    await saveN41OrderRows(p.orders);
    mgN41TableReady = true;
    closeMgN41Import();
    await refreshMgN41();
    renderMgSales("orders");
    if (MG_SALES.orders.query.flagged) loadMgSales("orders");
    showIndicator(`N41 Status updated — ${p.orders.size.toLocaleString()} orders`, "success");
  } catch (err) {
    message.className = "modal-footer-message error";
    message.textContent = mgN41TableReady && !/n41_orders/.test(err.message ?? "")
      ? err.message || "Couldn't save the report."
      : "Update the n41_orders table in Supabase first (SQL Editor — it's in supabase-schema.sql), then try again.";
    save.disabled = false;
  }
}

function initMagentoN41() {
  document.getElementById("headerMenuImportN41")?.addEventListener("click", () => {
    closeHeaderMenu();
    openMgN41Import();
  });
  document.getElementById("mgImportN41File")?.addEventListener("change", e => readMgN41File(e.target.files?.[0]));
  document.getElementById("mgN41ImportSaveBtn")?.addEventListener("click", saveMgN41Import);
  document.getElementById("mgN41ImportCancelBtn")?.addEventListener("click", closeMgN41Import);
  document.getElementById("mgN41ImportCloseBtn")?.addEventListener("click", closeMgN41Import);
  document.getElementById("mgN41ImportOverlay")?.addEventListener("click", e => {
    if (e.target.id === "mgN41ImportOverlay") closeMgN41Import();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && mgN41Pending) closeMgN41Import();
  });

  document.getElementById("mgN41FlaggedBtn")?.addEventListener("click", () => {
    setMgSalesQuery("orders", { flagged: !MG_SALES.orders.query.flagged });
  });
  document.getElementById("mgCancelOrdersBtn")?.addEventListener("click", cancelMgSelectedOrders);
  document.getElementById("mgClearOrderSelectionBtn")?.addEventListener("click", clearMgOrderSelection);
  document.getElementById("mgOrderSelectAll")?.addEventListener("change", e => {
    MG_SALES.orders.page.items.filter(isMgOrderCancelable).forEach(o => setMgOrderSelected(o, e.target.checked));
    renderMgSales("orders");
  });
}
