/**
 * Add / edit company modal.
 *
 * One form serves both: `openCompanyForm()` with no id creates, with an id
 * edits. Saving returns to whichever view the form was opened from.
 */

let companyFormMode = "create";
let companyFormCompanyId = null;

// ── Owner combobox ───────────────────────────────────────────────────────────

/**
 * Owner is a searchable combobox rather than a select: type to filter the
 * owners on file, or type a name nobody has yet and it becomes a new owner
 * when the company is saved. Saving resolves the typed text, so the id is
 * looked up (or created) at save time rather than tracked while typing.
 */
let ownerComboActiveIndex = -1;
let ownerComboMatches = [];

function getOwnerComboInput() {
  return document.getElementById("companyFormOwner");
}

function getOwnerComboQuery() {
  return (getOwnerComboInput()?.value ?? "").trim();
}

/** Owners whose name contains the query; everything when the box is empty. */
function findOwnerMatches(query) {
  const needle = query.toLowerCase();
  const owners = [...getAllOwners()].sort((a, b) => a.name.localeCompare(b.name));
  if (!needle) return owners;
  return owners.filter(owner => owner.name.toLowerCase().includes(needle));
}

function updateOwnerComboHint() {
  const hint = document.getElementById("companyFormOwnerHint");
  if (!hint) return;
  const query = getOwnerComboQuery();
  const isNew = query && !findOwnerByName(query);
  hint.textContent = isNew ? `“${query}” is new — it will be added as an owner.` : "";
  hint.classList.toggle("is-visible", Boolean(isNew));
}

function closeOwnerComboList() {
  const list = document.getElementById("companyFormOwnerList");
  if (list) list.hidden = true;
  getOwnerComboInput()?.setAttribute("aria-expanded", "false");
  ownerComboActiveIndex = -1;
}

function applyOwnerComboActive() {
  const list = document.getElementById("companyFormOwnerList");
  if (!list) return;
  [...list.children].forEach((option, i) => {
    option.classList.toggle("is-active", i === ownerComboActiveIndex);
    option.setAttribute("aria-selected", i === ownerComboActiveIndex ? "true" : "false");
  });
}

function chooseOwnerComboOption(index) {
  const option = ownerComboMatches[index];
  if (!option) return;
  const input = getOwnerComboInput();
  if (input) input.value = option.name;
  closeOwnerComboList();
  updateOwnerComboHint();
}

/**
 * The list is the matching owners, plus a "create" row whenever the typed name
 * isn't one of them — so adding an owner is the same gesture as picking one.
 */
function renderOwnerComboList() {
  const list = document.getElementById("companyFormOwnerList");
  const input = getOwnerComboInput();
  if (!list || !input) return;

  const query = getOwnerComboQuery();
  const owners = findOwnerMatches(query);
  ownerComboMatches = owners.map(owner => ({ name: owner.name, isNew: false }));
  if (query && !findOwnerByName(query)) {
    ownerComboMatches.push({ name: query, isNew: true });
  }

  if (ownerComboMatches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "combo-empty";
    empty.textContent = "No owners on file yet.";
    list.replaceChildren(empty);
  } else {
    list.replaceChildren(...ownerComboMatches.map((match, i) => {
      const option = document.createElement("div");
      option.className = "combo-option" + (match.isNew ? " combo-option--new" : "");
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");

      const label = document.createElement("span");
      label.className = "combo-option-label";
      label.textContent = match.isNew ? `Add “${match.name}”` : match.name;
      option.appendChild(label);

      if (match.isNew) {
        const tag = document.createElement("span");
        tag.className = "combo-option-tag";
        tag.textContent = "New";
        option.appendChild(tag);
      }

      // mousedown, not click — blur would close the list first.
      option.addEventListener("mousedown", e => {
        e.preventDefault();
        chooseOwnerComboOption(i);
      });
      option.addEventListener("mouseenter", () => {
        ownerComboActiveIndex = i;
        applyOwnerComboActive();
      });
      return option;
    }));
  }

  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  ownerComboActiveIndex = ownerComboMatches.length ? 0 : -1;
  applyOwnerComboActive();
}

