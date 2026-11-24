/**
 * Magento → Orders against N41's Sales Orders report.
 *
 * Orders go from Magento to N41, and invoicing on N41 updates Magento — but
 * canceling on N41 doesn't, so those orders sit Pending or Processing on
 * Magento forever. Import N41 Sales Orders reads N41's Sales Orders export
 * (.csv, a row per order line — js/n41-orders.js parseN41SoRows) and saves
 * every line for the N41 Orders page, and each web order's status here
 * (n41_orders): customerPo "Web:00000061" is Magento order 61, with its SO #
 * (orderno), customer and status. Any other PO isn't from the web store.
 *
 * An order fills several rows; it's Closed only if every row is. Exports
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
let mgCancelAllBusy = false;

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

/** A customer's name on N41: the report's name on the first of these orders it has. */
function mgN41CustomerName(numbers) {
  return (numbers ?? []).map(n => mgN41For(n)?.customer).find(Boolean) ?? "";
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
  const cancelAll = document.getElementById("mgCancelAllN41ClosedBtn");
  if (cancelAll) {
    cancelAll.hidden = !show;
    cancelAll.disabled = mgCancelAllBusy || !n;
    cancelAll.textContent = n === undefined ? "Cancel all Closed on N41" : `Cancel all Closed on N41 (${n.toLocaleString()})`;
    cancelAll.title = "Across all pages, regardless of search or date/status filters. Cancels all uninvoiced quantities. Closed can also mean transferred to a consolidated SO.";
  }
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
    "Closed on N41 can also mean transferred to a consolidated SO, rather than canceled. Those orders are included too.",
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
  return cancelMgOrders([...mgOrderSelected.values()]);
}

/** All flagged orders across pages, refreshed before asking for confirmation. */
async function cancelMgAllN41ClosedOrders() {
  if (mgCancelAllBusy) return;
  mgCancelAllBusy = true;
  syncMgN41FlaggedButton();
  try {
    const loaded = await loadN41OrderRows();
    if (!loaded) throw new Error("Couldn't load the imported N41 report.");
    mgN41 = loaded.orders;
    mgN41ImportedAt = loaded.importedAt;
    await loadMgOpenOrders();
    if (mgOpenOrdersError || !mgOpenOrders) throw new Error(mgOpenOrdersError || "Couldn't read the open Magento orders.");
    const orders = mgOpenOrders.filter(isMgOrderFlagged);
    if (!orders.length) {
      showIndicator("No open Magento orders are Closed on N41.", "success");
      return;
    }
    await cancelMgOrders(orders);
  } catch (err) {
    showIndicator(err.message || "Couldn't cancel the orders.", "error");
  } finally {
    mgCancelAllBusy = false;
    syncMgN41FlaggedButton();
  }
}

async function cancelMgOrders(orders) {
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
//
// N41's Sales Orders export (.csv, one row per order line — js/n41-orders.js
// reads it): every line is saved for the N41 Orders page, and each web
// order's status for the Orders table here.

function openMgN41Import() {
  const input = document.getElementById("mgImportN41File");
  if (!input) return;
  input.value = "";
  input.click();
}

async function readMgN41File(file) {
  if (!file) return;
  setAppLoading(true, "Reading the export…");
  try {
    const parsed = parseN41SoRows(await readN41SoFile(file));
    mgN41Pending = { ...parsed, orders: parsed.webOrders, fileName: file.name };
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

/** What the file holds, and how its web orders differ from the statuses the app has now. */
function renderMgN41Import() {
  const p = mgN41Pending;
  if (!p) return;
  const orderNos = new Set(p.lines.map(l => l.order_no));
  const customers = new Set(p.lines.map(l => l.customer));
  const dates = p.lines.map(l => l.order_date).filter(Boolean).sort();
  const range = dates.length ? `${formatMdy(dates[0])} – ${formatMdy(dates[dates.length - 1])}` : "";
  document.getElementById("mgN41ImportIntro").textContent =
    `${p.fileName} — ${orderNos.size.toLocaleString()} SOs${range ? `, ordered ${range}` : ""}. Saved to N41 Orders, and web orders' status for Magento → Orders; nothing changes in N41 or on Magento.`;

  const web = [...p.orders.values()];
  const closed = web.filter(isMgN41Closed).length;
  const after = new Map([...mgN41, ...p.orders]);
  const flagged = mgOpenOrders?.filter(o => isMgN41Closed(after.get(mgOrderKey(o.number)))).length;
  const fields = [
    ["Sales orders", orderNos.size.toLocaleString()],
    ["Order lines", p.lines.length.toLocaleString()],
    ["Customers", customers.size.toLocaleString()],
    ["Web orders (Magento)", `${web.length.toLocaleString()} · ${closed.toLocaleString()} closed`],
  ];
  if (p.repeated) fields.push(["Repeated lines, skipped", p.repeated.toLocaleString()]);
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

  document.getElementById("mgN41ImportChanges").textContent =
    "Lines already imported are updated; orders not in this file stay as they are (an export covers a date range).";
  document.getElementById("mgN41ImportMessage").textContent = "";
  document.getElementById("mgN41ImportSaveBtn").disabled = false;
}

async function saveMgN41Import() {
  const p = mgN41Pending;
  if (!p) return;
  const save = document.getElementById("mgN41ImportSaveBtn");
  const message = document.getElementById("mgN41ImportMessage");
  save.disabled = true;
  message.className = "modal-footer-message";
  message.textContent = "Saving…";
  try {
    await saveN41SoLines(p.lines, (done, total) => { message.textContent = `Saving lines… ${done.toLocaleString()} / ${total.toLocaleString()}`; });
    if (p.orders.size) {
      message.textContent = "Saving web orders…";
      await saveN41OrderRows(p.orders);
    }
    mgN41TableReady = true;
    const soCount = new Set(p.lines.map(l => l.order_no)).size;
    closeMgN41Import();
    showIndicator(`N41 Sales Orders imported — ${soCount.toLocaleString()} SOs, ${p.lines.length.toLocaleString()} lines`, "success");
    refreshN41OrdersAfterImport();
    if (getCurrentAppView() === "magento") {
      await refreshMgN41();
      renderMgSales("orders");
      if (MG_SALES.orders.query.flagged) loadMgSales("orders");
    } else {
      loadMgN41();
    }
  } catch (err) {
    message.className = "modal-footer-message error";
    message.textContent = err.message || "Couldn't save the export.";
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
  document.getElementById("mgCancelAllN41ClosedBtn")?.addEventListener("click", cancelMgAllN41ClosedOrders);
  document.getElementById("mgClearOrderSelectionBtn")?.addEventListener("click", clearMgOrderSelection);
  document.getElementById("mgOrderSelectAll")?.addEventListener("change", e => {
    MG_SALES.orders.page.items.filter(isMgOrderCancelable).forEach(o => setMgOrderSelected(o, e.target.checked));
    renderMgSales("orders");
  });
}
