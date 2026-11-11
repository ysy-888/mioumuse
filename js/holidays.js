/**
 * Holidays — a name and a run of days, marked on the Home calendar.
 *
 * Added from the Home page's menu (⋮ → Add Holiday). Not a task: there's
 * nothing to finish and no day-pane card. Clicking one on the calendar opens
 * this same form to edit or delete it.
 */

let holidayFormId = null; // the holiday being edited, or null when adding

function setHolidayFormMessage(text, type = "") {
  const el = document.getElementById("holidayFormMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (type ? ` ${type}` : "");
}

function clearHolidayFormErrors() {
  ["holidayFormName", "holidayFormStart", "holidayFormEnd"].forEach(id => {
    document.getElementById(id)?.classList.remove("is-invalid");
  });
  setHolidayFormMessage("");
}

/** The first problem with the form, marking the field it belongs to. */
function validateHolidayForm({ name, startDate, endDate }) {
  const mark = id => document.getElementById(id)?.classList.add("is-invalid");
  if (!name) { mark("holidayFormName"); return "Give the holiday a name."; }
  if (!startDate) { mark("holidayFormStart"); return "Pick a start date."; }
  if (!endDate) { mark("holidayFormEnd"); return "Pick an end date."; }
  if (endDate < startDate) { mark("holidayFormEnd"); return "The end date can't be before the start date."; }
  return "";
}

/** Pass an id to edit; omit it to add. `startDate` prefills a new one. */
function openHolidayForm(holidayId = null, { startDate = "" } = {}) {
  const overlay = document.getElementById("holidayFormOverlay");
  if (!overlay) return;

  const holiday = holidayId ? getHolidayById(holidayId) : null;
  holidayFormId = holiday?.id ?? null;

  document.getElementById("holidayFormTitle").textContent = holiday ? "Edit holiday" : "Add holiday";
  document.getElementById("holidayFormName").value = holiday?.name ?? "";
  const start = document.getElementById("holidayFormStart");
  const end = document.getElementById("holidayFormEnd");
  start.value = holiday?.startDate ?? startDate;
  end.value = holiday?.endDate ?? startDate;
  end.min = start.value;
  document.getElementById("holidayFormDeleteBtn").hidden = !holiday;

  clearHolidayFormErrors();
  overlay.classList.add("open");
  requestAnimationFrame(() => document.getElementById("holidayFormName")?.focus());
}

function closeHolidayForm() {
  document.getElementById("holidayFormOverlay")?.classList.remove("open");
  holidayFormId = null;
}

function isHolidayFormOpen() {
  return document.getElementById("holidayFormOverlay")?.classList.contains("open") === true;
}

async function saveHolidayForm() {
  clearHolidayFormErrors();

  const fields = {
    name: document.getElementById("holidayFormName")?.value.trim() ?? "",
    startDate: document.getElementById("holidayFormStart")?.value ?? "",
    endDate: document.getElementById("holidayFormEnd")?.value ?? "",
  };
  const invalid = validateHolidayForm(fields);
  if (invalid) {
    setHolidayFormMessage(invalid, "error");
    return;
  }

  const saveBtn = document.getElementById("holidayFormSaveBtn");
  if (saveBtn) saveBtn.disabled = true;
  setHolidayFormMessage("Saving…");

  try {
    const editing = Boolean(holidayFormId);
    const saved = editing ? await updateHoliday(holidayFormId, fields) : await createHoliday(fields);
    closeHolidayForm();
    refreshCalendarIfActive();
    showIndicator(`${saved.name} ${editing ? "updated" : "added"}`, "success");
  } catch (err) {
    setHolidayFormMessage(err.message || "Could not save.", "error");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deleteHolidayFromForm() {
  const holiday = holidayFormId ? getHolidayById(holidayFormId) : null;
  if (!holiday) return;
  if (!confirm(`Delete the holiday "${holiday.name}"? This cannot be undone.`)) return;

  try {
    await deleteHoliday(holiday.id);
    closeHolidayForm();
    refreshCalendarIfActive();
    showIndicator(`${holiday.name} deleted`, "success");
  } catch (err) {
    setHolidayFormMessage(err.message || "Could not delete.", "error");
  }
}

/** The label a holiday puts on each of its days in the calendar grid. */
function createCalHolidayChip(holiday) {
  const chip = document.createElement("button");
  chip.type = "button";
  // A dash-event too, so it takes a lane slot like any other bar.
  chip.className = "dash-event dash-cal-holiday cal-event--holiday";
  const label = document.createElement("span");
  label.className = "dash-event-title";
  label.textContent = holiday.name;
  chip.appendChild(label);
  const days = holiday.startDate === holiday.endDate
    ? formatTaskDate(holiday.startDate)
    : formatDateRange(holiday.startDate, holiday.endDate);
  chip.title = `${holiday.name} · ${days} · click to edit`;
  chip.addEventListener("click", e => {
    // Editing the holiday, not opening the day underneath it.
    e.stopPropagation();
    openHolidayForm(holiday.id);
  });
  return chip;
}

function initHolidayForm() {
  document.getElementById("headerMenuAddHoliday")?.addEventListener("click", () => {
    closeHeaderMenu();
    openHolidayForm(null, { startDate: calSelectedYmd || "" });
  });

  document.getElementById("holidayFormSaveBtn")?.addEventListener("click", saveHolidayForm);
  document.getElementById("holidayFormDeleteBtn")?.addEventListener("click", deleteHolidayFromForm);
  document.getElementById("holidayFormCancelBtn")?.addEventListener("click", closeHolidayForm);
  document.getElementById("holidayFormCloseBtn")?.addEventListener("click", closeHolidayForm);

  const start = document.getElementById("holidayFormStart");
  const end = document.getElementById("holidayFormEnd");
  start?.addEventListener("change", () => {
    // Most holidays are a day or two, so the end follows the start.
    if (end && start.value && (!end.value || end.value < start.value)) end.value = start.value;
    if (end) end.min = start.value;
    clearHolidayFormErrors();
  });
  end?.addEventListener("change", clearHolidayFormErrors);

  // Enter saves from any field.
  document.getElementById("holidayForm")?.addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON") return;
    e.preventDefault();
    saveHolidayForm();
  });

  const overlay = document.getElementById("holidayFormOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closeHolidayForm();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && isHolidayFormOpen()) closeHolidayForm();
  });
}
