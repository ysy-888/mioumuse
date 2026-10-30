/**
 * Table view — header menu → Table view: pick which columns a table shows
 * and drag them into order, saved as that table's default to your account
 * (the table_views table), so it follows the login to any computer.
 *
 * The browser keeps a copy (localStorage) so the columns are right from the
 * first paint; once signed in, the account's views replace it
 * (syncTableViewsFromAccount). Views saved on a computer before they went
 * to the account are uploaded the first time, so none are lost.
 *
 * Every table listed in TABLE_VIEW_TABLES draws its rows in the order of its
 * <th data-col> headers, so a view is just the headers (and their <col>
 * widths) rearranged: hidden columns are taken out of the header row
 * altogether, and the table is redrawn. The header elements themselves are
 * moved, never rebuilt, so their sort and filter handlers keep working.
 */

const TABLE_VIEW_TABLES = [
  { id: "campaignsTable", label: "Campaigns", view: "campaigns" },
  { id: "tradeShowsTable", label: "Trade Shows", view: "tradeShows" },
  { id: "bannersTable", label: "Platforms · Banners", view: "platforms" },
  { id: "stylesTable", label: "Styles", view: "styles" },
  { id: "needTable", label: "Photoshoots · Need to Shoot", view: "needToShoot" },
  { id: "shootsTable", label: "Photoshoots · Shoots", view: "photoshoots" },
  { id: "mgProductsTable", label: "Magento · Products", view: "magento" },
  { id: "mgOrdersTable", label: "Magento · Orders", view: "magento" },
  { id: "mgCustomersTable", label: "Magento · Customers", view: "magento" },
  { id: "mgEventsTable", label: "Magento · Events", view: "magento" },
];

/** Always shown, always first — the tick-box column. */
const TABLE_VIEW_FIXED = new Set(["select"]);

/** Per table: { columns: [{ col, label, th, colEl }] in the original order, current: { order, hidden } }. */
const tableViewState = new Map();

/** The edit in progress in the modal. */
let tableViewDraft = null;

/** false when the table_views table isn't set up yet — views then stay in this browser. */
let tableViewsInAccount = false;

function tableViewStorageKey(tableId) {
  return scopedStorageKey(`tableView.${tableId}`);
}

function cacheTableView(tableId, view) {
  try {
    localStorage.setItem(tableViewStorageKey(tableId), JSON.stringify(view));
  } catch {
    /* the account copy is what counts */
  }
}

/**
 * After sign-in (and on Refresh): the account's views win. A table with a
 * view only in this browser — saved before views went to the account — is
 * uploaded, so it isn't lost. Doesn't redraw; the caller shows a view next.
 */
async function syncTableViewsFromAccount() {
  let rows = null;
  try {
    rows = await loadTableViewRows();
  } catch {
    rows = null;
  }
  tableViewsInAccount = rows !== null;
  if (!rows) return;

  const uploads = [];
  tableViewState.forEach((state, tableId) => {
    if (rows[tableId]) {
      state.current = normalizeTableView(state, rows[tableId]);
      cacheTableView(tableId, state.current);
      applyTableView(tableId);
    } else if (readSavedTableView(tableId)) {
      uploads.push(saveTableViewRow(tableId, state.current).catch(() => {}));
    }
  });
  await Promise.all(uploads);
}

function readSavedTableView(tableId) {
  try {
    const saved = JSON.parse(localStorage.getItem(tableViewStorageKey(tableId)) ?? "null");
    if (saved && Array.isArray(saved.order) && Array.isArray(saved.hidden)) return saved;
  } catch {
    /* nothing usable saved */
  }
  return null;
}

/**
 * A saved view against the table as it is now: columns that no longer exist
 * are dropped, and columns added since are put back where they originally
 * sat (after the column that came before them).
 */