function initOwnerCombo() {
  const input = getOwnerComboInput();
  const list = document.getElementById("companyFormOwnerList");
  if (!input || !list) return;

  input.addEventListener("focus", renderOwnerComboList);
  input.addEventListener("input", () => {
    renderOwnerComboList();
    updateOwnerComboHint();
  });
  input.addEventListener("blur", () => {
    closeOwnerComboList();
    updateOwnerComboHint();
  });

  // Enter picks the highlighted option instead of submitting the form, but
  // only while the list is open.
  input.addEventListener("keydown", e => {
    const open = !list.hidden;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        renderOwnerComboList();
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      const count = ownerComboMatches.length;
      if (!count) return;
      ownerComboActiveIndex = (ownerComboActiveIndex + step + count) % count;
      applyOwnerComboActive();
      return;
    }
    if (e.key === "Enter" && open && ownerComboActiveIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      chooseOwnerComboOption(ownerComboActiveIndex);
      return;
    }
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      closeOwnerComboList();
    }
  });
}

/** Blank, an existing owner, or a brand-new one created on the spot. */
async function resolveOwnerIdFromCombo() {
  const query = getOwnerComboQuery();
  if (!query) return "";
  const existing = findOwnerByName(query);
  if (existing) return existing.id;
  const created = await createOwner({ name: query });
  return created.id;
}

function setOwnerComboFromCompany(company) {
  const input = getOwnerComboInput();
  if (input) input.value = getOwnerById(company?.ownerId)?.name ?? "";
  closeOwnerComboList();
  updateOwnerComboHint();
}

// ── Field builders ───────────────────────────────────────────────────────────

/** Payroll runs several schedules at once, so these are real checkboxes. */
function fillPayrollCheckboxes() {
  const row = document.getElementById("companyFormPayroll");
  if (!row) return;

  row.replaceChildren(...PAYROLL_SCHEDULES.map(schedule => {
    const label = document.createElement("label");
    label.className = "form-check";
    label.dataset.schedule = schedule;
    label.dataset.group = "payroll";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = schedule;
    input.name = "payrollSchedule";

    const box = document.createElement("span");
    box.className = "form-check-box";
    box.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.textContent = schedule;

    label.append(input, box, text);
    return label;
  }));
}

function getSelectedPayrollSchedules() {
  return [...document.querySelectorAll('#companyFormPayroll input[name="payrollSchedule"]:checked')]
    .map(input => input.value);
}

/**
 * State is its own field rather than part of the location text because the
 * sales tax due date is derived from it — see js/sales-tax.js.
 */
function fillStateSelect() {
  const select = document.getElementById("companyFormState");
  if (!select) return;

  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "— State —";

  select.replaceChildren(blank, ...STATES.map(state => {
    const option = document.createElement("option");
    option.value = state.code;
    option.textContent = state.code;
    option.title = state.name;
    return option;
  }));
}

/** Spell out the due-date rule the chosen state implies. */
function updateStateHint() {
  const hint = document.getElementById("companyFormStateHint");
  if (!hint) return;
  const meta = getStateMeta(document.getElementById("companyFormState")?.value);
  hint.textContent = meta
    ? `${meta.name} — sales tax due the ${meta.salesTaxDueDay}th of the month after each period.`
    : "";
}

/**
 * Single-choice settings render as a small button group rather than a select —
 * there are only two or three options and they read better laid out.
 * Clicking the active button clears it.
 */
function fillToggleButtons(containerId, options, ariaLabel, group = "") {
  const row = document.getElementById(containerId);
  if (!row) return;
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", ariaLabel);

  row.replaceChildren(...options.map(value => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "form-toggle-btn";
    btn.dataset.value = value;
    // Colour comes from the schedule/group pair — "Monthly" is a payroll
    // cadence in one row and a sales tax one in another.
    if (group) {
      btn.dataset.group = group;
      btn.dataset.schedule = value;
    }
    btn.textContent = value;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      const wasActive = btn.classList.contains("is-active");
      row.querySelectorAll(".form-toggle-btn").forEach(other => {
        other.classList.remove("is-active");
        other.setAttribute("aria-pressed", "false");
      });
      if (!wasActive) {
        btn.classList.add("is-active");
        btn.setAttribute("aria-pressed", "true");
      }
    });
    return btn;
  }));
}

