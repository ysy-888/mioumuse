/**
 * Payroll date engine — pure date math, no DOM, no storage.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULES ENCODED HERE
 *
 * Pay dates
 *   Monthly       last day of every month
 *   Semi-Monthly  the 15th and the last day of every month
 *   Bi-Weekly     an anchor pay date, then every 14 days
 *
 * Payroll tax deposit due date, derived from each pay date
 *   Quarterly depositor    the last day of the month after the quarter ends
 *                          (Form 941: Apr 30, Jul 31, Oct 31, Jan 31)
 *   Monthly depositor      the 15th of the following month
 *   Semi-Weekly depositor  pay date Sat/Sun/Mon/Tue  -> that week's upcoming Friday
 *                          pay date Wed/Thu/Fri      -> the following Wednesday
 *
 * Weekend handling
 *   A date that lands on a weekend does NOT move. The *task* is pulled back to
 *   the Friday before, so the work is done ahead of the date rather than after.
 *   This is deliberately stricter than the IRS rule, which pushes a due date
 *   forward to the next business day.
 *
 * NOT handled: federal holidays. A task due the Friday after Thanksgiving, say,
 * still reads as that Friday.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SUNDAY = 0;
const WEDNESDAY = 3;
const FRIDAY = 5;
const SATURDAY = 6;

// ── Date primitives (local time, no timezone drift) ──────────────────────────

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmd(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

function todayYmd() {
  return ymd(new Date());
}

function isWeekend(date) {
  const day = date.getDay();
  return day === SATURDAY || day === SUNDAY;
}

/** Human-facing date, e.g. "Fri, Mar 14". */
function formatTaskDate(value) {
  const date = typeof value === "string" ? parseYmd(value) : value;
  if (!date) return EMPTY_DISPLAY;
  return `${WEEKDAY_SHORT[date.getDay()]}, ${date.toLocaleString(undefined, { month: "short" })} ${date.getDate()}`;
}

/**
 * Compact form for task cards, e.g. "3/14 Fri" — the number first, since
 * that's what you scan for, with the weekday trailing as context.
 */
function formatTaskDateShort(value) {
  const date = typeof value === "string" ? parseYmd(value) : value;
  if (!date) return EMPTY_DISPLAY;
  return `${date.getMonth() + 1}/${date.getDate()} ${WEEKDAY_SHORT[date.getDay()]}`;
}

// ── Weekend adjustment ───────────────────────────────────────────────────────

/**
 * When a date falls on a weekend, the task for it is due the Friday before.
 * Saturday pulls back one day, Sunday two. Weekdays are returned unchanged.
 */
function taskDueDateFor(date) {
  const day = date.getDay();
  if (day === SATURDAY) return addDays(date, -1);
  if (day === SUNDAY) return addDays(date, -2);
  return date;
}

// ── Pay date generation ──────────────────────────────────────────────────────

/** Pay dates for one schedule within [fromYmd, toYmd], ascending. */
function generatePayDates(group, fromYmd, toYmd) {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (!from || !to || to < from) return [];

  switch (group?.schedule) {
    case "Monthly":      return generateMonthlyPayDates(from, to);
    case "Semi-Monthly": return generateSemiMonthlyPayDates(from, to);
    case "Bi-Weekly":    return generateBiWeeklyPayDates(group, from, to);
    default:             return [];
  }
}

function generateMonthlyPayDates(from, to) {
  const dates = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    const payDate = lastDayOfMonth(cursor.getFullYear(), cursor.getMonth());
    if (payDate >= from && payDate <= to) dates.push(payDate);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return dates;
}

