/**
 * Create / edit photoshoot modal.
 *
 * Date (required), studio or editorial, model, an optional name, notes — and
 * the styles in it: the ones ticked on Need to Shoot when creating, any of
 * which can be dropped before saving.
 */

let photoshootFormId = null;
/** The styles the form will save, [{ styleNo, color }]. */
let photoshootFormStyles = [];

function fillPhotoshootTypePicker() {
  const row = document.getElementById("shootFormType");
  if (!row || row.children.length) return;
  row.replaceChildren(...PHOTOSHOOT_TYPES.map(type => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "form-toggle-btn";
    btn.dataset.value = type.key;
    btn.textContent = type.label;
    btn.addEventListener("click", () => setPhotoshootTypeValue(type.key));
    return btn;
  }));
}

function setPhotoshootTypeValue(value) {
  document.querySelectorAll("#shootFormType .form-toggle-btn").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.value === value);
    btn.setAttribute("aria-pressed", btn.dataset.value === value ? "true" : "false");
  });
}

function getPhotoshootTypeValue() {
  return document.querySelector("#shootFormType .form-toggle-btn.is-active")?.dataset.value ?? PHOTOSHOOT_TYPE_KEYS[0];
}

/** Models used before, as suggestions. */
function fillModelSuggestions() {
  const list = document.getElementById("shootModelList");
  if (!list) return;
  const models = [...new Set(getAllPhotoshoots().map(s => s.model).filter(Boolean))].sort();
  list.replaceChildren(...models.map(m => new Option(m)));
}

function renderPhotoshootFormStyles() {
  const wrap = document.getElementById("shootFormStyles");
  const label = document.getElementById("shootFormStylesLabel");
  if (label) label.textContent = `Styles (${photoshootFormStyles.length})`;
  if (!wrap) return;
  if (photoshootFormStyles.length === 0) {
    wrap.replaceChildren(Object.assign(document.createElement("span"), {
      className: "form-hint",
      textContent: "No styles yet — tick styles on Need to Shoot to add them, now or later.",
    }));
    return;
  }
  wrap.replaceChildren(...photoshootFormStyles.map(s => {
    const chip = document.createElement("span");
    chip.className = "shoot-form-chip";
    chip.append(createStyleThumb(s.styleNo, s.color, "shoot-mini-thumb"), document.createTextNode(`${s.styleNo} · ${s.color}`));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "shoot-form-chip-remove";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", `Remove ${s.styleNo} ${s.color}`);
    remove.addEventListener("click", () => {
      photoshootFormStyles = photoshootFormStyles.filter(x => x !== s);
      renderPhotoshootFormStyles();
    });
    chip.appendChild(remove);
    return chip;
  }));
}

function setPhotoshootFormMessage(text, type = "") {
  const el = document.getElementById("shootFormMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (type ? ` ${type}` : "");
}

/** Pass an id to edit; otherwise `styles` start the new shoot. */
function openPhotoshootForm(id = null, styles = []) {
  const overlay = document.getElementById("shootFormOverlay");
  if (!overlay) return;
  const shoot = id ? getPhotoshootById(id) : null;
  photoshootFormId = shoot?.id ?? null;
  photoshootFormStyles = (shoot?.styles ?? styles).map(s => ({ styleNo: s.styleNo, color: s.color }));

  fillPhotoshootTypePicker();
  fillModelSuggestions();
  document.getElementById("shootFormTitle").textContent = shoot ? "Edit photoshoot" : "Create photoshoot";
  document.getElementById("shootFormSaveBtn").textContent = shoot ? "Save" : "Create shoot";
  document.getElementById("shootFormDate").value = shoot?.date ?? "";
  setPhotoshootTypeValue(shoot?.type ?? PHOTOSHOOT_TYPE_KEYS[0]);
  document.getElementById("shootFormModel").value = shoot?.model ?? "";
  document.getElementById("shootFormName").value = shoot?.name ?? "";
  document.getElementById("shootFormNotes").value = shoot?.notes ?? "";
  document.getElementById("shootFormDate").classList.remove("is-invalid");
  renderPhotoshootFormStyles();
  setPhotoshootFormMessage("");
  overlay.classList.add("open");
  requestAnimationFrame(() => document.getElementById("shootFormDate")?.focus());
}

function closePhotoshootForm() {
  document.getElementById("shootFormOverlay")?.classList.remove("open");
  photoshootFormId = null;
  photoshootFormStyles = [];
}

async function savePhotoshootForm() {
  const fields = {
    date: document.getElementById("shootFormDate").value,
    type: getPhotoshootTypeValue(),
    model: document.getElementById("shootFormModel").value.trim(),
    name: document.getElementById("shootFormName").value.trim(),
    notes: document.getElementById("shootFormNotes").value,
    styles: photoshootFormStyles,
  };
  if (!fields.date) {
    document.getElementById("shootFormDate").classList.add("is-invalid");
    setPhotoshootFormMessage("Pick a shoot date — a tentative one is fine.", "error");
    return;
  }
  const btn = document.getElementById("shootFormSaveBtn");
  btn.disabled = true;
  setPhotoshootFormMessage("Saving…");
  try {
    if (photoshootFormId) {
      const updated = await updatePhotoshoot(photoshootFormId, fields);
      closePhotoshootForm();
      refreshPhotoshootViews();
      showIndicator(`${getPhotoshootTitle(updated)} updated`, "success");
    } else {
      const created = await createPhotoshoot(fields);
      closePhotoshootForm();
      needSelectedKeys = new Set();
      photoshootSubview = "shoots";
      shootFilter = "planned";
      refreshPhotoshootViews();
      openShootPane(created.id);
      showIndicator(`${getPhotoshootTitle(created)} created with ${created.styles.length} ${created.styles.length === 1 ? "style" : "styles"}`, "success");
    }
  } catch (err) {
    setPhotoshootFormMessage(err.message || "Couldn't save.", "error");
  } finally {
    btn.disabled = false;
  }
}

function initPhotoshootForm() {
  document.getElementById("shootFormSaveBtn")?.addEventListener("click", savePhotoshootForm);
  document.getElementById("shootFormCancelBtn")?.addEventListener("click", closePhotoshootForm);
  document.getElementById("shootFormCloseBtn")?.addEventListener("click", closePhotoshootForm);
  document.getElementById("shootFormDate")?.addEventListener("change", e => e.target.classList.remove("is-invalid"));
  document.getElementById("shootForm")?.addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON" || e.target.tagName === "TEXTAREA") return;
    e.preventDefault();
    savePhotoshootForm();
  });
  const overlay = document.getElementById("shootFormOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closePhotoshootForm();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay?.classList.contains("open")) closePhotoshootForm();
  });
}
