/**
 * Bookkeeping — monthly close tracking.
 *
 * Deliberately outside the task calendar. Payroll and sales tax have real
 * deadlines derived from schedules and states; bookkeeping is a two-step
 * close you work through per month, with no due date to place on a grid. So
 * these tasks live only in the company's Bookkeeping section and in the
 * practice-wide year view, never on the calendar or in the task rails.
 *
 * Each month is two parts, in order:
 *   Statement    — the month's statements are in hand
 *   Bookkeeping  — the books for that month are done
 *
 * You can't close the books on a month whose statements haven't arrived, so
 * the second is locked until the first is ticked — the same rule the payroll
 * paystub → deposit pair uses.
 *
 * Accounts are a documented list of what gets reconciled, in the same spirit
 * as employees under a payroll group: they say what the work covers without
 * each one becoming its own task.
 */

const BOOKKEEPING_STEPS = [
  { key: "statement", label: "Statement" },
  { key: "books", label: "Bookkeeping" },
];

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `co-1|2026-03|bk-statement` — same flat id space as every other task. */
function buildBookkeepingTaskId(companyId, year, monthIndex, step) {
  const month = String(monthIndex + 1).padStart(2, "0");
  return `${companyId}|${year}-${month}|bk-${step}`;
}

function isBookkeepingStepComplete(companyId, year, monthIndex, step) {
  return isTaskComplete(buildBookkeepingTaskId(companyId, year, monthIndex, step));
}

/** "none" | "statement" | "complete" — how far a month has got. */
function getBookkeepingMonthStatus(companyId, year, monthIndex) {
  const statement = isBookkeepingStepComplete(companyId, year, monthIndex, "statement");
  const books = isBookkeepingStepComplete(companyId, year, monthIndex, "books");
  if (statement && books) return "complete";
  if (statement) return "statement";
  return "none";
}

function countBookkeepingMonthsComplete(companyId, year) {
  let n = 0;
  for (let m = 0; m < 12; m++) {
    if (getBookkeepingMonthStatus(companyId, year, m) === "complete") n += 1;
  }
  return n;
}

/** Companies that actually buy bookkeeping, by name. */
function getBookkeepingCompanies() {
  return getAllCompanies()
    .filter(company => company.services?.bookkeeping)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Ticking a step. Statements can always be toggled; the books step is
 * refused while the statements for that month are still outstanding.
 */
async function setBookkeepingStep(companyId, year, monthIndex, step, complete) {
  if (complete && step === "books" &&
      !isBookkeepingStepComplete(companyId, year, monthIndex, "statement")) {
    throw new Error("Check off the statements for this month first.");
  }

  const id = buildBookkeepingTaskId(companyId, year, monthIndex, step);
  await setTaskComplete(id, complete);

  // Reopening the statements takes the books with them — closed books resting
  // on statements you no longer have is the state to avoid.
  if (!complete && step === "statement" &&
      isBookkeepingStepComplete(companyId, year, monthIndex, "books")) {
    await setTaskComplete(buildBookkeepingTaskId(companyId, year, monthIndex, "books"), false);
  }
}

// ── Company detail section ───────────────────────────────────────────────────

/** Which year the company's Bookkeeping section is showing. */
let bookkeepingSectionYear = new Date().getFullYear();

function createBookkeepingAccountList(company) {
  const wrap = document.createElement("div");
  wrap.className = "payroll-employees bk-accounts";

  const head = document.createElement("div");
  head.className = "payroll-employees-head";
  const title = document.createElement("span");
  title.className = "payroll-employees-title";
  title.textContent = `Accounts (${company.bookkeepingAccounts.length})`;
  head.appendChild(title);
  wrap.appendChild(head);

  if (company.bookkeepingAccounts.length > 0) {
    const list = document.createElement("ul");
    list.className = "payroll-employee-list";
    company.bookkeepingAccounts.forEach(account => {
      const item = document.createElement("li");
      item.className = "payroll-employee";

      const name = document.createElement("span");
      name.className = "payroll-employee-name";
      name.textContent = account.name;

      const type = document.createElement("span");
      type.className = "bk-account-type";
      type.dataset.type = account.type;
      type.textContent = account.type;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "payroll-employee-remove";
      remove.title = `Remove ${account.name}`;
      remove.setAttribute("aria-label", `Remove ${account.name}`);
      remove.textContent = "✕";
      remove.addEventListener("click", async () => {
        if (!confirm(`Remove ${account.name}?`)) return;
        try {
          await removeBookkeepingAccount(company.id, account.id);
          renderBookkeepingSection(getCompanyById(company.id));
          showIndicator(`${account.name} removed`, "success");
        } catch (err) {
          showIndicator(err.message || "Could not remove account.", "error");
        }
      });

      const actions = document.createElement("div");
      actions.className = "payroll-employee-actions";
      actions.append(type, remove);
      item.append(name, actions);
      list.appendChild(item);
    });
    wrap.appendChild(list);
  }

  wrap.appendChild(createAddBookkeepingAccountRow(company));
  return wrap;
}

function createAddBookkeepingAccountRow(company) {
  const row = document.createElement("div");
  row.className = "payroll-add-employee bk-add-account";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-input";
  input.placeholder = "Add account…";
  input.autocomplete = "off";

  const select = document.createElement("select");
  select.className = "form-input bk-account-type-select";
  select.setAttribute("aria-label", "Account type");
  BOOKKEEPING_ACCOUNT_TYPES.forEach(type => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    select.appendChild(option);
  });

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary";
  btn.textContent = "Add";

  const submit = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      await addBookkeepingAccount(company.id, name, select.value);
      renderBookkeepingSection(getCompanyById(company.id));
      showIndicator(`${name} added`, "success");
      document.querySelector(".bk-add-account input")?.focus();
    } catch (err) {
      showIndicator(err.message || "Could not add account.", "error");
    }
  };

  btn.addEventListener("click", submit);
  input.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submit();
  });

  row.append(input, select, btn);
  return row;
}

