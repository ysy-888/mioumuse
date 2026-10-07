/**
 * Sales tax — the filing calendar and the section that shows it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULES ENCODED HERE
 *
 * Filing periods, from the company's sales tax schedule
 *   Pre-Payment  every month
 *   Quarterly    every calendar quarter (Jan–Mar, Apr–Jun, …)
 *   Y6           every six months (Jan–Jun, Jul–Dec)
 *   Y12          the calendar year
 *
 * Payment due date, from the company's state
 *   CA  the 24th of the month after the period ends
 *   MN  the 20th of the month after the period ends
 *
 * So a CA company on Pre-Payment owes January's payment by February 24th, and
 * the same company on Quarterly owes Q1 by April 24th.
 *
 * Weekend handling matches payroll: a due date landing on a weekend does not
 * move, but the *task* is pulled back to the Friday before, so the work is
 * done ahead of the deadline rather than after it.
 *
 * Without a state there is no rule to apply, so no tasks are generated — the
 * section says so rather than failing silently.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TASK_KIND_SALES_TAX = "salesTax";

/** How far ahead the section's upcoming list looks. */
const SALES_TAX_UPCOMING_DAYS = 180;

/** How many months each schedule covers per filing. */
const SALES_TAX_PERIOD_MONTHS = {
  "Pre-Payment": 1,
  "Quarterly": 3,
  "Y6": 6,
  "Y12": 12,
};

// ── Period generation ────────────────────────────────────────────────────────

/**
 * The filing periods a schedule produces that are *due* within
 * [fromYmd, toYmd]. Periods are aligned to the start of the calendar year, so
 * quarters run Jan–Mar rather than from whenever the client signed up.
 */
function generateSalesTaxPeriods(schedule, fromYmd, toYmd) {
  const span = SALES_TAX_PERIOD_MONTHS[schedule];
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (!span || !from || !to || to < from) return [];

  // A period's payment is due the month after it ends, so scan a year either
  // side to catch periods whose due date lands inside the window.
  const periods = [];
  const cursor = new Date(from.getFullYear() - 1, 0, 1);
  const limit = new Date(to.getFullYear() + 1, 11, 31);

  while (cursor <= limit) {
    const startMonth = Math.floor(cursor.getMonth() / span) * span;
    const start = new Date(cursor.getFullYear(), startMonth, 1);
    const end = lastDayOfMonth(start.getFullYear(), startMonth + span - 1);
    periods.push({ start, end });
    cursor.setMonth(startMonth + span);
  }
  return periods;
}

/** Payment due date for a period end, from the state's day-of-month rule. */
function salesTaxDueDateFor(periodEnd, stateCode) {
  const dueDay = getStateMeta(stateCode)?.salesTaxDueDay;
  if (!dueDay) return null;
  return new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, dueDay);
}

/** Human label for a filing period, e.g. "Q1 2026", "Jan 2026", "2026". */
function describeSalesTaxPeriod(schedule, start, end) {
  const year = start.getFullYear();
  const month = start.toLocaleString(undefined, { month: "short" });

  switch (schedule) {
    case "Pre-Payment": return `${month} ${year}`;
    case "Quarterly":   return `Q${Math.floor(start.getMonth() / 3) + 1} ${year}`;
    case "Y6":          return `${start.getMonth() === 0 ? "H1" : "H2"} ${year}`;
    case "Y12":         return String(year);
    default:            return `${month} ${year}`;
  }
}

// ── Task generation ──────────────────────────────────────────────────────────

function buildSalesTaxTaskId(companyId, periodEndYmd) {
  return `${companyId}|${periodEndYmd}|${TASK_KIND_SALES_TAX}`;
}

/**
 * Every sales tax payment a company owes with a due date in
 * [fromYmd, toYmd]. Empty when the service is off, no schedule is set, or no
 * state is set — each of those leaves a rule missing.
 */
function buildSalesTaxTasks(company, fromYmd, toYmd) {
  const schedule = String(company?.salesTax ?? "").trim();
  const state = String(company?.state ?? "").trim();
  if (!company?.services?.salesTax || !schedule || !state) return [];

  return generateSalesTaxPeriods(schedule, fromYmd, toYmd)
    .map(({ start, end }) => {
      const dueDate = salesTaxDueDateFor(end, state);
      if (!dueDate) return null;

      const periodEndYmd = ymd(end);
      return {
        id: buildSalesTaxTaskId(company.id, periodEndYmd),
        companyId: company.id,
        companyName: company.name,
        kind: TASK_KIND_SALES_TAX,
        label: "Sales Tax Payment",
        schedule,
        state,
        periodStart: ymd(start),
        periodEnd: periodEndYmd,
        periodLabel: describeSalesTaxPeriod(schedule, start, end),
        date: ymd(dueDate),
        dueDate: ymd(taskDueDateFor(dueDate)),
        movedForWeekend: isWeekend(dueDate),
      };
    })
    .filter(task => task && task.dueDate >= fromYmd && task.dueDate <= toYmd)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** One-line description of what a sales tax task covers. */
function describeSalesTaxTask(task) {
  return `${task.periodLabel} · ${getStateName(task.state) || task.state} · due ${formatTaskDate(task.date)}`;
}

/** Sales tax tasks across every company, for the Home calendar. */
function buildAllSalesTaxTasks(fromYmd, toYmd) {
  return getAllCompanies()
    .flatMap(company => buildSalesTaxTasks(company, fromYmd, toYmd))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.companyName.localeCompare(b.companyName));
}