function setToggleButtonValue(containerId, value) {
  document.querySelectorAll(`#${containerId} .form-toggle-btn`).forEach(btn => {
    const active = btn.dataset.value === value;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function getToggleButtonValue(containerId) {
  return document.querySelector(`#${containerId} .form-toggle-btn.is-active`)?.dataset.value ?? "";
}

/** The services with no settings of their own — just on or off. */
const PLAIN_SERVICE_KEYS = SERVICE_KEYS.filter(key => key !== "payroll" && key !== "salesTax");

function fillServiceSwitches() {
  const grid = document.getElementById("companyFormServices");
  if (!grid) return;

  grid.replaceChildren(...PLAIN_SERVICE_KEYS.map(key => {
    const row = document.createElement("div");
    row.className = "form-service";
    row.dataset.service = key;

    const name = document.createElement("span");
    name.className = "form-service-name";
    name.textContent = getServiceLabel(key);

    const label = document.createElement("label");
    label.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "service";
    input.value = key;
    input.setAttribute("aria-label", getServiceLabel(key));
    const track = document.createElement("span");
    track.className = "switch-track";
    const thumb = document.createElement("span");
    thumb.className = "switch-thumb";
    label.append(input, track, thumb);

    input.addEventListener("change", () => row.classList.toggle("is-on", input.checked));

    row.append(name, label);
    return row;
  }));
}

function getSelectedServices() {
  const services = {};
  SERVICE_KEYS.forEach(key => { services[key] = false; });
  document.querySelectorAll('#companyForm input[name="service"]:checked')
    .forEach(input => { services[input.value] = true; });
  return services;
}

/**
 * A service's settings are meaningless when the client hasn't bought it, so
 * switching the service off disables everything nested under it. The values
 * are kept, so switching it back on restores what was there.
 */
function syncServiceBlockState(serviceKey) {
  const block = document.querySelector(`.service-block[data-service="${serviceKey}"]`);
  const toggle = document.querySelector(`#companyForm input[name="service"][value="${serviceKey}"]`);
  const body = document.querySelector(`.service-block-body[data-body-for="${serviceKey}"]`);
  if (!block || !toggle || !body) return;

  const on = toggle.checked;
  block.classList.toggle("is-on", on);
  body.classList.toggle("is-disabled", !on);
  body.querySelectorAll("input, button").forEach(el => { el.disabled = !on; });
}

function syncAllServiceBlockStates() {
  ["payroll", "salesTax"].forEach(syncServiceBlockState);
}

// ── Open / close ─────────────────────────────────────────────────────────────

function setCompanyFormMessage(text, type = "") {
  const el = document.getElementById("companyFormMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (type ? ` ${type}` : "");
}

function clearCompanyFormErrors() {
  document.getElementById("companyFormName")?.classList.remove("is-invalid");
  const err = document.getElementById("companyFormNameError");
  if (err) err.hidden = true;
  document.querySelectorAll("#companyForm .service-block-row.is-invalid")
    .forEach(row => row.classList.remove("is-invalid"));
  setCompanyFormMessage("");
}

/**
 * A service that's switched on but left unconfigured generates no tasks and
 * shows blank columns — it looks broken rather than incomplete. So switching
 * one on makes its schedule fields required.
 *
 * Each entry: the settings row to flag, whether it currently holds a value,
 * and what to say when it doesn't.
 */
function getCompanyFormRequirements() {
  const services = getSelectedServices();
  return [
    {
      when: services.payroll,
      containerId: "companyFormPayroll",
      filled: getSelectedPayrollSchedules().length > 0,
      message: "Pick at least one payroll schedule, or switch Payroll off.",
    },
    {
      when: services.payroll,
      containerId: "companyFormPayrollTax",
      filled: Boolean(getToggleButtonValue("companyFormPayrollTax")),
      message: "Pick a payroll tax schedule, or switch Payroll off.",
    },
    {
      when: services.salesTax,
      containerId: "companyFormSalesTax",
      filled: Boolean(getToggleButtonValue("companyFormSalesTax")),
      message: "Pick a sales tax schedule, or switch Sales Tax off.",
    },
  ];
}

/**
 * Re-run validation only once the user has already been shown an error —
 * flagging fields they haven't reached yet would be nagging, not helping.
 */
function revalidateIfShowingErrors() {
  if (!document.querySelector("#companyForm .service-block-row.is-invalid")) return;
  document.querySelectorAll("#companyForm .service-block-row.is-invalid")
    .forEach(row => row.classList.remove("is-invalid"));
  const message = validateCompanyForm({ scroll: false });
  setCompanyFormMessage(message, message ? "error" : "");
}

/**
 * Flags every unmet requirement; returns the first message, or "" if all
 * pass. Scrolls to the first problem on an attempted save, but not while
 * revalidating mid-edit — moving the form under the cursor is disorienting.
 */
function validateCompanyForm({ scroll = true } = {}) {
  const unmet = getCompanyFormRequirements().filter(req => req.when && !req.filled);

  unmet.forEach(req => {
    document.getElementById(req.containerId)?.closest(".service-block-row")?.classList.add("is-invalid");
  });

  if (unmet.length === 0) return "";
  if (scroll) {
    document.getElementById(unmet[0].containerId)
      ?.closest(".service-block-row")
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  return unmet[0].message;
}

/** Pass a companyId to edit; omit it to create. */
function openCompanyForm(companyId = null) {
  const overlay = document.getElementById("companyFormOverlay");
  if (!overlay) return;

  const company = companyId ? getCompanyById(companyId) : null;
  companyFormMode = company ? "edit" : "create";
  companyFormCompanyId = company?.id ?? null;

  fillPayrollCheckboxes();
  fillServiceSwitches();
  fillStateSelect();
  fillToggleButtons("companyFormPayrollTax", PAYROLL_TAX_SCHEDULES, "Payroll tax deposit schedule", "payrollTax");
  fillToggleButtons("companyFormSalesTax", SALES_TAX_SCHEDULES, "Sales tax filing schedule", "salesTax");

  const title = document.getElementById("companyFormTitle");
  if (title) title.textContent = company ? "Edit company details" : "Add company";

  const nameInput = document.getElementById("companyFormName");
  if (nameInput) nameInput.value = company?.name ?? "";
  const locationInput = document.getElementById("companyFormLocation");
  if (locationInput) locationInput.value = company?.location ?? "";
  const stateSelect = document.getElementById("companyFormState");
  if (stateSelect) stateSelect.value = company?.state ?? "";
  updateStateHint();
  setOwnerComboFromCompany(company);

  setToggleButtonValue("companyFormPayrollTax", company?.payrollTax ?? "");
  setToggleButtonValue("companyFormSalesTax", company?.salesTax ?? "");

  const selected = new Set(company?.payrollSchedules ?? []);
  document.querySelectorAll('#companyFormPayroll input[name="payrollSchedule"]').forEach(input => {
    input.checked = selected.has(input.value);
  });

  // New companies start with every service off, so what's on is always a
  // deliberate choice — and each one that's on has to be configured before
  // the form will save (see validateCompanyForm).
  document.querySelectorAll('#companyForm input[name="service"]').forEach(input => {
    input.checked = company ? company.services[input.value] === true : false;
    input.closest(".form-service")?.classList.toggle("is-on", input.checked);
  });
  syncAllServiceBlockStates();

  clearCompanyFormErrors();
  overlay.classList.add("open");
  requestAnimationFrame(() => nameInput?.focus());
}

function closeCompanyForm() {
  document.getElementById("companyFormOverlay")?.classList.remove("open");
  companyFormCompanyId = null;
}

function isCompanyFormOpen() {
  return document.getElementById("companyFormOverlay")?.classList.contains("open") === true;
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function saveCompanyForm() {
  const nameInput = document.getElementById("companyFormName");
  const name = (nameInput?.value ?? "").trim();

  clearCompanyFormErrors();

  if (!name) {
    nameInput?.classList.add("is-invalid");
    const err = document.getElementById("companyFormNameError");
    if (err) err.hidden = false;
    nameInput?.focus();
    return;
  }

  const invalidMessage = validateCompanyForm();
  if (invalidMessage) {
    setCompanyFormMessage(invalidMessage, "error");
    return;
  }

  let ownerId;
  try {
    ownerId = await resolveOwnerIdFromCombo();
  } catch (err) {
    setCompanyFormMessage(err.message || "Could not add that owner.", "error");
    return;
  }

  const fields = {
    name,
    ownerId,
    location: (document.getElementById("companyFormLocation")?.value ?? "").trim(),
    state: document.getElementById("companyFormState")?.value ?? "",
    payrollSchedules: getSelectedPayrollSchedules(),
    payrollTax: getToggleButtonValue("companyFormPayrollTax"),
    salesTax: getToggleButtonValue("companyFormSalesTax"),
    services: getSelectedServices(),
  };

  const saveBtn = document.getElementById("companyFormSaveBtn");
  if (saveBtn) saveBtn.disabled = true;
  setCompanyFormMessage("Saving…");

  try {
    if (companyFormMode === "edit") {
      const updated = await updateCompany(companyFormCompanyId, fields);
      closeCompanyForm();
      applyCompanyFilters();
      // Refresh the detail page in place so the edit is visible immediately.
      if (getCurrentAppView() === "company") openCompanyDetail(updated.id);
      showIndicator("Company updated", "success");
    } else {
      const created = await createCompany(fields);
      closeCompanyForm();
      applyCompanyFilters();
      showIndicator(`${created.name} added`, "success");
      openCompanyDetail(created.id);
    }
  } catch (err) {
    setCompanyFormMessage(err.message || "Could not save.", "error");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── Detail-page menu ─────────────────────────────────────────────────────────

function closeCompanyDetailMenu() {
  const menu = document.getElementById("companyDetailMenu");
  const btn = document.getElementById("companyDetailMenuBtn");
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function initCompanyDetailMenu() {
  const btn = document.getElementById("companyDetailMenuBtn");
  const menu = document.getElementById("companyDetailMenu");
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
    closeCompanyDetailMenu();
  });

  document.getElementById("companyMenuEdit")?.addEventListener("click", () => {
    closeCompanyDetailMenu();
    if (currentCompanyId) openCompanyForm(currentCompanyId);
  });

  document.getElementById("companyMenuDelete")?.addEventListener("click", async () => {
    closeCompanyDetailMenu();
    const company = getCompanyById(currentCompanyId);
    if (!company) return;
    if (!confirm(`Delete ${company.name}? This cannot be undone.`)) return;
    try {
      await deleteCompany(company.id);
      closeCompanyDetail();
      applyCompanyFilters();
      showIndicator(`${company.name} deleted`, "success");
    } catch (err) {
      showIndicator(err.message || "Could not delete company.", "error");
    }
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initCompanyForm() {
  initCompanyDetailMenu();
  initOwnerCombo();

  document.getElementById("addCompanyBtn")?.addEventListener("click", () => openCompanyForm());
  document.getElementById("companyFormSaveBtn")?.addEventListener("click", saveCompanyForm);
  document.getElementById("companyFormCancelBtn")?.addEventListener("click", closeCompanyForm);
  document.getElementById("companyFormCloseBtn")?.addEventListener("click", closeCompanyForm);

  document.getElementById("companyFormName")?.addEventListener("input", clearCompanyFormErrors);
  document.getElementById("companyFormState")?.addEventListener("change", updateStateHint);

  // Turning a service off greys out everything nested under it — and can
  // resolve a "configure this first" error, so re-check what's still unmet.
  document.querySelectorAll('.service-block input[name="service"]').forEach(toggle => {
    toggle.addEventListener("change", () => {
      syncServiceBlockState(toggle.value);
      revalidateIfShowingErrors();
    });
  });

  // Same for filling in the settings themselves: clear the flag the moment
  // the requirement is met rather than making them press Save to find out.
  document.getElementById("companyForm")?.addEventListener("change", revalidateIfShowingErrors);
  document.getElementById("companyForm")?.addEventListener("click", e => {
    if (e.target.closest(".form-toggle-btn")) revalidateIfShowingErrors();
  });

  // Enter submits from any single-line input; the form has no submit button.
  // Buttons and checkboxes keep their own Enter/Space behaviour.
  document.getElementById("companyForm")?.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "BUTTON") return;
    if (e.target.type === "checkbox") return;
    e.preventDefault();
    saveCompanyForm();
  });

  const overlay = document.getElementById("companyFormOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closeCompanyForm();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && isCompanyFormOpen()) closeCompanyForm();
  });
}