/** One card per month: the two steps, in order. Shared by the company
 *  section and the practice-wide view, so the year and the refresh both come
 *  from the caller. */
function createBookkeepingMonthCard(company, monthIndex, year, onChange) {
  const status = getBookkeepingMonthStatus(company.id, year, monthIndex);
  const card = document.createElement("div");
  card.className = "payroll-run bk-month" + (status === "complete" ? " is-complete" : "");
  card.dataset.status = status;

  const head = document.createElement("div");
  head.className = "payroll-run-head";

  const name = document.createElement("span");
  name.className = "payroll-run-date bk-month-name";
  name.textContent = `${MONTH_SHORT[monthIndex]} ${year}`;

  const meta = document.createElement("div");
  meta.className = "payroll-run-meta";
  if (status === "complete") {
    const badge = document.createElement("span");
    badge.className = "payroll-run-complete-badge";
    badge.textContent = "Done";
    meta.appendChild(badge);
  }

  head.append(name, meta);
  card.appendChild(head);

  const steps = document.createElement("div");
  steps.className = "payroll-run-tasks bk-steps";

  BOOKKEEPING_STEPS.forEach(step => {
    const done = isBookkeepingStepComplete(company.id, year, monthIndex, step.key);
    // Books wait on statements; statements are always available.
    const locked = step.key === "books" &&
      !isBookkeepingStepComplete(company.id, year, monthIndex, "statement");

    const label = document.createElement("label");
    label.className = "payroll-task bk-step"
      + (done ? " is-done" : "")
      + (locked ? " is-locked" : "");
    label.dataset.step = step.key;
    if (locked) label.title = "Check off the statements for this month first.";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = done;
    cb.disabled = locked;

    const box = document.createElement("span");
    box.className = "payroll-task-box";
    box.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.className = "payroll-task-text";
    const stepName = document.createElement("span");
    stepName.className = "payroll-task-name bk-step-name";
    stepName.textContent = step.label;
    text.appendChild(stepName);

    cb.addEventListener("change", async () => {
      const next = cb.checked;
      try {
        await setBookkeepingStep(company.id, year, monthIndex, step.key, next);
      } catch (err) {
        cb.checked = !next;
        showIndicator(err.message || "Could not update.", "error");
        return;
      }
      onChange();
    });

    label.append(cb, box, text);
    steps.appendChild(label);
  });

  card.appendChild(steps);
  return card;
}