function generateSemiMonthlyPayDates(from, to) {
  const dates = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    [new Date(year, month, 15), lastDayOfMonth(year, month)].forEach(payDate => {
      if (payDate >= from && payDate <= to) dates.push(payDate);
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return dates.sort((a, b) => a - b);
}

/**
 * Every 14 days from the anchor. Walks backwards too, so a range that starts
 * before the anchor still lines up on the same fortnightly rhythm.
 */
function generateBiWeeklyPayDates(group, from, to) {
  const anchor = parseYmd(group?.anchorDate);
  if (!anchor) return [];

  const MS_PER_DAY = 86400000;
  // Day difference via UTC noon avoids DST making a 14-day step 13.96 days.
  const utc = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const daysFromAnchor = Math.round((utc(from) - utc(anchor)) / MS_PER_DAY);
  const periodsToFirst = Math.ceil(daysFromAnchor / 14);

  const dates = [];
  let cursor = addDays(anchor, periodsToFirst * 14);
  while (cursor <= to) {
    if (cursor >= from) dates.push(cursor);
    cursor = addDays(cursor, 14);
  }
  return dates;
}

// ── Tax deposit due dates ────────────────────────────────────────────────────

/**
 * Deposit due date for a given pay date.
 * `depositor` is "Monthly" or "Semi-Weekly"; anything else yields null.
 */
function taxDueDateForPayDate(payDate, depositor) {
  if (depositor === "Quarterly") {
    // The Form 941 deadline: the last day of the month after the calendar
    // quarter the pay date falls in. Every run in a quarter resolves to the
    // same date, so they collapse into one deposit (see buildPayrollTasks).
    const quarterEndMonth = Math.floor(payDate.getMonth() / 3) * 3 + 2;
    return lastDayOfMonth(payDate.getFullYear(), quarterEndMonth + 1);
  }

  if (depositor === "Monthly") {
    // The 15th of the month after the pay date's month.
    return new Date(payDate.getFullYear(), payDate.getMonth() + 1, 15);
  }

  if (depositor === "Semi-Weekly") {
    const day = payDate.getDay();
    // Wed / Thu / Fri -> the following Wednesday.
    if (day >= WEDNESDAY && day <= FRIDAY) {
      return addDays(payDate, 7 - (day - WEDNESDAY));
    }
    // Sat / Sun / Mon / Tue -> that week's upcoming Friday.
    const daysToFriday = day === SATURDAY ? 6 : FRIDAY - day;
    return addDays(payDate, daysToFriday);
  }

  return null;
}

// ── Task generation ──────────────────────────────────────────────────────────

const TASK_KIND_PAYSTUB = "paystub";
const TASK_KIND_TAX = "tax";

const TASK_KIND_LABELS = {
  [TASK_KIND_PAYSTUB]: "Paystub",
  [TASK_KIND_TAX]: "Tax Payment",
};

/**
 * Stable identity for a task, so only completion state needs storing — the
 * tasks themselves are always derived from the schedule.
 *
 * Paystubs are per pay run, so they key on schedule + pay date. Tax deposits
 * key on the deposit date instead, because one deposit covers every payroll
 * that falls in its window (see buildPayrollTasks).
 */
function buildPaystubTaskId(companyId, schedule, payDateYmd) {
  return `${companyId}|${schedule}|${payDateYmd}|${TASK_KIND_PAYSTUB}`;
}

function buildTaxTaskId(companyId, taxDateYmd) {
  return `${companyId}|${taxDateYmd}|${TASK_KIND_TAX}`;
}

/**
 * Every task a company's payroll groups produce in [fromYmd, toYmd].
 *
 * Each pay date yields two: the paystub, and the tax deposit for that run.
 * `date` is the real pay/deposit date; `dueDate` is when the task must be
 * done, pulled back off a weekend. `payDate` is always the run it belongs to.
 *
 * A company with Payroll switched off keeps its schedules and employees but
 * generates nothing — the check lives here rather than at each call site so
 * an inactive service can't leak tasks into a view that forgot to ask.
 */
function buildPayrollTasks(company, fromYmd, toYmd) {
  if (company?.services?.payroll !== true) return [];

  const paystubs = [];
  // Deposit date -> the one task covering every run that lands in its window.
  const taxByDate = new Map();
  const depositor = String(company?.payrollTax ?? "").trim();

  // Widen the scan so a deposit can fall inside the range even when the pay
  // date that produced it sits just before the start.
  const scanFrom = ymd(addDays(parseYmd(fromYmd) ?? new Date(), -45));
  const scanTo = ymd(addDays(parseYmd(toYmd) ?? new Date(), 45));

  getEnabledPayrollGroups(company).forEach(group => {
    generatePayDates(group, scanFrom, scanTo).forEach(payDate => {
      const payYmd = ymd(payDate);

      paystubs.push({
        id: buildPaystubTaskId(company.id, group.schedule, payYmd),
        companyId: company.id,
        companyName: company.name,
        schedule: group.schedule,
        kind: TASK_KIND_PAYSTUB,
        label: TASK_KIND_LABELS[TASK_KIND_PAYSTUB],
        payDate: payYmd,
        date: payYmd,
        dueDate: ymd(taskDueDateFor(payDate)),
        movedForWeekend: isWeekend(payDate),
        employeeCount: (group.employees ?? []).length,
      });

      const taxDate = taxDueDateForPayDate(payDate, depositor);
      if (!taxDate) return;

      // One deposit covers every payroll in its window: a monthly depositor
      // files once for the whole month, and a semi-weekly depositor files
      // once for all pay dates sharing a Wed/Fri deadline. Runs that resolve
      // to the same deposit date therefore collapse into a single task.
      const taxYmd = ymd(taxDate);
      if (!taxByDate.has(taxYmd)) {
        taxByDate.set(taxYmd, {
          id: buildTaxTaskId(company.id, taxYmd),
          companyId: company.id,
          companyName: company.name,
          kind: TASK_KIND_TAX,
          label: TASK_KIND_LABELS[TASK_KIND_TAX],
          date: taxYmd,
          dueDate: ymd(taskDueDateFor(taxDate)),
          movedForWeekend: isWeekend(taxDate),
          depositor,
          coveredRuns: [],
        });
      }
      const task = taxByDate.get(taxYmd);
      task.coveredRuns.push({ schedule: group.schedule, payDate: payYmd });
    });
  });

  // Surface the runs a deposit covers, earliest first.
  taxByDate.forEach(task => {
    task.coveredRuns.sort((a, b) => a.payDate.localeCompare(b.payDate));
    task.payDate = task.coveredRuns[0]?.payDate ?? "";
    task.schedule = [...new Set(task.coveredRuns.map(r => r.schedule))].join(" + ");
  });

  // Keep only what actually falls in the requested window, by due date.
  return [...paystubs, ...taxByDate.values()]
    .filter(task => task.dueDate >= fromYmd && task.dueDate <= toYmd)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) ||
                    a.companyName.localeCompare(b.companyName) ||
                    a.kind.localeCompare(b.kind));
}