function normalizeTableView(state, view) {
  const known = state.columns.map(c => c.col);
  const order = (view?.order ?? []).filter(col => known.includes(col) && !TABLE_VIEW_FIXED.has(col));
  known.forEach((col, i) => {
    if (TABLE_VIEW_FIXED.has(col) || order.includes(col)) return;
    const before = known.slice(0, i).reverse().find(c => order.includes(c));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, col);
  });
  const hidden = (view?.hidden ?? []).filter(col => order.includes(col));
  return { order, hidden };
}

/** Put the headers and column widths in the view's order, hidden ones left out. */
function applyTableView(tableId) {
  const state = tableViewState.get(tableId);
  const table = document.getElementById(tableId);
  if (!state || !table) return;
  const headRow = table.querySelector("thead tr");
  const colgroup = table.querySelector("colgroup");
  const byCol = new Map(state.columns.map(c => [c.col, c]));
  const shown = [
    ...state.columns.filter(c => TABLE_VIEW_FIXED.has(c.col)),
    ...state.current.order.filter(col => !state.current.hidden.includes(col)).map(col => byCol.get(col)),
  ];
  headRow.replaceChildren(...shown.map(c => c.th));
  if (colgroup && state.hasCols) colgroup.replaceChildren(...shown.map(c => c.colEl));
}

/** Redraw whatever is on screen, now that its columns have moved. */
function redrawAfterTableView() {
  switchAppView(getCurrentAppView());
  if (getCurrentAppView() === "magento") {
    renderMgProducts();
    renderMgSales("orders");
    renderMgEvents();
    renderMgSales("customers");
  }
}

// ── The modal ────────────────────────────────────────────────────────────────

/** The table on the page you're looking at. */
function currentTableViewTarget() {
  const view = getCurrentAppView();
  if (view === "magento") return { orders: "mgOrdersTable", customers: "mgCustomersTable", events: "mgEventsTable" }[mgSubview] ?? "mgProductsTable";
  return TABLE_VIEW_TABLES.find(t => t.view === view)?.id ?? TABLE_VIEW_TABLES[0].id;
}

function openTableView(tableId = currentTableViewTarget()) {
  const state = tableViewState.get(tableId);
  if (!state) return;
  tableViewDraft = { tableId, order: [...state.current.order], hidden: new Set(state.current.hidden) };
  const target = document.getElementById("tableViewTarget");
  if (target) target.value = tableId;
  setTableViewMessage("");
  renderTableViewModal();
  document.getElementById("tableViewOverlay")?.classList.add("open");
}

function closeTableView() {
  tableViewDraft = null;
  document.getElementById("tableViewOverlay")?.classList.remove("open");
}

function setTableViewMessage(text, tone = "") {
  const el = document.getElementById("tableViewMessage");
  if (!el) return;
  el.textContent = text;
  el.className = `modal-footer-message${tone ? ` ${tone}` : ""}`;
}

function tableViewLabel(tableId, col) {
  return tableViewState.get(tableId)?.columns.find(c => c.col === col)?.label ?? col;
}