function stepBookkeepingSectionYear(delta) {
  bookkeepingSectionYear += delta;
  if (currentCompanyId) renderBookkeepingSection(getCompanyById(currentCompanyId));
}

/** Called by company-detail.js when the Bookkeeping tab is active. */
function renderBookkeepingSection(company) {
  const panel = document.getElementById("companySectionPanel");
  if (!panel || !company) return;

  const wrap = document.createElement("div");
  wrap.className = "payroll-section bk-section";

  wrap.appendChild(createBookkeepingAccountList(company));

  const header = document.createElement("div");
  header.className = "bk-year-header";

  const title = document.createElement("div");
  title.className = "company-section-title";
  title.textContent = "Monthly close";

  const nav = document.createElement("div");
  nav.className = "bk-year-nav";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "btn btn-page";
  prev.textContent = "‹";
  prev.setAttribute("aria-label", "Previous year");
  prev.addEventListener("click", () => stepBookkeepingSectionYear(-1));

  const yearLabel = document.createElement("span");
  yearLabel.className = "bk-year-label";
  yearLabel.textContent = String(bookkeepingSectionYear);

  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn btn-page";
  next.textContent = "›";
  next.setAttribute("aria-label", "Next year");
  next.addEventListener("click", () => stepBookkeepingSectionYear(1));

  const done = document.createElement("span");
  done.className = "bk-year-count";
  done.textContent = `${countBookkeepingMonthsComplete(company.id, bookkeepingSectionYear)} / 12 closed`;

  nav.append(prev, yearLabel, next, done);
  header.append(title, nav);
  wrap.appendChild(header);

  const months = document.createElement("div");
  months.className = "bk-months";
  for (let m = 0; m < 12; m++) {
    months.appendChild(createBookkeepingMonthCard(
      company, m, bookkeepingSectionYear,
      () => renderBookkeepingSection(getCompanyById(company.id))));
  }
  wrap.appendChild(months);

  panel.replaceChildren(wrap);
}

// ── Practice-wide year view ──────────────────────────────────────────────────

let bookkeepingViewYear = new Date().getFullYear();

/** The client whose months are open in the side panel, or "" for none. */
let bookkeepingSelectedCompanyId = "";

function stepBookkeepingViewYear(delta) {
  bookkeepingViewYear += delta;
  renderBookkeepingView();
}

function selectBookkeepingCompany(companyId) {
  // Clicking the open client again closes the panel.
  bookkeepingSelectedCompanyId =
    bookkeepingSelectedCompanyId === companyId ? "" : companyId;
  renderBookkeepingView();
}

/**
 * The selected client's twelve months, beside the grid — the same cards the
 * company's own Bookkeeping section uses, so ticking here and ticking there
 * are the same gesture.
 */
function renderBookkeepingTasksPanel() {
  const title = document.getElementById("bkTasksTitle");
  const count = document.getElementById("bkTasksCount");
  const body = document.getElementById("bkTasksBody");
  if (!body) return;

  const company = bookkeepingSelectedCompanyId
    ? getCompanyById(bookkeepingSelectedCompanyId)
    : null;

  if (!company) {
    if (title) title.textContent = "Monthly close";
    if (count) count.textContent = "";
    const empty = document.createElement("div");
    empty.className = "dash-empty";
    empty.textContent = "Pick a client to work through their months.";
    body.replaceChildren(empty);
    return;
  }

  if (title) title.textContent = company.name;
  if (count) {
    count.textContent = `${countBookkeepingMonthsComplete(company.id, bookkeepingViewYear)}/12`;
  }

  const months = document.createElement("div");
  months.className = "bk-panel-months";
  for (let m = 0; m < 12; m++) {
    months.appendChild(createBookkeepingMonthCard(
      company, m, bookkeepingViewYear,
      // A tick has to repaint the grid cell behind it as well as this card.
      () => renderBookkeepingView()));
  }
  body.replaceChildren(months);
}

/**
 * Every bookkeeping client as a row, Jan–Dec as columns. Each cell is the
 * month's status at a glance; picking a row opens that client's months in
 * the panel beside it.
 */
