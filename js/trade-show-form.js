/**
 * Add / edit trade show modal.
 *
 * Pick the show and set its first and last day. Its emails follow from Day 1;
 * those, any other tasks and the notes are edited in the side pane
 * (js/item-pane.js).
 */

let tradeShowFormMode = "create";
let tradeShowFormId = null;

// ── Show picker ──────────────────────────────────────────────────────────────

/** A button per show; one is always the selection once picked. */
function fillTradeShowPicker() {
  const row = document.getElementById("tradeShowFormShow");
  if (!row) return;

  row.replaceChildren(...TRADE_SHOWS.map(show => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "form-toggle-btn item-toggle";
    btn.dataset.value = show.key;
    btn.dataset.show = show.key;
    btn.textContent = show.label;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      setTradeShowPickerValue(show.key);
      clearTradeShowFormErrors();
    });
    return btn;
  }));
}

function setTradeShowPickerValue(value) {
  document.querySelectorAll("#tradeShowFormShow .form-toggle-btn").forEach(btn => {
    const active = btn.dataset.value === value;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function getTradeShowPickerValue() {
  return document.querySelector("#tradeShowFormShow .form-toggle-btn.is-active")?.dataset.value ?? "";
}

// ── Validation ───────────────────────────────────────────────────────────────

function setTradeShowFormMessage(text, type = "") {
  const el = document.getElementById("tradeShowFormMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (type ? ` ${type}` : "");
}

function clearTradeShowFormErrors() {
  ["tradeShowFormStart", "tradeShowFormEnd"].forEach(id => {
    document.getElementById(id)?.classList.remove("is-invalid");
  });
  document.getElementById("tradeShowFormShow")?.classList.remove("is-invalid");
  setTradeShowFormMessage("");
}

/** The first problem with the form, marking the field it belongs to. */
function validateTradeShowForm({ show, startDate, endDate }) {
  if (!show) {
    document.getElementById("tradeShowFormShow")?.classList.add("is-invalid");
    return "Pick a trade show.";
  }
  if (!startDate) {
    document.getElementById("tradeShowFormStart")?.classList.add("is-invalid");
    return "Pick a start date.";
  }
  if (!endDate) {
    document.getElementById("tradeShowFormEnd")?.classList.add("is-invalid");
    return "Pick an end date.";
  }
  if (endDate < startDate) {
    document.getElementById("tradeShowFormEnd")?.classList.add("is-invalid");
    return "The end date can't be before the start date.";
  }
  return "";
}

// ── Open / close ─────────────────────────────────────────────────────────────

/** Pass an id to edit; omit it to create. */
function openTradeShowForm(tradeShowId = null) {
  const overlay = document.getElementById("tradeShowFormOverlay");
  if (!overlay) return;

  const tradeShow = tradeShowId ? getTradeShowById(tradeShowId) : null;
  tradeShowFormMode = tradeShow ? "edit" : "create";
  tradeShowFormId = tradeShow?.id ?? null;

  const title = document.getElementById("tradeShowFormTitle");
  if (title) title.textContent = tradeShow ? "Edit trade show" : "Add trade show";

  setTradeShowPickerValue(tradeShow?.show ?? "");
  const start = document.getElementById("tradeShowFormStart");
  const end = document.getElementById("tradeShowFormEnd");
  if (start) start.value = tradeShow?.startDate ?? "";
  if (end) {
    end.value = tradeShow?.endDate ?? "";
    end.min = tradeShow?.startDate ?? "";
  }
  clearTradeShowFormErrors();
  overlay.classList.add("open");
  requestAnimationFrame(() => {
    document.querySelector("#tradeShowFormShow .form-toggle-btn.is-active, #tradeShowFormShow .form-toggle-btn")?.focus();
  });
}

function closeTradeShowForm() {
  document.getElementById("tradeShowFormOverlay")?.classList.remove("open");
  tradeShowFormId = null;
}

function isTradeShowFormOpen() {
  return document.getElementById("tradeShowFormOverlay")?.classList.contains("open") === true;
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function saveTradeShowForm() {
  clearTradeShowFormErrors();

  const fields = {
    show: getTradeShowPickerValue(),
    startDate: document.getElementById("tradeShowFormStart")?.value ?? "",
    endDate: document.getElementById("tradeShowFormEnd")?.value ?? "",
  };

  const invalid = validateTradeShowForm(fields);
  if (invalid) {
    setTradeShowFormMessage(invalid, "error");
    return;
  }

  const saveBtn = document.getElementById("tradeShowFormSaveBtn");
  if (saveBtn) saveBtn.disabled = true;
  setTradeShowFormMessage("Saving…");

  try {
    if (tradeShowFormMode === "edit") {
      const updated = await updateTradeShow(tradeShowFormId, fields);
      closeTradeShowForm();
      refreshTaskViews();
      showIndicator(`${getTradeShowTitle(updated)} updated`, "success");
    } else {
      const created = await createTradeShow(fields);
      closeTradeShowForm();
      refreshTaskViews();
      showIndicator(`${getTradeShowTitle(created)} added`, "success");
      openItemPane(ITEM_TYPE_TRADE_SHOW, created.id);
    }
  } catch (err) {
    setTradeShowFormMessage(err.message || "Could not save.", "error");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initTradeShowForm() {
  fillTradeShowPicker();

  document.getElementById("addTradeShowBtn")?.addEventListener("click", () => openTradeShowForm());
  document.getElementById("tradeShowFormSaveBtn")?.addEventListener("click", saveTradeShowForm);
  document.getElementById("tradeShowFormCancelBtn")?.addEventListener("click", closeTradeShowForm);
  document.getElementById("tradeShowFormCloseBtn")?.addEventListener("click", closeTradeShowForm);

  const start = document.getElementById("tradeShowFormStart");
  const end = document.getElementById("tradeShowFormEnd");

  start?.addEventListener("change", () => {
    // Most shows are a few days long, so the end date starts from the start
    // date rather than from today — and follows it if it was left behind.
    if (end && start.value && (!end.value || end.value < start.value)) end.value = start.value;
    if (end) end.min = start.value;
    clearTradeShowFormErrors();
  });
  end?.addEventListener("change", clearTradeShowFormErrors);

  // Enter saves from either date field.
  document.getElementById("tradeShowForm")?.addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON" || e.target.tagName === "TEXTAREA") return;
    e.preventDefault();
    saveTradeShowForm();
  });

  const overlay = document.getElementById("tradeShowFormOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closeTradeShowForm();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && isTradeShowFormOpen()) closeTradeShowForm();
  });
}