function renderTableViewModal() {
  if (!tableViewDraft) return;
  const { tableId, order, hidden } = tableViewDraft;
  const state = tableViewState.get(tableId);

  // Show columns: every column, in the original order. The tick-box column
  // is listed, but can't be hidden.
  const picker = document.getElementById("tableViewPicker");
  picker?.replaceChildren(...state.columns.map(({ col, label }) => {
    const row = document.createElement("label");
    row.className = "edit-table-picker-option";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    const fixed = TABLE_VIEW_FIXED.has(col);
    cb.checked = fixed || !hidden.has(col);
    cb.disabled = fixed;
    cb.addEventListener("change", () => {
      if (cb.checked) hidden.delete(col);
      else if (order.filter(c => !hidden.has(c)).length <= 1) {
        // A table needs something in it.
        cb.checked = true;
        setTableViewMessage("Keep at least one column.", "error");
        return;
      } else hidden.add(col);
      setTableViewMessage("");
      renderTableViewModal();
    });
    const text = document.createElement("span");
    text.textContent = label;
    row.append(cb, text);
    return row;
  }));

  // Column order: the shown columns, draggable; the fixed one pinned on top.
  const list = document.getElementById("tableViewOrder");
  if (!list) return;
  const items = state.columns.filter(c => TABLE_VIEW_FIXED.has(c.col)).map(c => {
    const item = document.createElement("div");
    item.className = "edit-table-order-item edit-table-order-item-fixed";
    item.title = "Always first";
    const spacer = document.createElement("span");
    spacer.className = "edit-table-order-spacer";
    const label = document.createElement("span");
    label.className = "edit-table-order-item-label";
    label.textContent = c.label;
    item.append(spacer, label);
    return item;
  });
  order.filter(col => !hidden.has(col)).forEach(col => {
    const item = document.createElement("div");
    item.className = "edit-table-order-item";
    item.draggable = true;
    item.dataset.col = col;
    const handle = document.createElement("span");
    handle.className = "edit-table-drag-handle";
    handle.textContent = "⋮⋮";
    handle.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "edit-table-order-item-label";
    label.textContent = tableViewLabel(tableId, col);
    // Keyboard and no-drag fallback: Alt+↑ / Alt+↓ moves it.
    item.tabIndex = 0;
    item.setAttribute("aria-label", `${label.textContent} — Alt+Up or Alt+Down to move`);
    item.addEventListener("keydown", e => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const shown = order.filter(c => !hidden.has(c));
      const i = shown.indexOf(col);
      const swapWith = shown[e.key === "ArrowUp" ? i - 1 : i + 1];
      if (!swapWith) return;
      moveTableViewColumn(col, swapWith, e.key === "ArrowUp" ? "before" : "after");
      document.querySelector(`#tableViewOrder [data-col="${CSS.escape(col)}"]`)?.focus();
    });
    item.append(handle, label);
    items.push(item);
  });
  list.replaceChildren(...items);
}

/** Move `col` to just before / after `target` in the full order (hidden ones included). */
function moveTableViewColumn(col, target, where) {
  const { order } = tableViewDraft;
  if (col === target) return;
  order.splice(order.indexOf(col), 1);
  const at = order.indexOf(target) + (where === "after" ? 1 : 0);
  order.splice(at, 0, col);
  renderTableViewModal();
}

function initTableViewDrag() {
  const list = document.getElementById("tableViewOrder");
  if (!list) return;
  let dragged = null;
  const clearMarks = () => list.querySelectorAll(".drag-insert-before, .drag-insert-after")
    .forEach(el => el.classList.remove("drag-insert-before", "drag-insert-after"));
  const dropTarget = e => {
    const item = e.target.closest(".edit-table-order-item[data-col]");
    if (!item || item.dataset.col === dragged) return null;
    const rect = item.getBoundingClientRect();
    return { item, where: e.clientY < rect.top + rect.height / 2 ? "before" : "after" };
  };

  list.addEventListener("dragstart", e => {
    const item = e.target.closest(".edit-table-order-item[data-col]");
    if (!item) return;
    dragged = item.dataset.col;
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragged);
  });
  list.addEventListener("dragover", e => {
    if (!dragged) return;
    e.preventDefault();
    clearMarks();
    const t = dropTarget(e);
    if (t) t.item.classList.add(t.where === "before" ? "drag-insert-before" : "drag-insert-after");
  });
  list.addEventListener("dragleave", e => {
    if (!list.contains(e.relatedTarget)) clearMarks();
  });
  list.addEventListener("drop", e => {
    e.preventDefault();
    const t = dropTarget(e);
    clearMarks();
    if (dragged && t) moveTableViewColumn(dragged, t.item.dataset.col, t.where);
    dragged = null;
  });
  list.addEventListener("dragend", () => {
    clearMarks();
    list.querySelector(".dragging")?.classList.remove("dragging");
    dragged = null;
  });
}