function renderBookkeepingView() {
  const yearEl = document.getElementById("bookkeepingYear");
  if (yearEl) yearEl.textContent = String(bookkeepingViewYear);

  const body = document.getElementById("bookkeepingGrid");
  if (!body) return;

  const companies = getBookkeepingCompanies();

  // A client whose service was switched off shouldn't stay selected.
  if (bookkeepingSelectedCompanyId &&
      !companies.some(c => c.id === bookkeepingSelectedCompanyId)) {
    bookkeepingSelectedCompanyId = "";
  }

  const countEl = document.getElementById("bookkeepingCount");
  if (countEl) {
    countEl.textContent = companies.length
      ? `${companies.length} ${companies.length === 1 ? "client" : "clients"}`
      : "";
  }

  if (companies.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dash-empty";
    empty.textContent = "No clients have Bookkeeping switched on yet.";
    body.replaceChildren(empty);
    renderBookkeepingTasksPanel();
    return;
  }

  const table = document.createElement("table");
  table.className = "bk-grid";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "bk-grid-company-head";
  corner.textContent = "Client";
  headRow.appendChild(corner);

  const thisMonth = new Date().getMonth();
  const thisYear = new Date().getFullYear();
  MONTH_SHORT.forEach((label, i) => {
    const th = document.createElement("th");
    th.textContent = label;
    if (bookkeepingViewYear === thisYear && i === thisMonth) th.classList.add("is-current");
    headRow.appendChild(th);
  });
  const totalHead = document.createElement("th");
  totalHead.className = "bk-grid-total-head";
  totalHead.textContent = "Closed";
  headRow.appendChild(totalHead);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  companies.forEach(company => {
    const selected = company.id === bookkeepingSelectedCompanyId;
    const tr = document.createElement("tr");
    tr.className = "bk-grid-row" + (selected ? " is-selected" : "");
    tr.dataset.companyId = company.id;
    tr.addEventListener("click", () => selectBookkeepingCompany(company.id));

    const nameCell = document.createElement("th");
    nameCell.className = "bk-grid-company";
    const nameInner = document.createElement("div");
    nameInner.className = "bk-grid-company-inner";
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "bk-grid-company-btn";
    nameBtn.textContent = company.name;
    nameBtn.setAttribute("aria-pressed", selected ? "true" : "false");
    nameInner.appendChild(nameBtn);

    // Opening the full company page is still one click away, just not the
    // one that selects — selecting is what this grid is for.
    const open = document.createElement("button");
    open.type = "button";
    open.className = "bk-grid-open-btn";
    open.title = `Open ${company.name}`;
    open.setAttribute("aria-label", `Open ${company.name}`);
    open.textContent = "↗";
    open.addEventListener("click", e => {
      e.stopPropagation();
      openCompanyDetail(company.id);
    });
    nameInner.appendChild(open);
    nameCell.appendChild(nameInner);
    tr.appendChild(nameCell);

    for (let m = 0; m < 12; m++) {
      const status = getBookkeepingMonthStatus(company.id, bookkeepingViewYear, m);
      const td = document.createElement("td");
      td.className = "bk-grid-cell";
      td.dataset.status = status;
      td.title = `${company.name} · ${MONTH_SHORT[m]} ${bookkeepingViewYear} · ${
        status === "complete" ? "Closed" : status === "statement" ? "Statements in" : "Not started"}`;

      const dot = document.createElement("span");
      dot.className = "bk-cell-mark";
      td.appendChild(dot);
      tr.appendChild(td);
    }

    const total = document.createElement("td");
    total.className = "bk-grid-total";
    total.textContent = `${countBookkeepingMonthsComplete(company.id, bookkeepingViewYear)}/12`;
    tr.appendChild(total);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.replaceChildren(table);

  renderBookkeepingTasksPanel();
}

function initBookkeepingView() {
  document.getElementById("bookkeepingPrevYear")?.addEventListener("click", () => stepBookkeepingViewYear(-1));
  document.getElementById("bookkeepingNextYear")?.addEventListener("click", () => stepBookkeepingViewYear(1));
}
