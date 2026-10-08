/**
 * Side pane for one campaign or trade show — slides in over the right side of
 * whatever view is open, the same way the PO App's packing list pane sits
 * beside its table. The list stays where it was underneath, with the open
 * row highlighted, so you can click from one record to the next.
 *
 *   header   name, type and dates, layout switch, status, ⋯ menu, close
 *   summary  the record's fields at a glance (compact layout only)
 *   tasks    checkable, in due-date order, overdue dates in red
 *   notes    saves as you type
 */

/** { type, id } of the item in the pane, or null when it's closed. */
let paneItemRef = null;

function getPaneItem() {
  return paneItemRef ? getScheduleItem(paneItemRef.type, paneItemRef.id) : null;
}

function isItemPaneOpen() {
  return paneItemRef !== null;
}

// ── Layout ───────────────────────────────────────────────────────────────────
//
// Two looks for the same pane, switched from its header:
//   compact  the PO App packing list pane — slim header, grey summary grid
//   cards    the full-page detail design — a header card, then Tasks and
//            Notes as cards of their own on the grey page background
// The choice is a per-browser preference, so it's remembered locally.

const PANE_LAYOUTS = ["compact", "cards"];
const PANE_LAYOUT_STORAGE_BASE = "paneLayout";

let paneLayout = loadPaneLayout();

function loadPaneLayout() {
  try {
    const saved = localStorage.getItem(scopedStorageKey(PANE_LAYOUT_STORAGE_BASE));
    return PANE_LAYOUTS.includes(saved) ? saved : "compact";
  } catch {
    return "compact";
  }
}