/** One-line description of what a task covers, for lists and tooltips. */
function describeTaskContext(task) {
  if (task.kind === TASK_KIND_TAX) {
    const runs = task.coveredRuns ?? [];
    if (runs.length > 1) {
      return `${task.depositor} deposit covering ${runs.length} runs from ${formatTaskDate(runs[0].payDate)}`;
    }
    return `${task.depositor} deposit for the ${task.schedule} run of ${formatTaskDate(task.payDate)}`;
  }
  return `${task.schedule} run of ${formatTaskDate(task.payDate)}`;
}

/** Tasks across every company, for the calendar. */
function buildAllPayrollTasks(fromYmd, toYmd) {
  return getAllCompanies()
    .filter(company => company.services?.payroll)
    .flatMap(company => buildPayrollTasks(company, fromYmd, toYmd))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) ||
                    a.companyName.localeCompare(b.companyName) ||
                    a.kind.localeCompare(b.kind));
}

// ── Payroll runs — the paystub/tax pairing ───────────────────────────────────
//
// A "run" is one pay date paired with the tax deposit it feeds into. The
// paystub is always its own task; the tax side is shared whenever a deposit
// covers more than one run (see buildPayrollTasks), so completing it in one
// run's card completes it everywhere it's covered. A run only counts as done
// once both sides are — and the tax side can't be checked at all until its
// paystub is, since a deposit can't be filed against payroll that hasn't run.