// ── Section rendering ────────────────────────────────────────────────────────

function salesTaxEmptyNode(text) {
  const empty = document.createElement("div");
  empty.className = "payroll-employees-empty";
  empty.textContent = text;
  return empty;
}

function createSalesTaxCard(company, task, { showCompany = false, onChange } = {}) {
  const done = isTaskComplete(task.id);
  const card = document.createElement("div");
  card.className = "payroll-run payroll-run--sales-tax" + (done ? " is-complete" : "");

  const pill = document.createElement("span");
  pill.className = "schedule-pill";
  pill.dataset.schedule = task.schedule;
  pill.dataset.group = "salesTax";
  pill.textContent = getScheduleAbbreviation(task.schedule);
  if (pill.textContent !== task.schedule) pill.title = task.schedule;

  // The period is the heading; the due date lives on the sub-task row below,
  // and the state is already on the company itself.
  card.appendChild(createCardHeader(company, {
    showCompany,
    heading: task.periodLabel,
    pill,
    complete: done,
  }));

  const onToggle = onChange ?? (() => {
    if (getCurrentAppView() === "company" && currentSectionKey === "salesTax") {
      // Via the panel renderer so the inactive banner is re-applied with it.
      renderCompanySectionPanel(getCompanyById(company.id));
    }
    if (typeof renderCompanySchedulePanel === "function") {
      renderCompanySchedulePanel(getCompanyById(company.id));
    }
    if (typeof refreshCalendarIfActive === "function") refreshCalendarIfActive();
  });

  const tasksWrap = document.createElement("div");
  tasksWrap.className = "payroll-run-tasks";
  tasksWrap.appendChild(createTaskCheckbox(task, onToggle));
  card.appendChild(tasksWrap);

  return card;
}

/** Called by company-detail.js when the Sales Tax tab is active. */
function renderSalesTaxSection(company) {
  const panel = document.getElementById("companySectionPanel");
  if (!panel || !company) return;

  const wrap = document.createElement("div");
  wrap.className = "payroll-section";

  const schedule = String(company.salesTax ?? "").trim();
  const state = String(company.state ?? "").trim();

  // Both halves of the rule have to be set before any date can be derived,
  // and neither is obvious by its absence — so say which one is missing.
  const missing = [];
  if (!schedule) missing.push("a sales tax schedule");
  if (!state) missing.push("a state");
  if (missing.length > 0) {
    const banner = document.createElement("div");
    banner.className = "payroll-depositor is-warning";
    banner.textContent = `No ${missing.join(" and ")} set — pick ${missing.length > 1 ? "them" : "one"} in Edit company details, or no sales tax payment tasks will be generated.`;
    wrap.appendChild(banner);
  }

  const summary = document.createElement("div");
  summary.className = "payroll-depositor";
  summary.textContent = schedule && state
    ? `${schedule === "Pre-Payment" ? "Monthly pre-payments" : `${schedule} filings`} for ${getStateName(state)} — each payment is due the ${getStateMeta(state).salesTaxDueDay}th of the month after the period ends.`
    : "Sales tax payments are scheduled from the filing cadence and the state the company files in.";
  wrap.appendChild(summary);

  const title = document.createElement("div");
  title.className = "company-section-title";
  title.textContent = "Upcoming payments";
  wrap.appendChild(title);

  const from = todayYmd();
  const to = ymd(addDays(new Date(), SALES_TAX_UPCOMING_DAYS));
  const tasks = buildSalesTaxTasks(company, from, to);

  if (tasks.length === 0) {
    wrap.appendChild(salesTaxEmptyNode(
      schedule && state
        ? `Nothing due in the next ${SALES_TAX_UPCOMING_DAYS} days.`
        : "Set both to generate the payment calendar."
    ));
  } else {
    const list = document.createElement("div");
    list.className = "payroll-run-list";
    tasks.forEach(task => list.appendChild(createSalesTaxCard(company, task)));
    wrap.appendChild(list);
  }

  panel.replaceChildren(wrap);
}