function applyPaneLayout() {
  const pane = document.getElementById("itemPane");
  if (pane) pane.dataset.layout = paneLayout;
  document.querySelectorAll("#itemPaneLayoutToggle .item-pane-layout-btn").forEach(btn => {
    const active = btn.dataset.layout === paneLayout;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function setPaneLayout(layout) {
  if (!PANE_LAYOUTS.includes(layout) || layout === paneLayout) return;
  paneLayout = layout;
  try {
    localStorage.setItem(scopedStorageKey(PANE_LAYOUT_STORAGE_BASE), layout);
  } catch {
    /* preference is best-effort */
  }
  applyPaneLayout();
  // The header line differs between the two, so redraw what's open.
  const item = getPaneItem();
  if (item) renderPaneHeader(item);
}

const ITEM_TYPE_META = {
  [ITEM_TYPE_TRADE_SHOW]: { noun: "trade show", tasksTitle: "Email tasks", editLabel: "Edit show & dates" },
  [ITEM_TYPE_CAMPAIGN]: { noun: "campaign", tasksTitle: "Tasks", editLabel: "Edit campaign & tasks" },
};

// ── Header ───────────────────────────────────────────────────────────────────

function renderPaneHeader(item) {
  const title = document.getElementById("itemPaneTitle");
  if (title) {
    const dot = document.createElement("span");
    dot.className = "item-dot";
    applyItemColor(dot, item);
    dot.setAttribute("aria-hidden", "true");
    title.replaceChildren(dot, document.createTextNode(item.title));
  }

  const subtitle = document.getElementById("itemPaneSubtitle");
  if (subtitle) {
    const kind = item.type === ITEM_TYPE_CAMPAIGN
      ? getCampaignTypeLabel(item.record.type)
      : "Trade show";
    if (paneLayout === "cards") {
      // The full-page header line: what it is, when, and how long — the
      // card view has no summary grid to carry the length instead.
      const parts = [kind, formatDateRange(item.startDate, item.endDate), describeItemLength(item)];
      subtitle.replaceChildren();
      parts.forEach((part, i) => {
        if (i > 0) {
          const sep = document.createElement("span");
          sep.className = "sep";
          sep.textContent = "•";
          subtitle.appendChild(sep);
        }
        subtitle.appendChild(document.createTextNode(part));
      });
    } else {
      subtitle.textContent = `${kind} · ${formatDateRange(item.startDate, item.endDate)}`;
    }
  }

  const status = document.getElementById("itemPaneStatus");
  if (status) {
    const timing = getItemTiming(item);
    status.dataset.timing = timing;
    status.textContent = ITEM_TIMING_LABELS[timing];
  }

  const meta = ITEM_TYPE_META[item.type];
  const edit = document.querySelector("#itemMenuEdit span");
  if (edit) edit.textContent = meta.editLabel;
  const del = document.querySelector("#itemMenuDelete span");
  if (del) del.textContent = `Delete ${meta.noun}`;
}

// ── Summary ──────────────────────────────────────────────────────────────────

function renderPaneSummary(item) {
  const wrap = document.getElementById("itemPaneSummary");
  if (!wrap) return;

  const { done, total } = getItemTaskProgress(item);
  const next = getNextOpenTask(item);

  const fields = [
    item.type === ITEM_TYPE_CAMPAIGN
      ? ["Type", getCampaignTypeLabel(item.record.type)]
      : ["Show", getTradeShowLabel(item.record.show)],
    item.type === ITEM_TYPE_CAMPAIGN && item.record.name ? ["Name", item.record.name] : null,
    ["Start", formatTaskDate(item.startDate)],
    ["End", formatTaskDate(item.endDate)],
    ["Length", describeItemLength(item)],
    ["Done", total ? `${done} of ${total} tasks` : "No tasks yet"],
    ["Next due", next ? `${formatTaskDate(next.dueDate)} · ${next.label}` : EMPTY_DISPLAY],
  ].filter(Boolean);

  wrap.replaceChildren(...fields.flatMap(([label, value]) => {
    const l = document.createElement("span");
    l.className = "item-pane-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "item-pane-value";
    v.textContent = value;
    if (label === "Next due" && next && isTaskOverdue(next)) v.classList.add("is-overdue");
    return [l, v];
  }));
}

// ── Tasks ────────────────────────────────────────────────────────────────────

/** "in 12 days", "today", "3 days ago". */
function describeDaysUntil(dueYmd) {
  const n = daysBetween(todayYmd(), dueYmd);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

function renderPaneTasks(item) {
  const body = document.getElementById("itemPaneTasks");
  if (!body) return;

  const title = document.getElementById("itemPaneTasksTitle");
  if (title) title.textContent = ITEM_TYPE_META[item.type].tasksTitle;

  const { done, total } = getItemTaskProgress(item);
  const count = document.getElementById("itemPaneTasksCount");
  if (count) count.textContent = total ? `${done} of ${total} done` : "";

  if (total === 0) {
    const empty = document.createElement("div");
    empty.className = "item-tasks-empty";
    const text = document.createElement("span");
    text.textContent = "No tasks yet.";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn";
    add.textContent = "Add tasks";
    add.addEventListener("click", () => openCampaignForm(item.id));
    empty.append(text, add);
    body.replaceChildren(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "item-task-list";
  item.tasks.forEach(task => {
    const row = createTaskCheckbox(task);
    const relative = document.createElement("span");
    relative.className = "item-task-relative";
    relative.textContent = describeDaysUntil(task.dueDate);
    row.appendChild(relative);
    list.appendChild(row);
  });
  body.replaceChildren(list);
}

// ── Notes ────────────────────────────────────────────────────────────────────
//
// Saves itself as you type — a note is something you jot mid-thought, not
// something to open the Edit dialog for.

const ITEM_NOTES_AUTOSAVE_MS = 700;

let notesSaveTimer = null;
let notesSavedTimer = null;

function setNotesStatus(text, state = "") {
  const el = document.getElementById("itemNotesStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "company-notes-status" + (state ? ` ${state}` : "");
}

/** Write the box's current contents through to the store. */
async function flushItemNotes() {
  clearTimeout(notesSaveTimer);
  notesSaveTimer = null;

  const box = document.getElementById("itemNotesInput");
  const item = getPaneItem();
  if (!box || !item || box.value === item.record.notes) return;

  try {
    await setRecordNotes(item.type, item.id, box.value);
    setNotesStatus("Saved", "is-saved");
    clearTimeout(notesSavedTimer);
    notesSavedTimer = setTimeout(() => setNotesStatus(""), 1800);
    // The Notes column in the list behind the pane shows this too.
    refreshRecordListsIfActive();
  } catch (err) {
    setNotesStatus("Not saved", "is-error");
    showIndicator(err.message || "Could not save notes.", "error");
  }
}

function renderItemNotes(item) {
  const box = document.getElementById("itemNotesInput");
  if (!box) return;
  clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  box.value = item?.record.notes ?? "";
  box.placeholder = item?.type === ITEM_TYPE_CAMPAIGN
    ? "Offer details, discount codes, platforms, links to artwork…"
    : "Booth number, hotel, shipping deadlines, who's going…";
  setNotesStatus("");
}

function initItemNotes() {
  const box = document.getElementById("itemNotesInput");
  if (!box) return;

  box.addEventListener("input", () => {
    setNotesStatus("Saving…");
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(flushItemNotes, ITEM_NOTES_AUTOSAVE_MS);
  });

  // Leaving the box shouldn't wait out the debounce, and neither should
  // leaving the page.
  box.addEventListener("blur", flushItemNotes);
  window.addEventListener("beforeunload", flushItemNotes);
}

// ── Open / close ─────────────────────────────────────────────────────────────

function renderItemPane(item) {
  renderPaneHeader(item);
  renderPaneSummary(item);
  renderPaneTasks(item);
}

/** Light up the open record's row in whichever list is showing it. */
function syncPaneRowHighlight() {
  document.querySelectorAll(".record-table tr.is-pane-row").forEach(tr => tr.classList.remove("is-pane-row"));
  if (!paneItemRef) return;
  document.querySelectorAll(`.record-table tr[data-item-id="${CSS.escape(paneItemRef.id)}"]`)
    .forEach(tr => tr.classList.add("is-pane-row"));
}

function openItemPane(type, id) {
  const item = getScheduleItem(type, id);
  const pane = document.getElementById("itemPane");
  if (!item || !pane) return;

  // One pane at a time.
  closeBannerPane();
  // Moving straight from one record to another shouldn't drop a pending note.
  if (paneItemRef && (paneItemRef.type !== type || paneItemRef.id !== id)) flushItemNotes();
  paneItemRef = { type, id };

  renderItemPane(item);
  renderItemNotes(item);
  closeItemPaneMenu();
  pane.hidden = false;
  pane.querySelector(".item-pane-body")?.scrollTo({ top: 0 });
  syncPaneRowHighlight();
}

function closeItemPane() {
  if (!paneItemRef) return;
  // Flush before dropping the ref the flush needs to resolve the record.
  flushItemNotes();
  paneItemRef = null;
  closeItemPaneMenu();
  const pane = document.getElementById("itemPane");
  if (pane) pane.hidden = true;
  syncPaneRowHighlight();
}

/** Re-render the open pane after a change; closes it if its record is gone. */
function refreshItemPane() {
  if (!paneItemRef) return;
  const item = getPaneItem();
  if (!item) {
    paneItemRef = null;
    document.getElementById("itemPane").hidden = true;
    return;
  }
  renderItemPane(item);
  // Notes can change from the Edit form too. Leave the box alone while it's
  // being typed in, though — that text is newer than anything saved.
  const box = document.getElementById("itemNotesInput");
  if (box && document.activeElement !== box && !notesSaveTimer) box.value = item.record.notes;
  syncPaneRowHighlight();
}

// ── Menu ─────────────────────────────────────────────────────────────────────

function closeItemPaneMenu() {
  const menu = document.getElementById("itemPaneMenu");
  const btn = document.getElementById("itemPaneMenuBtn");
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

async function deletePaneItem() {
  const item = getPaneItem();
  if (!item) return;
  const meta = ITEM_TYPE_META[item.type];
  if (!confirm(`Delete ${item.title} and its tasks? This cannot be undone.`)) return;
  try {
    // Drop any pending note first — the record it would save to is going.
    clearTimeout(notesSaveTimer);
    notesSaveTimer = null;
    if (item.type === ITEM_TYPE_CAMPAIGN) await deleteCampaign(item.id);
    else await deleteTradeShow(item.id);
    paneItemRef = null;
    document.getElementById("itemPane").hidden = true;
    refreshTaskViews();
    showIndicator(`${item.title} deleted`, "success");
  } catch (err) {
    showIndicator(err.message || `Could not delete ${meta.noun}.`, "error");
  }
}

function initItemPaneMenu() {
  const btn = document.getElementById("itemPaneMenuBtn");
  const menu = document.getElementById("itemPaneMenu");
  if (!btn || !menu) return;

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  document.addEventListener("click", e => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    closeItemPaneMenu();
  });

  document.getElementById("itemMenuEdit")?.addEventListener("click", async () => {
    closeItemPaneMenu();
    if (!paneItemRef) return;
    // The form edits notes too, so it has to open on what's actually saved.
    await flushItemNotes();
    if (paneItemRef.type === ITEM_TYPE_CAMPAIGN) openCampaignForm(paneItemRef.id);
    else openTradeShowForm(paneItemRef.id);
  });

  document.getElementById("itemMenuDelete")?.addEventListener("click", () => {
    closeItemPaneMenu();
    deletePaneItem();
  });
}

function isAnyFormOpen() {
  return document.querySelector(".modal-backdrop.open") !== null;
}

function initItemPane() {
  initItemNotes();
  initItemPaneMenu();

  document.getElementById("itemPaneClose")?.addEventListener("click", closeItemPane);

  applyPaneLayout();
  document.querySelectorAll("#itemPaneLayoutToggle .item-pane-layout-btn").forEach(btn => {
    btn.addEventListener("click", () => setPaneLayout(btn.dataset.layout));
  });

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !isItemPaneOpen()) return;
    // Let an open modal or menu take Escape first.
    if (isAnyFormOpen()) return;
    if (!document.getElementById("itemPaneMenu")?.hidden) {
      closeItemPaneMenu();
      return;
    }
    closeItemPane();
  });
}