/**
 * One pay run per enabled group, with its paystub and (if a depositor is
 * set) the tax task covering it. Kept to runs where either part's due date
 * falls in [fromYmd, toYmd] — a tax deposit can land well after its pay
 * date, so a run can still be "upcoming" on its tax side after its paystub
 * due date has already passed.
 */
function buildPayrollRuns(company, fromYmd, toYmd) {
  const from = parseYmd(fromYmd) ?? new Date();
  const to = parseYmd(toYmd) ?? new Date();
  const scanFrom = ymd(addDays(from, -75));
  const scanTo = ymd(addDays(to, 75));
  const tasks = buildPayrollTasks(company, scanFrom, scanTo);

  // Reverse-index each run a tax deposit covers, so a paystub can look up
  // the (possibly shared) tax task that pays it.
  const taxByRunKey = new Map();
  tasks.filter(t => t.kind === TASK_KIND_TAX).forEach(taxTask => {
    (taxTask.coveredRuns ?? []).forEach(run => {
      taxByRunKey.set(`${run.schedule}|${run.payDate}`, taxTask);
    });
  });

  return tasks
    .filter(t => t.kind === TASK_KIND_PAYSTUB)
    .map(paystub => {
      const tax = taxByRunKey.get(`${paystub.schedule}|${paystub.payDate}`) ?? null;
      return {
        id: `${company.id}|${paystub.schedule}|${paystub.payDate}|run`,
        companyId: company.id,
        companyName: company.name,
        schedule: paystub.schedule,
        payDate: paystub.payDate,
        paystub,
        tax,
      };
    })
    .filter(run => (run.paystub.dueDate >= fromYmd && run.paystub.dueDate <= toYmd) ||
                    (run.tax && run.tax.dueDate >= fromYmd && run.tax.dueDate <= toYmd))
    .sort((a, b) => a.payDate.localeCompare(b.payDate) || a.schedule.localeCompare(b.schedule));
}

/** A run is complete only once its paystub and (if any) its tax side are. */
function isPayrollRunComplete(run) {
  if (!isTaskComplete(run.paystub.id)) return false;
  return !run.tax || isTaskComplete(run.tax.id);
}

/**
 * Whether a task can be checked off. Paystubs always can; a tax deposit
 * can't until every paystub run it covers is already done.
 */
function isTaxTaskUnlocked(task) {
  if (!task || task.kind !== TASK_KIND_TAX) return true;
  return (task.coveredRuns ?? []).every(run =>
    isTaskComplete(buildPaystubTaskId(task.companyId, run.schedule, run.payDate))
  );
}

/** Pull the id parts back out — cheaper than regenerating the schedule to look one task up. */
function parseTaskId(taskId) {
  const parts = String(taskId ?? "").split("|");
  if (parts.length === 4 && parts[3] === TASK_KIND_PAYSTUB) {
    return { kind: TASK_KIND_PAYSTUB, companyId: parts[0], schedule: parts[1], date: parts[2] };
  }
  if (parts.length === 3 && parts[2] === TASK_KIND_TAX) {
    return { kind: TASK_KIND_TAX, companyId: parts[0], date: parts[1] };
  }
  return null;
}

/** Regenerate the one live task an id refers to, or null if it no longer exists. */
function findTaskById(taskId) {
  const parsed = parseTaskId(taskId);
  const company = parsed && getCompanyById(parsed.companyId);
  const anchor = parsed && parseYmd(parsed.date);
  if (!company || !anchor) return null;

  const from = ymd(addDays(anchor, -3));
  return buildPayrollTasks(company, from, parsed.date).find(t => t.id === taskId) ?? null;
}

/**
 * Backstop for setTaskComplete: a tax task id can only be marked complete
 * once every paystub it covers already is. Fails open (allows it) when the
 * task can no longer be found — e.g. its schedule was turned off — rather
 * than permanently blocking a stale id.
 */
function canCompleteTask(taskId) {
  return isTaxTaskUnlocked(findTaskById(taskId));
}