async function saveTableView() {
  if (!tableViewDraft) return;
  const { tableId, order, hidden } = tableViewDraft;
  const state = tableViewState.get(tableId);
  const view = { order: [...order], hidden: order.filter(col => hidden.has(col)) };

  // The account first, so a failed save leaves the modal open to try again.
  const saveBtn = document.getElementById("tableViewSaveBtn");
  if (tableViewsInAccount) {
    if (saveBtn) saveBtn.disabled = true;
    setTableViewMessage("Saving…");
    try {
      await saveTableViewRow(tableId, view);
    } catch (err) {
      setTableViewMessage(err.message || "Couldn't save to your account.", "error");
      return;
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  state.current = view;
  cacheTableView(tableId, view);
  applyTableView(tableId);
  closeTableView();
  // A hidden column's header filter would go on filtering out of sight.
  state.current.hidden.forEach(col => {
    if (isColumnFilterActive(tableId, col)) clearColumnFilter(tableId, col);
  });
  redrawAfterTableView();
  const name = TABLE_VIEW_TABLES.find(t => t.id === tableId)?.label ?? "Table";
  if (tableViewsInAccount) showIndicator(`${name} view saved`, "success");
  // Not set up yet: still applied and remembered here, but say why it won't follow the login.
  else showIndicator(`${name} view saved on this computer only — add the table_views table in Supabase to keep it with your login.`, "error");
}

/** Back to every column in the original order — in the modal; Save keeps it. */
function resetTableViewDraft() {
  if (!tableViewDraft) return;
  const state = tableViewState.get(tableViewDraft.tableId);
  tableViewDraft.order = normalizeTableView(state, null).order;
  tableViewDraft.hidden = new Set();
  setTableViewMessage("Original view — Save to keep it.");
  renderTableViewModal();
}

// ── Init ─────────────────────────────────────────────────────────────────────

/** Call after every table's own init, so their headers are fully set up. */
function initTableViews() {
  TABLE_VIEW_TABLES.forEach(({ id }) => {
    const table = document.getElementById(id);
    if (!table) return;
    const ths = [...table.querySelectorAll("thead th[data-col]")];
    const cols = [...table.querySelectorAll("colgroup col")];
    const columns = ths.map((th, i) => ({
      col: th.dataset.col,
      // The header's words; the tick-box column has none.
      label: th.dataset.col === "select" ? "Select (tick box)" : (th.querySelector(".th-label") ?? th).textContent.trim() || th.dataset.col,
      th,
      colEl: cols[i] ?? null,
    }));
    const state = { columns, hasCols: cols.length === ths.length, current: null };
    state.current = normalizeTableView(state, readSavedTableView(id));
    tableViewState.set(id, state);
    applyTableView(id);
  });

  const target = document.getElementById("tableViewTarget");
  target?.replaceChildren(...TABLE_VIEW_TABLES.filter(t => tableViewState.has(t.id)).map(t => new Option(t.label, t.id)));
  target?.addEventListener("change", () => openTableView(target.value));

  document.getElementById("headerMenuTableView")?.addEventListener("click", () => {
    closeHeaderMenu();
    openTableView();
  });
  document.getElementById("tableViewShowAll")?.addEventListener("click", () => {
    if (!tableViewDraft) return;
    tableViewDraft.hidden = new Set();
    setTableViewMessage("");
    renderTableViewModal();
  });
  document.getElementById("tableViewResetBtn")?.addEventListener("click", resetTableViewDraft);
  document.getElementById("tableViewSaveBtn")?.addEventListener("click", saveTableView);
  document.getElementById("tableViewCancelBtn")?.addEventListener("click", closeTableView);
  document.getElementById("tableViewCloseBtn")?.addEventListener("click", closeTableView);
  document.getElementById("tableViewOverlay")?.addEventListener("click", e => {
    if (e.target.id === "tableViewOverlay") closeTableView();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && tableViewDraft) closeTableView();
  });
  initTableViewDrag();
}
