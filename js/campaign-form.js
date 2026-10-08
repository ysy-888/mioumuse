/**
 * Add / edit campaign modal.
 *
 * Pick the type (Sale unless you say otherwise), name it if you like, set its
 * dates, then add whatever tasks it needs — Email, Banner, Social Media, as
 * many of each as you want. A new task is due on the campaign's start date,
 * and keeps following the start date until you give it a date of its own.
 */

let campaignFormMode = "create";
let campaignFormId = null;

/**
 * The tasks being edited: { id, category, dueDate, followsStart }.
 * `followsStart` is form-only — it's how a task you haven't touched moves
 * with the start date while one you've dated yourself stays put.
 */
let campaignDraftTasks = [];

// ── Type picker ──────────────────────────────────────────────────────────────

function fillCampaignTypePicker() {
  const row = document.getElementById("campaignFormType");
  if (!row) return;

  row.replaceChildren(...CAMPAIGN_TYPES.map(type => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "form-toggle-btn item-toggle";
    btn.dataset.value = type.key;
    btn.dataset.campaignType = type.key;
    btn.textContent = type.label;
    btn.setAttribute("aria-pressed", "false");
    // Always exactly one type — clicking the active one keeps it.
    btn.addEventListener("click", () => setCampaignTypeValue(type.key));
    return btn;
  }));
}

