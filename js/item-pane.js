/**
 * Side pane for one campaign or trade show — slides in over the right side of
 * whatever view is open, the same way the PO App's packing list pane sits
 * beside its table. The list stays where it was underneath, with the open
 * row highlighted, so you can click from one record to the next.
 *
 * Card view: a header card, then the tasks as a card on the grey background.
 *
 *   header   name, type, dates and length, status, ⋯ menu, close — and the
 *            notes, which save as you type and stay put while tasks scroll
 *   tasks    a card each, in due-date order: type, due date, memo, a Mark as
 *            Complete button and a ⋯ menu to edit or delete; Add Task adds one
 */

/** { type, id } of the item in the pane, or null when it's closed. */
let paneItemRef = null;

function getPaneItem() {
  return paneItemRef ? getScheduleItem(paneItemRef.type, paneItemRef.id) : null;
}

function isItemPaneOpen() {
  return paneItemRef !== null;
}

const ITEM_TYPE_META = {
  [ITEM_TYPE_TRADE_SHOW]: { noun: "trade show", tasksTitle: "Tasks", editLabel: "Edit trade show" },
  [ITEM_TYPE_CAMPAIGN]: { noun: "campaign", tasksTitle: "Tasks", editLabel: "Edit campaign" },
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
    // What it is, when, and how long.
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

// ── Tasks ────────────────────────────────────────────────────────────────────

/** Saved id of the task open for editing in the pane, or null. */
let paneEditingTaskId = null;

function paneIconButton(label, paths, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "item-task-icon-btn";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">${paths}</svg>`;
  btn.addEventListener("click", e => {
    e.stopPropagation();
    onClick(btn);
  });
  return btn;
}

/** Close every task menu and the Add Task menu in the pane. */
function closePaneTaskMenus(except = null) {
  document.querySelectorAll("#itemPane .item-task-menu").forEach(menu => {
    if (menu === except) return;
    menu.hidden = true;
    menu.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
}

function togglePaneTaskMenu(btn, menu) {
  const open = menu.hidden;
  closePaneTaskMenus(menu);
  menu.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function paneMenuItem(label, onClick, danger = false) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "item-task-menu-item" + (danger ? " is-danger" : "");
  item.setAttribute("role", "menuitem");
  item.textContent = label;
  item.addEventListener("click", e => {
    e.stopPropagation();
    closePaneTaskMenus();
    onClick();
  });
  return item;
}

/** The "+ Add Task" button in the section head, with its menu of types. */
function renderPaneAddTask(item) {
  const head = document.querySelector("#itemPane .item-pane-section-head");
  if (!head) return;
  head.querySelector(".item-task-add")?.remove();

  const wrap = document.createElement("div");
  wrap.className = "item-task-add";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "item-task-add-btn";
  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Add Task</span>';

  const menu = document.createElement("div");
  menu.className = "item-task-menu item-task-add-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  CAMPAIGN_TASK_CATEGORIES.forEach(cat => {
    const option = paneMenuItem(cat.label, () => addPaneTask(item, cat.key));
    const icon = createCalEventIcon(cat.key);
    icon.classList.add("item-task-menu-icon");
    option.prepend(icon);
    option.dataset.kind = cat.key;
    menu.appendChild(option);
  });

  btn.addEventListener("click", e => {
    e.stopPropagation();
    togglePaneTaskMenu(btn, menu);
  });
  wrap.append(btn, menu);
  head.appendChild(wrap);
}

async function addPaneTask(item, category) {
  try {
    const id = await addItemTask(item, category);
    paneEditingTaskId = id;
    refreshTaskViews();
    document.querySelector(`#itemPane .item-task-card[data-saved-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  } catch (err) {
    showIndicator(err.message || "Could not add task.", "error");
  }
}

async function deletePaneTask(item, task) {
  if (!confirm(`Delete the ${task.label} task due ${formatTaskDateShort(task.dueDate)}?`)) return;
  // Its Mailchimp draft, if any, is a separate question.
  await offerToDeleteLinkedCampaigns([task]);
  try {
    await deleteItemTask(item, task);
    if (paneEditingTaskId === task.savedId) paneEditingTaskId = null;
    refreshTaskViews();
    showIndicator("Task deleted", "success");
  } catch (err) {
    showIndicator(err.message || "Could not delete task.", "error");
  }
}

/** Due date and memo, edited in place on the card. */
function createPaneTaskEditor(item, task) {
  const form = document.createElement("form");
  form.className = "item-task-edit";
  form.noValidate = true;

  const dateField = document.createElement("label");
  dateField.className = "item-task-edit-field";
  const dateLabel = document.createElement("span");
  dateLabel.textContent = "Due date";
  const date = document.createElement("input");
  date.type = "date";
  date.className = "form-input";
  date.value = task.dueDate;
  date.required = true;
  dateField.append(dateLabel, date);

  const memoField = document.createElement("label");
  memoField.className = "item-task-edit-field";
  const memoLabel = document.createElement("span");
  memoLabel.textContent = "Memo";
  const memo = document.createElement("textarea");
  memo.className = "form-input";
  memo.rows = 3;
  memo.value = task.memo ?? "";
  memoField.append(memoLabel, memo);

  const actions = document.createElement("div");
  actions.className = "item-task-edit-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    paneEditingTaskId = null;
    renderPaneTasks(item);
  });
  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "Save";
  actions.append(cancel, saveBtn);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!date.value) {
      date.classList.add("is-invalid");
      date.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      await updateItemTask(item, task, { dueDate: date.value, memo: memo.value.trim() });
      paneEditingTaskId = null;
      refreshTaskViews();
    } catch (err) {
      saveBtn.disabled = false;
      showIndicator(err.message || "Could not save task.", "error");
    }
  });
  form.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel.click();
    }
  });
  date.addEventListener("input", () => date.classList.remove("is-invalid"));

  form.append(dateField, memoField, actions);
  requestAnimationFrame(() => date.focus());
  return form;
}

function createPaneTaskCard(item, task) {
  const done = isTaskComplete(task.id);
  const card = document.createElement("article");
  card.className = "item-task-card" + (done ? " is-done" : "");
  card.dataset.kind = task.kind;
  card.dataset.taskId = task.id;
  card.dataset.savedId = task.savedId;

  // Header: what it is (a chip in the type's colour), when it's due, then
  // the email's Mailchimp state, Done and the ⋯ menu on the right.
  const head = document.createElement("div");
  head.className = "item-task-card-head";

  const type = document.createElement("span");
  type.className = "item-task-type";
  const icon = createCalEventIcon(task.kind);
  icon.classList.add("item-task-card-icon");
  const typeText = document.createElement("span");
  typeText.textContent = task.label;
  type.append(icon, typeText);

  const due = document.createElement("span");
  due.className = "item-task-due";
  due.textContent = formatTaskDateShort(task.dueDate);
  if (isTaskOverdue(task)) {
    due.classList.add("is-overdue");
    due.title = "Overdue";
  }

  head.append(type, due);

  // A linked email that's gone out shows nothing more than Done — its
  // report is in the ⋯ menu.
  const mcLink = task.kind === TASK_KIND_EMAIL ? getTaskLink(task.id) : null;
  const mcCampaign = mcLink ? getMcCampaign(mcLink.campaignId) : null;
  const mcSent = mcCampaign?.status === "sent" && !mcCampaign.missing;

  // An email's Mailchimp state sits in the header until it's sent.
  if (task.kind === TASK_KIND_EMAIL && !mcSent) {
    const pill = createMcStatusPill(task.id);
    if (pill) head.appendChild(pill);
  }

  const complete = document.createElement("button");
  complete.type = "button";
  complete.className = "item-task-complete" + (done ? " is-done" : "");
  complete.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg><span>Done</span>';
  complete.title = done ? "Mark as not done" : "Mark as done";
  complete.setAttribute("aria-pressed", done ? "true" : "false");
  complete.addEventListener("click", async e => {
    e.stopPropagation();
    complete.disabled = true;
    try {
      await setTaskComplete(task.id, !done);
      refreshTaskViews();
    } catch (err) {
      complete.disabled = false;
      showIndicator(err.message || "Could not update task.", "error");
    }
  });
  head.appendChild(complete);

  const menuWrap = document.createElement("div");
  menuWrap.className = "item-task-card-menu";
  const menu = document.createElement("div");
  menu.className = "item-task-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.append(
    paneMenuItem("Edit", () => {
      paneEditingTaskId = task.savedId;
      renderPaneTasks(item);
    }),
    paneMenuItem("Delete", () => deletePaneTask(item, task), true),
  );
  if (mcSent && mcCampaign.reportUrl) {
    const report = paneMenuItem("Report ↗", () => window.open(mcCampaign.reportUrl, "_blank", "noopener"));
    menu.insertBefore(report, menu.lastChild);
  }
  const menuBtn = paneIconButton("Task options",
    '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    btn => togglePaneTaskMenu(btn, menu));
  menuBtn.setAttribute("aria-haspopup", "menu");
  menuBtn.setAttribute("aria-expanded", "false");
  menuWrap.append(menuBtn, menu);
  head.appendChild(menuWrap);
  card.appendChild(head);

  // Body: the memo — or the editor for it.
  if (paneEditingTaskId === task.savedId) {
    card.classList.add("is-editing");
    card.appendChild(createPaneTaskEditor(item, task));
  } else if (task.memo) {
    const memo = document.createElement("p");
    memo.className = "item-task-memo";
    memo.textContent = task.memo;
    card.appendChild(memo);
  }

  // A linked email shows who it goes to and its Mailchimp buttons.
  if (mcLink && !mcSent) card.appendChild(createMailchimpStrip(task, item));

  return card;
}

function renderPaneTasks(item) {
  const body = document.getElementById("itemPaneTasks");
  if (!body) return;

  const title = document.getElementById("itemPaneTasksTitle");
  if (title) title.textContent = ITEM_TYPE_META[item.type].tasksTitle;

  const { done, total } = getItemTaskProgress(item);
  const count = document.getElementById("itemPaneTasksCount");
  if (count) count.textContent = total ? `${done} of ${total} done` : "";

  renderPaneAddTask(item);

  // A task that's gone (deleted elsewhere) can't stay open for editing.
  if (paneEditingTaskId && !item.tasks.some(t => t.savedId === paneEditingTaskId)) paneEditingTaskId = null;

  if (total === 0) {
    const empty = document.createElement("div");
    empty.className = "item-tasks-empty";
    empty.textContent = "No tasks yet. Use Add Task to add an email, graphic, social media post or video.";
    body.replaceChildren(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "item-task-list item-task-cards";
  item.tasks.forEach(task => list.appendChild(createPaneTaskCard(item, task)));
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
  closeShootPane();
  // Moving straight from one record to another shouldn't drop a pending note.
  if (paneItemRef && (paneItemRef.type !== type || paneItemRef.id !== id)) flushItemNotes();
  if (!paneItemRef || paneItemRef.type !== type || paneItemRef.id !== id) paneEditingTaskId = null;
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
  paneEditingTaskId = null;
  closeItemPaneMenu();
  const pane = document.getElementById("itemPane");
  if (pane) pane.hidden = true;
  syncPaneRowHighlight();
  // On Home, the card and calendar days lit up for this item go with it.
  if (typeof clearCalGroupSelection === "function") clearCalGroupSelection();
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
  // Its emails may have Mailchimp drafts — ask about those separately.
  await offerToDeleteLinkedCampaigns(item.tasks);
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

  // A click anywhere else closes the task menus too.
  document.addEventListener("click", e => {
    if (!e.target.closest?.(".item-task-menu")) closePaneTaskMenus();
    if (menu.hidden) return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    closeItemPaneMenu();
  });

  document.getElementById("itemMenuEdit")?.addEventListener("click", () => {
    closeItemPaneMenu();
    if (!paneItemRef) return;
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

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !isItemPaneOpen()) return;
    // Let an open modal or menu take Escape first.
    if (isAnyFormOpen()) return;
    if (!document.getElementById("itemPaneMenu")?.hidden) {
      closeItemPaneMenu();
      return;
    }
    const taskMenu = document.querySelector("#itemPane .item-task-menu:not([hidden])");
    if (taskMenu) {
      closePaneTaskMenus();
      return;
    }
    closeItemPane();
  });
}