function setCampaignTypeValue(value) {
  document.querySelectorAll("#campaignFormType .form-toggle-btn").forEach(btn => {
    const active = btn.dataset.value === value;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function getCampaignTypeValue() {
  return document.querySelector("#campaignFormType .form-toggle-btn.is-active")?.dataset.value ?? DEFAULT_CAMPAIGN_TYPE;
}

// ── Task builder ─────────────────────────────────────────────────────────────

function getCampaignFormStart() {
  return document.getElementById("campaignFormStart")?.value ?? "";
}

function fillCampaignAddTaskButtons() {
  const row = document.getElementById("campaignFormAddTask");
  if (!row) return;

  row.replaceChildren(...CAMPAIGN_TASK_CATEGORIES.map(category => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn campaign-add-task-btn";
    btn.dataset.kind = category.key;
    btn.append(createCalEventIcon(category.key), document.createTextNode(`+ ${category.label}`));
    btn.addEventListener("click", () => addCampaignDraftTask(category.key));
    return btn;
  }));
}

function addCampaignDraftTask(category) {
  campaignDraftTasks.push({
    id: newCampaignTaskId(),
    category,
    dueDate: getCampaignFormStart(),
    followsStart: true,
  });
  renderCampaignDraftTasks();
  setCampaignFormMessage("");
  // Land on the new row's date, the one thing you might want to change.
  const inputs = document.querySelectorAll("#campaignFormTasks .campaign-task-date");
  inputs[inputs.length - 1]?.focus();
}

function renderCampaignDraftTasks() {
  const list = document.getElementById("campaignFormTasks");
  if (!list) return;

  if (campaignDraftTasks.length === 0) {
    const hint = document.createElement("span");
    hint.className = "form-hint";
    hint.textContent = "No tasks yet — add the emails, banners and posts this campaign needs.";
    list.replaceChildren(hint);
    return;
  }

  list.replaceChildren(...campaignDraftTasks.map(task => {
    const row = document.createElement("div");
    row.className = "campaign-task-row";
    row.dataset.kind = task.category;

    const name = document.createElement("span");
    name.className = "campaign-task-name";
    name.append(createCalEventIcon(task.category), document.createTextNode(getCampaignTaskCategoryLabel(task.category)));

    const date = document.createElement("input");
    date.type = "date";
    date.className = "form-input campaign-task-date";
    date.value = task.dueDate;
    date.setAttribute("aria-label", `${getCampaignTaskCategoryLabel(task.category)} due date`);
    date.addEventListener("change", () => {
      task.dueDate = date.value;
      // Picking the start date again re-attaches it; anything else is its own.
      task.followsStart = date.value === getCampaignFormStart();
      date.classList.remove("is-invalid");
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-close campaign-task-remove";
    remove.setAttribute("aria-label", `Remove ${getCampaignTaskCategoryLabel(task.category)} task`);
    remove.title = "Remove task";
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
      campaignDraftTasks = campaignDraftTasks.filter(t => t !== task);
      renderCampaignDraftTasks();
    });

    row.append(name, date, remove);
    return row;
  }));
}

/** Tasks still following the start date move with it. */
function syncDraftTasksToStart() {
  const start = getCampaignFormStart();
  let changed = false;
  campaignDraftTasks.forEach(task => {
    if (task.followsStart || !task.dueDate) {
      task.dueDate = start;
      task.followsStart = true;
      changed = true;
    }
  });
  if (changed) renderCampaignDraftTasks();
}

// ── Specific days ────────────────────────────────────────────────────────────
//
// Off, the campaign runs every day from start to end. On, it runs only on the
// weekdays picked — a sale from 11/7 to 12/19 on Fri, Sat and Sun, say.

function fillCampaignWeekdayButtons() {
  const row = document.getElementById("campaignFormWeekdays");
  if (!row) return;

  row.replaceChildren(...WEEKDAY_DISPLAY_ORDER.map(day => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "form-toggle-btn campaign-weekday-btn";
    btn.dataset.day = String(day);
    btn.textContent = WEEKDAY_SHORT[day];
    btn.setAttribute("aria-pressed", "false");
    // Several can be on at once — each click flips just this one.
    btn.addEventListener("click", () => {
      const on = !btn.classList.contains("is-active");
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      row.classList.remove("is-invalid");
      updateCampaignDaysHint();
    });
    return btn;
  }));
}

function isSpecificDaysOn() {
  return document.getElementById("campaignFormSpecificDays")?.checked === true;
}

function getPickedWeekdays() {
  return [...document.querySelectorAll("#campaignFormWeekdays .campaign-weekday-btn.is-active")]
    .map(btn => Number(btn.dataset.day));
}

/** What the form will save: [] for every day, or the picked weekdays. */
function getCampaignFormWeekdays() {
  return isSpecificDaysOn() ? normalizeWeekdays(getPickedWeekdays()) : [];
}

function setCampaignFormWeekdays(weekdays) {
  const toggle = document.getElementById("campaignFormSpecificDays");
  if (toggle) toggle.checked = weekdays.length > 0;
  const picked = new Set(weekdays);
  document.querySelectorAll("#campaignFormWeekdays .campaign-weekday-btn").forEach(btn => {
    const on = picked.has(Number(btn.dataset.day));
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  syncSpecificDaysVisibility();
}

function syncSpecificDaysVisibility() {
  const row = document.getElementById("campaignFormWeekdays");
  if (row) row.hidden = !isSpecificDaysOn();
  updateCampaignDaysHint();
}

/** "Runs 21 days: Fri, Sat, Sun between Nov 7 and Dec 19." */
function updateCampaignDaysHint() {
  const hint = document.getElementById("campaignFormDaysHint");
  if (!hint) return;

  const startDate = getCampaignFormStart();
  const endDate = document.getElementById("campaignFormEnd")?.value ?? "";
  if (!isSpecificDaysOn()) {
    hint.textContent = "";
    return;
  }
  const picked = getPickedWeekdays();
  if (picked.length === 0) {
    hint.textContent = "Pick the days of the week it runs on.";
    return;
  }
  if (!startDate || !endDate || endDate < startDate) {
    hint.textContent = `${formatWeekdayList(picked)} only.`;
    return;
  }
  const n = countActiveDays({ startDate, endDate, weekdays: picked });
  hint.textContent = n === 0
    ? "None of these days fall between the start and end dates."
    : `Runs ${n === 1 ? "1 day" : `${n} days`}: ${formatWeekdayList(picked)} between ${formatLongDate(startDate)} and ${formatLongDate(endDate)}.`;
}

// ── Validation ───────────────────────────────────────────────────────────────

function setCampaignFormMessage(text, type = "") {
  const el = document.getElementById("campaignFormMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (type ? ` ${type}` : "");
}

function clearCampaignFormErrors() {
  document.querySelectorAll("#campaignForm .is-invalid").forEach(el => el.classList.remove("is-invalid"));
  setCampaignFormMessage("");
}

/** The first problem with the form, marking the field it belongs to. */
function validateCampaignForm({ startDate, endDate, tasks }) {
  if (!startDate) {
    document.getElementById("campaignFormStart")?.classList.add("is-invalid");
    return "Pick a start date.";
  }
  if (!endDate) {
    document.getElementById("campaignFormEnd")?.classList.add("is-invalid");
    return "Pick an end date.";
  }
  if (endDate < startDate) {
    document.getElementById("campaignFormEnd")?.classList.add("is-invalid");
    return "The end date can't be before the start date.";
  }
  if (isSpecificDaysOn()) {
    if (getPickedWeekdays().length === 0) {
      document.getElementById("campaignFormWeekdays")?.classList.add("is-invalid");
      return "Pick at least one day of the week, or turn off specific days.";
    }
    if (countActiveDays({ startDate, endDate, weekdays: getPickedWeekdays() }) === 0) {
      document.getElementById("campaignFormWeekdays")?.classList.add("is-invalid");
      return "None of the chosen days fall between the start and end dates.";
    }
  }
  const undated = tasks.findIndex(task => !task.dueDate);
  if (undated !== -1) {
    document.querySelectorAll("#campaignFormTasks .campaign-task-date")[undated]?.classList.add("is-invalid");
    return "Every task needs a due date.";
  }
  return "";
}

// ── Open / close ─────────────────────────────────────────────────────────────

/** Pass an id to edit; omit it to create. */
function openCampaignForm(campaignId = null) {
  const overlay = document.getElementById("campaignFormOverlay");
  if (!overlay) return;

  const campaign = campaignId ? getCampaignById(campaignId) : null;
  campaignFormMode = campaign ? "edit" : "create";
  campaignFormId = campaign?.id ?? null;

  const title = document.getElementById("campaignFormTitle");
  if (title) title.textContent = campaign ? "Edit campaign" : "Add campaign";

  setCampaignTypeValue(campaign?.type ?? DEFAULT_CAMPAIGN_TYPE);
  const name = document.getElementById("campaignFormName");
  if (name) name.value = campaign?.name ?? "";
  const notes = document.getElementById("campaignFormNotes");
  if (notes) notes.value = campaign?.notes ?? "";
  const start = document.getElementById("campaignFormStart");
  const end = document.getElementById("campaignFormEnd");
  if (start) start.value = campaign?.startDate ?? "";
  if (end) {
    end.value = campaign?.endDate ?? "";
    end.min = campaign?.startDate ?? "";
  }
  setCampaignFormWeekdays(campaign?.weekdays ?? []);

  campaignDraftTasks = (campaign?.tasks ?? []).map(task => ({
    ...task,
    followsStart: task.dueDate === campaign.startDate,
  }));
  renderCampaignDraftTasks();

  clearCampaignFormErrors();
  overlay.classList.add("open");
  requestAnimationFrame(() => name?.focus());
}

function closeCampaignForm() {
  document.getElementById("campaignFormOverlay")?.classList.remove("open");
  campaignFormId = null;
  campaignDraftTasks = [];
}

function isCampaignFormOpen() {
  return document.getElementById("campaignFormOverlay")?.classList.contains("open") === true;
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function saveCampaignForm() {
  clearCampaignFormErrors();

  const fields = {
    type: getCampaignTypeValue(),
    name: (document.getElementById("campaignFormName")?.value ?? "").trim(),
    startDate: getCampaignFormStart(),
    endDate: document.getElementById("campaignFormEnd")?.value ?? "",
    weekdays: getCampaignFormWeekdays(),
    tasks: campaignDraftTasks.map(({ id, category, dueDate }) => ({ id, category, dueDate })),
    notes: document.getElementById("campaignFormNotes")?.value ?? "",
  };

  const invalid = validateCampaignForm(fields);
  if (invalid) {
    setCampaignFormMessage(invalid, "error");
    return;
  }

  const saveBtn = document.getElementById("campaignFormSaveBtn");
  if (saveBtn) saveBtn.disabled = true;
  setCampaignFormMessage("Saving…");

  try {
    if (campaignFormMode === "edit") {
      const updated = await updateCampaign(campaignFormId, fields);
      closeCampaignForm();
      refreshTaskViews();
      showIndicator(`${getCampaignTitle(updated)} updated`, "success");
    } else {
      const created = await createCampaign(fields);
      closeCampaignForm();
      refreshTaskViews();
      showIndicator(`${getCampaignTitle(created)} added`, "success");
      openItemPane(ITEM_TYPE_CAMPAIGN, created.id);
    }
  } catch (err) {
    setCampaignFormMessage(err.message || "Could not save.", "error");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initCampaignForm() {
  fillCampaignTypePicker();
  fillCampaignAddTaskButtons();
  fillCampaignWeekdayButtons();

  document.getElementById("campaignFormSpecificDays")?.addEventListener("change", () => {
    document.getElementById("campaignFormWeekdays")?.classList.remove("is-invalid");
    syncSpecificDaysVisibility();
  });

  document.getElementById("addCampaignBtn")?.addEventListener("click", () => openCampaignForm());
  document.getElementById("campaignFormSaveBtn")?.addEventListener("click", saveCampaignForm);
  document.getElementById("campaignFormCancelBtn")?.addEventListener("click", closeCampaignForm);
  document.getElementById("campaignFormCloseBtn")?.addEventListener("click", closeCampaignForm);

  const start = document.getElementById("campaignFormStart");
  const end = document.getElementById("campaignFormEnd");

  start?.addEventListener("change", () => {
    // The end date starts from the start date rather than from today — and
    // follows it if it was left behind.
    if (end && start.value && (!end.value || end.value < start.value)) end.value = start.value;
    if (end) end.min = start.value;
    start.classList.remove("is-invalid");
    syncDraftTasksToStart();
    updateCampaignDaysHint();
  });
  end?.addEventListener("change", () => {
    end.classList.remove("is-invalid");
    updateCampaignDaysHint();
  });

  // Enter saves from any single-line field; buttons, the switch and the
  // notes box keep their own Enter.
  document.getElementById("campaignForm")?.addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON" || e.target.tagName === "TEXTAREA") return;
    if (e.target.type === "checkbox") return;
    e.preventDefault();
    saveCampaignForm();
  });

  const overlay = document.getElementById("campaignFormOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closeCampaignForm();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && isCampaignFormOpen()) closeCampaignForm();
  });
}
