/**
 * Calendar — every payroll task across every client, on the day it is due.
 *
 * Ported from the PO App dashboard: a continuously scrolling month grid with
 * a day pane that opens beside it. Events here are payroll tasks, placed on
 * their *due* date, which is the Friday before when the real date is a weekend.
 */

const CAL_MONTHS_BEFORE = 2;
const CAL_MONTHS_AFTER = 12;
const CAL_MAX_EVENTS = 5;

/** The badge on a calendar chip — the cell is far too narrow for full labels. */
const CAL_EVENT_SHORT_LABELS = {
  paystub: "Pay",
  tax: "Tax",
  salesTax: "Sales",
};

/** "month" is the continuously scrolling grid; "week" is a single row. */
let calViewMode = "month";
let calWeekStart = null;       // Sunday of the week on screen, in week mode

const CAL_VIEW_MODES = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
];

let calCursor = null;          // { year, month } the arrows/title target
let calSelectedYmd = "";       // day whose pane is open
let calScrollEl = null;
let calMonthAnchors = {};
let calScrollRaf = 0;

/** Which task kinds are shown. All on by default. */
let calFilterSelection = new Set([TASK_KIND_PAYSTUB, TASK_KIND_TAX, TASK_KIND_SALES_TAX]);

/** Every kind the filter knows about — used to tell "all on" from "narrowed". */
const CAL_TASK_KINDS = [TASK_KIND_PAYSTUB, TASK_KIND_TAX, TASK_KIND_SALES_TAX];

/** Payroll and sales tax tasks together, on their due dates. */
function buildAllTasks(fromYmd, toYmd) {
  const salesTax = typeof buildAllSalesTaxTasks === "function"
    ? buildAllSalesTaxTasks(fromYmd, toYmd)
    : [];
  return [...buildAllPayrollTasks(fromYmd, toYmd), ...salesTax]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) ||
                    a.companyName.localeCompare(b.companyName) ||
                    a.kind.localeCompare(b.kind));
}

/** The one-line context line for any task kind. */
function describeAnyTask(task) {
  return task.kind === TASK_KIND_SALES_TAX
    ? describeSalesTaxTask(task)
    : describeTaskContext(task);
}

/** Completed work is hidden by default; the filter bar opts back into it. */
let calShowCompleted = false;

/**
 * Task ids whose whole group is finished.
 *
 * "Complete" is a property of the group, not the task: a run is only done
 * once its paystubs AND the deposit they feed are all ticked off. A paystub
 * checked while its tax payment is still open belongs to unfinished work, so
 * it keeps showing.
 */
function buildCompletedGroupTaskIds(fromYmd, toYmd) {
  const done = new Set();

  getAllCompanies().forEach(company => {
    if (company.services?.payroll) {
      groupPayrollRuns(buildPayrollRuns(company, fromYmd, toYmd)).forEach(group => {
        const tasks = [...group.runs.map(r => r.paystub), group.tax].filter(Boolean);
        if (tasks.every(t => isTaskComplete(t.id))) tasks.forEach(t => done.add(t.id));
      });
    }
    if (typeof buildSalesTaxTasks === "function") {
      // A sales tax payment is a group of one.
      buildSalesTaxTasks(company, fromYmd, toYmd)
        .filter(task => isTaskComplete(task.id))
        .forEach(task => done.add(task.id));
    }
  });

  return done;
}

let calCompletedGroupIds = null;

function invalidateCompletedGroupCache() {
  calCompletedGroupIds = null;
}

/**
 * Cached because three renderers ask for it per pass. The window is
 * deliberately wider than anything on screen so a group is never split by
 * the range — a quarterly deposit sits months away from the runs it covers.
 */
function getCalCompletedGroupIds() {
  if (!calCompletedGroupIds) {
    calCompletedGroupIds = buildCompletedGroupTaskIds(
      ymd(addDays(new Date(), -400)),
      ymd(addDays(new Date(), 500))
    );
  }
  return calCompletedGroupIds;
}

/** Hidden only when the whole group it belongs to is finished. */
function isTaskHiddenAsCompleted(task) {
  return !calShowCompleted && getCalCompletedGroupIds().has(task.id);
}

// ── Task-group selection ─────────────────────────────────────────────────────
//
// A pay run and the deposit it feeds are one unit of work but land on
// different days, so selecting a card lights up every day it touches — the
// paystub on the 24th and its tax payment on the 31st highlight together.

/** Task ids belonging to the currently selected card, or empty for none. */
let calSelectedTaskIds = new Set();

function isCalGroupSelected(taskIds) {
  return taskIds.length > 0 && taskIds.every(id => calSelectedTaskIds.has(id));
}

function selectCalGroup(taskIds) {
  // Clicking the selected card again clears it.
  if (isCalGroupSelected(taskIds) && calSelectedTaskIds.size === taskIds.length) {
    calSelectedTaskIds = new Set();
  } else {
    calSelectedTaskIds = new Set(taskIds);
  }
  applyCalGroupSelection();
}

/** Paint the selection across both the grid chips and the task cards. */
function applyCalGroupSelection() {
  document.querySelectorAll("#calGrid .dash-event[data-task-id]").forEach(chip => {
    chip.classList.toggle("is-group-selected", calSelectedTaskIds.has(chip.dataset.taskId));
  });
  // Re-flow every cell: a chip that just became selected has to surface out
  // of the overflow, and one that just stopped being selected drops back in.
  document.querySelectorAll("#calGrid .dash-cal-cell.has-events").forEach(applyCalCellOverflow);

  document.querySelectorAll(".payroll-run.is-selectable").forEach(card => {
    card.classList.toggle("is-selected", isCalGroupSelected(card.groupTaskIds ?? []));
  });
}

/**
 * Make a task card selectable, wiring it to the shared highlight state.
 *
 * The ids live on the element as a real array rather than a data attribute:
 * task ids already contain "|" as their own field separator, so round-tripping
 * them through a joined string shreds them.
 */
function attachCalGroupSelection(card, taskIds) {
  card.groupTaskIds = taskIds;
  card.classList.add("is-selectable");
  card.classList.toggle("is-selected", isCalGroupSelected(taskIds));
  card.addEventListener("click", e => {
    // Checkboxes and the company link keep their own behaviour.
    if (e.target.closest("input, button, label")) return;
    selectCalGroup(taskIds);
  });
}

// ── Event assembly ───────────────────────────────────────────────────────────

function getCalRange() {
  // Week mode narrows the whole pipeline — events, filters, the day pane —
  // to the seven days on screen.
  if (calViewMode === "week") {
    const start = getCalWeekStart();
    return { start, end: addDays(start, 6) };
  }

  const { year, month } = getCalCursor();
  const start = new Date(year, month - CAL_MONTHS_BEFORE, 1);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(year, month + CAL_MONTHS_AFTER + 1, 0);
  end.setDate(end.getDate() + (6 - end.getDay()));
  return { start, end };
}

/** ymd → task[] for the visible range, after filters. */
function buildCalEventsByDate() {
  const { start, end } = getCalRange();
  const tasks = buildAllTasks(ymd(start), ymd(end));
  const byDate = new Map();

  tasks.forEach(task => {
    if (!calFilterSelection.has(task.kind)) return;
    if (isTaskHiddenAsCompleted(task)) return;
    const done = isTaskComplete(task.id);
    if (!byDate.has(task.dueDate)) byDate.set(task.dueDate, []);
    byDate.get(task.dueDate).push({ ...task, done });
  });

  return byDate;
}

// ── Cursor / title ───────────────────────────────────────────────────────────

function getCalCursor() {
  if (!calCursor) {
    const now = new Date();
    calCursor = { year: now.getFullYear(), month: now.getMonth() };
  }
  return calCursor;
}

function setCalTitle(year, month) {
  const el = document.getElementById("calTitle");
  if (!el) return;
  el.textContent = new Date(year, month, 1)
    .toLocaleString(undefined, { month: "long", year: "numeric" });
}

/** The Sunday that opens the week on screen. */
function getCalWeekStart() {
  if (!calWeekStart) {
    const now = new Date();
    calWeekStart = addDays(now, -now.getDay());
  }
  return calWeekStart;
}

/** e.g. "Aug 16 – 22, 2026", collapsing the month when the week spans two. */
function setCalWeekTitle() {
  const el = document.getElementById("calTitle");
  if (!el) return;
  const start = getCalWeekStart();
  const end = addDays(start, 6);
  const month = d => d.toLocaleString(undefined, { month: "short" });
  const left = `${month(start)} ${start.getDate()}`;
  const right = start.getMonth() === end.getMonth()
    ? `${end.getDate()}`
    : `${month(end)} ${end.getDate()}`;
  el.textContent = `${left} – ${right}, ${end.getFullYear()}`;
}

/** Step a week or a month, whichever the calendar is currently showing. */
function stepCalPeriod(delta) {
  if (calViewMode === "week") {
    calWeekStart = addDays(getCalWeekStart(), delta * 7);
    renderCalendar();
    return;
  }

  const { year, month } = getCalCursor();
  const next = new Date(year, month + delta, 1);
  calCursor = { year: next.getFullYear(), month: next.getMonth() };
  setCalTitle(calCursor.year, calCursor.month);
  scrollCalToMonth(calCursor.year, calCursor.month);
}

/** Jump back to today in whichever view is open. */
function goToCalToday() {
  const now = new Date();
  if (calViewMode === "week") {
    calWeekStart = addDays(now, -now.getDay());
    renderCalendar();
    return;
  }
  calCursor = { year: now.getFullYear(), month: now.getMonth() };
  setCalTitle(calCursor.year, calCursor.month);
  scrollCalToMonth(calCursor.year, calCursor.month);
}

function setCalViewMode(mode) {
  if (calViewMode === mode) return;
  calViewMode = mode;
  // Line the two views up on the same date, so switching doesn't teleport.
  if (mode === "week") {
    const { year, month } = getCalCursor();
    const now = new Date();
    const anchor = (now.getFullYear() === year && now.getMonth() === month)
      ? now
      : new Date(year, month, 1);
    calWeekStart = addDays(anchor, -anchor.getDay());
  } else if (calWeekStart) {
    calCursor = { year: calWeekStart.getFullYear(), month: calWeekStart.getMonth() };
  }
  renderCalendar();
}

function scrollCalToMonth(year, month, { instant = false } = {}) {
  const anchor = calMonthAnchors[`${year}-${month}`];
  if (!anchor || !calScrollEl) return;
  const headH = calScrollEl.querySelector(".dash-cal-head")?.offsetHeight ?? 0;
  calScrollEl.scrollTo({
    top: anchor.offsetTop - headH,
    behavior: instant ? "auto" : "smooth",
  });
}

/** Keep the centered title in step with what's actually on screen. */
function onCalScroll() {
  if (calScrollRaf) return;
  calScrollRaf = requestAnimationFrame(() => {
    calScrollRaf = 0;
    if (!calScrollEl) return;
    const headH = calScrollEl.querySelector(".dash-cal-head")?.offsetHeight ?? 0;
    const probe = calScrollEl.scrollTop + headH + 8;

    let best = null;
    Object.entries(calMonthAnchors).forEach(([key, cell]) => {
      if (cell.offsetTop <= probe && (!best || cell.offsetTop > best.top)) {
        best = { key, top: cell.offsetTop };
      }
    });
    if (!best) return;
    const [year, month] = best.key.split("-").map(Number);
    if (calCursor && calCursor.year === year && calCursor.month === month) return;
    calCursor = { year, month };
    setCalTitle(year, month);
  });
}

// ── Grid ─────────────────────────────────────────────────────────────────────

/** A glyph per task kind, so the three read apart at a glance. */
function createCalEventIcon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "dash-event-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const paths = {
    // Paystub — a document with lines on it.
    [TASK_KIND_PAYSTUB]: ["M6 2h8l4 4v16H6z", "M14 2v5h5", "M9 13h7", "M9 17h5"],
    // Payroll tax — a bank / government building.
    [TASK_KIND_TAX]: ["M3 10h18", "M5 10v9", "M19 10v9", "M12 10v9", "M2 20h20", "M12 3 3 8h18z"],
    // Sales tax — a price tag.
    [TASK_KIND_SALES_TAX]: ["M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z", "M7.5 7.5h.01"],
  }[kind] ?? [];

  paths.forEach(d => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  });
  return svg;
}

function createCalEventChip(event) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `dash-event cal-event--${event.kind}${event.done ? " is-done" : ""}`;
  chip.title = `${event.companyName} · ${event.label} · ${describeAnyTask(event)}`;
  // What the group highlight matches on.
  chip.dataset.taskId = event.id;

  chip.appendChild(createCalEventIcon(event.kind));

  const label = document.createElement("span");
  label.className = "dash-event-title";
  label.textContent = event.companyName;
  chip.appendChild(label);

  const meta = document.createElement("span");
  meta.className = "dash-event-meta";
  meta.textContent = CAL_EVENT_SHORT_LABELS[event.kind] ?? "Pay";
  chip.appendChild(meta);

  // Open the day, then select the group this chip belongs to — clicking a
  // specific task should land on that task's card, not just its date.
  chip.addEventListener("click", e => {
    e.stopPropagation();
    if (calSelectedYmd !== event.dueDate) selectCalDay(event.dueDate);
    selectCalGroupForTask(event);
  });
  return chip;
}

function buildCalCell(date, byDate, today) {
  const cellYmd = ymd(date);
  const cell = document.createElement("div");
  cell.className = "dash-cal-cell";
  cell.dataset.ymd = cellYmd;
  if (isWeekend(date)) cell.classList.add("is-weekend");
  if (cellYmd === today) cell.classList.add("is-today");
  if (cellYmd === calSelectedYmd) cell.classList.add("is-selected");

  const num = document.createElement("span");
  num.className = "dash-cal-date";
  num.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
  if (date.getDate() === 1) {
    cell.classList.add("is-month-start");
    calMonthAnchors[`${date.getFullYear()}-${date.getMonth()}`] = cell;
  }
  cell.appendChild(num);

  // How much is still outstanding on this day, at a glance. Counts tasks,
  // not cards: a run whose paystub lands here is one thing to do today even
  // though its deposit is weeks out.
  const openCount = (byDate.get(cellYmd) ?? []).filter(event => !event.done).length;
  if (openCount > 0) {
    const badge = document.createElement("span");
    badge.className = "dash-cal-open-count";
    badge.textContent = String(openCount);
    badge.title = ` still open`;
    cell.appendChild(badge);
  }

  // Every event is rendered; which ones actually show is decided by
  // applyCalCellOverflow, so selecting a group can reveal one that was
  // sitting inside "+N more" without rebuilding the grid.
  const events = byDate.get(cellYmd) ?? [];
  events.forEach(event => cell.appendChild(createCalEventChip(event)));

  if (events.length > 0) {
    const more = document.createElement("span");
    more.className = "dash-cal-more";
    more.hidden = true;
    cell.appendChild(more);

    cell.classList.add("has-events");
    cell.addEventListener("click", () => selectCalDay(cellYmd));
    applyCalCellOverflow(cell);
  }

  return cell;
}

/**
 * Order a cell's chips and decide which are visible.
 *
 * Sort order, best first: selected before unselected, and within each,
 * still-open before done — so what needs doing rises and finished work
 * settles at the bottom. The date keeps its own CSS order so chips can never
 * climb above it.
 *
 * Selected chips are always shown, however many there are: a selected group
 * left buried in "+N more" defeats the point of highlighting it. The rest
 * fill the remaining room up to CAL_MAX_EVENTS, and the counter only appears
 * when it would hide more than one — swapping a single chip for a "+1 more"
 * of the same height saves nothing.
 */
function applyCalCellOverflow(cell) {
  const chips = [...cell.querySelectorAll(".dash-event")];
  if (chips.length === 0) return;

  const isSelected = chip => calSelectedTaskIds.has(chip.dataset.taskId);
  const rank = chip => (isSelected(chip) ? 0 : 2) + (chip.classList.contains("is-done") ? 1 : 0);

  // Stable sort, so same-rank chips keep the order the day produced them in.
  const ordered = chips
    .map((chip, i) => ({ chip, i, rank: rank(chip) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(entry => entry.chip);

  // Week cells are tall and scroll on their own, so nothing is capped there.
  const cap = calViewMode === "week"
    ? ordered.length
    : Math.max(CAL_MAX_EVENTS, chips.filter(isSelected).length);
  const collapse = ordered.length > cap + 1;

  ordered.forEach((chip, i) => {
    chip.style.order = String(i);
    chip.hidden = collapse && i >= cap;
  });

  const hidden = ordered.filter(chip => chip.hidden).length;
  const more = cell.querySelector(".dash-cal-more");
  if (more) {
    more.hidden = hidden === 0;
    more.textContent = `+${hidden} more`;
  }
}

function sizeCalRows() {
  if (!calScrollEl) return;
  const headH = calScrollEl.querySelector(".dash-cal-head")?.offsetHeight ?? 0;
  const avail = calScrollEl.clientHeight - headH;
  calScrollEl.style.setProperty("--dash-cal-row-h", `${Math.max(84, Math.floor(avail / 5))}px`);
}

/** Weekday header row, shared by both views. */
function buildCalHeadRow() {
  const head = document.createElement("div");
  head.className = "dash-cal-head";
  WEEKDAY_SHORT.forEach((day, i) => {
    const cell = document.createElement("div");
    cell.className = "dash-cal-head-cell";
    if (i === 0 || i === 6) cell.classList.add("is-weekend");
    cell.textContent = day;
    head.appendChild(cell);
  });
  return head;
}

/**
 * One row of seven days, each tall enough to show its work without an
 * overflow counter — the point of the week view is seeing everything.
 */
function renderCalendarWeekGrid() {
  const grid = document.getElementById("calGrid");
  if (!grid) return;

  setCalWeekTitle();
  const byDate = buildCalEventsByDate();
  const today = todayYmd();
  calMonthAnchors = {};
  calScrollEl = null;

  const wrap = document.createElement("div");
  wrap.className = "dash-cal-scroll dash-cal-scroll--week dash-scroll";
  wrap.appendChild(buildCalHeadRow());

  const body = document.createElement("div");
  body.className = "dash-cal-body dash-cal-body--week";
  const start = getCalWeekStart();
  for (let i = 0; i < 7; i++) {
    body.appendChild(buildCalCell(addDays(start, i), byDate, today));
  }
  wrap.appendChild(body);

  grid.replaceChildren(wrap);
  applyCalGroupSelection();
}

function renderCalendarGrid() {
  if (calViewMode === "week") {
    renderCalendarWeekGrid();
    return;
  }

  const grid = document.getElementById("calGrid");
  if (!grid) return;

  const { year, month } = getCalCursor();
  setCalTitle(year, month);

  const byDate = buildCalEventsByDate();
  const today = todayYmd();
  calMonthAnchors = {};
  grid.replaceChildren();

  const scroll = document.createElement("div");
  scroll.className = "dash-cal-scroll dash-scroll";

  scroll.appendChild(buildCalHeadRow());

  const body = document.createElement("div");
  body.className = "dash-cal-body";
  const { start, end } = getCalRange();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    body.appendChild(buildCalCell(new Date(d), byDate, today));
  }
  scroll.appendChild(body);
  grid.appendChild(scroll);

  calScrollEl = scroll;
  scroll.addEventListener("scroll", onCalScroll, { passive: true });
  sizeCalRows();
  scrollCalToMonth(year, month, { instant: true });
  // The chips are new nodes, so the highlight has to be painted back on.
  applyCalGroupSelection();
}

// ── Day pane ─────────────────────────────────────────────────────────────────

function applyCalDaySelection() {
  document.querySelectorAll("#calGrid .dash-cal-cell.is-selected")
    .forEach(cell => cell.classList.remove("is-selected"));
  if (calSelectedYmd) {
    document.querySelector(`#calGrid .dash-cal-cell[data-ymd="${calSelectedYmd}"]`)
      ?.classList.add("is-selected");
  }
}

function selectCalDay(dayYmd) {
  calSelectedYmd = dayYmd === calSelectedYmd ? "" : dayYmd;
  applyCalDaySelection();
  renderCalDayPane();
}

function closeCalDayPane() {
  calSelectedYmd = "";
  applyCalDaySelection();
  renderCalDayPane();
}

/**
 * The groups with any task due on `dayYmd`. A card is the unit here, same as
 * the rail: clicking the 24th surfaces the whole run its paystub belongs to,
 * tax payment included, rather than that one task in isolation.
 *
 * The scan window is wide because a deposit can trail its pay date by months
 * (a quarterly depositor's lands after the quarter ends), and the run that
 * owns a tax task due today may sit well behind it.
 */
function buildDayPaneEntries(dayYmd) {
  const day = parseYmd(dayYmd);
  if (!day) return [];
  const from = ymd(addDays(day, -190));
  const to = ymd(addDays(day, 190));
  const onChange = () => renderCalendar();
  const entries = [];

  getAllCompanies().forEach(company => {
    if (company.services?.payroll) {
      groupPayrollRuns(buildPayrollRuns(company, from, to)).forEach(group => {
        const tasks = [...group.runs.map(r => r.paystub), group.tax].filter(Boolean);
        // Kind filter only: the pane has its own Completed tab, so hiding
        // finished work here would empty the tab that exists to show it.
        const onThisDay = tasks.filter(t => t.dueDate === dayYmd && calFilterSelection.has(t.kind));
        if (onThisDay.length === 0) return;

        entries.push({
          company,
          taskIds: tasks.map(t => t.id),
          // What is actually due today, which is what this day is judged on.
          dayTaskIds: onThisDay.map(t => t.id),
          build: () => group.runs.length > 1
            ? createBatchedRunCard(company, group, { showCompany: true, onChange })
            : createPayrollRunCard(company, group.runs[0], { showCompany: true, onChange }),
        });
      });
    }

    if (typeof buildSalesTaxTasks === "function") {
      buildSalesTaxTasks(company, from, to)
        .filter(t => t.dueDate === dayYmd && calFilterSelection.has(t.kind))
        .forEach(task => {
          entries.push({
            company,
            taskIds: [task.id],
            dayTaskIds: [task.id],
            build: () => createSalesTaxCard(company, task, { showCompany: true, onChange }),
          });
        });
    }
  });

  return entries.sort((a, b) => a.company.name.localeCompare(b.company.name));
}

/** Select whichever group on the open day owns this task. */
function selectCalGroupForTask(task) {
  const entry = buildDayPaneEntries(task.dueDate).find(e => e.taskIds.includes(task.id));
  if (entry) selectCalGroup(entry.taskIds);
  renderCalDayPane();
}

function renderCalDayPane() {
  const pane = document.getElementById("calDayPane");
  if (!pane) return;

  if (!calSelectedYmd) {
    pane.hidden = true;
    return;
  }
  pane.hidden = false;

  const title = document.getElementById("calDayPaneTitle");
  if (title) title.textContent = formatTaskDate(calSelectedYmd);

  // A card is judged on what it owes *today*, not on the whole group: a run
  // whose paystub is ticked here is done for this date even though its
  // deposit is still open weeks out, and it should move accordingly.
  const entries = buildDayPaneEntries(calSelectedYmd).map(entry => ({
    ...entry,
    done: entry.dayTaskIds.every(id => isTaskComplete(id)),
  }));

  const open = entries.filter(entry => !entry.done);
  const done = entries.filter(entry => entry.done);
  const openTaskCount = entries
    .reduce((n, entry) => n + entry.dayTaskIds.filter(id => !isTaskComplete(id)).length, 0);

  // The header count is what's left to do on this day, matching the badge
  // on the calendar cell.
  const count = document.getElementById("calDayPaneCount");
  if (count) count.textContent = openTaskCount ? String(openTaskCount) : "";

  if (!DAY_PANE_TABS.some(tab => tab.key === calDayPaneTab)) calDayPaneTab = "open";
  renderDayPaneTabs({ open: open.length, done: done.length });

  const body = document.getElementById("calDayPaneList");
  if (!body) return;

  const shown = calDayPaneTab === "done" ? done : open;

  if (shown.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dash-empty";
    empty.textContent = entries.length === 0
      ? "Nothing due this day."
      : calDayPaneTab === "done" ? "Nothing completed yet." : "All done for this day.";
    body.replaceChildren(empty);
    return;
  }

  body.replaceChildren(...shown.map(entry => {
    const card = entry.build();
    attachCalGroupSelection(card, entry.taskIds);
    return card;
  }));
  applyCalGroupSelection();
}

const DAY_PANE_TABS = [
  { key: "open", label: "Open" },
  { key: "done", label: "Completed" },
];

/** Which bucket the open day is showing. */
let calDayPaneTab = "open";

function renderDayPaneTabs(counts) {
  const wrap = document.getElementById("calDayPaneTabs");
  if (!wrap) return;

  wrap.replaceChildren(...DAY_PANE_TABS.map(tab => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "task-tab" + (tab.key === calDayPaneTab ? " is-active" : "");
    btn.dataset.status = tab.key;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", tab.key === calDayPaneTab ? "true" : "false");
    btn.textContent = tab.label;

    const n = counts[tab.key] ?? 0;
    if (n > 0) {
      const badge = document.createElement("span");
      badge.className = "task-tab-count";
      badge.textContent = String(n);
      btn.appendChild(badge);
    }
    btn.addEventListener("click", () => {
      calDayPaneTab = tab.key;
      renderCalDayPane();
    });
    return btn;
  }));
}

// ── Filter bar ───────────────────────────────────────────────────────────────
//
// "All" is the resting state. Picking a kind narrows to just that one; from
// there each button toggles, so several can be combined. Clearing the last
// one falls back to All rather than showing an empty calendar, which is
// never what someone means by unticking their final filter.

const CAL_FILTER_OPTIONS = [
  { key: TASK_KIND_PAYSTUB, label: "Paystub" },
  { key: TASK_KIND_TAX, label: "Payroll Tax" },
  { key: TASK_KIND_SALES_TAX, label: "Sales Tax" },
];

function isCalFilterShowingAll() {
  return calFilterSelection.size === CAL_TASK_KINDS.length;
}

function setCalFilterAll() {
  calFilterSelection = new Set(CAL_TASK_KINDS);
  applyCalFilterChange();
}

function toggleCalFilterKind(key) {
  const onlyThisKind = !isCalFilterShowingAll() &&
                       calFilterSelection.size === 1 &&
                       calFilterSelection.has(key);
  // One kind at a time: picking another swaps to it, and picking the active
  // one again releases back to All.
  calFilterSelection = onlyThisKind ? new Set(CAL_TASK_KINDS) : new Set([key]);
  applyCalFilterChange();
}

function applyCalFilterChange() {
  renderCalFilterBar();
  renderCalendarGrid();
  renderCalDayPane();
  renderUpcomingTasks();
}

function renderCalFilterBar() {
  const bar = document.getElementById("calFilterBar");
  if (!bar) return;

  const makeBtn = (label, active, onClick, extraClass = "") => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cal-filter-btn" + (active ? " is-active" : "") + (extraClass ? " " + extraClass : "");
    btn.textContent = label;
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.addEventListener("click", onClick);
    return btn;
  };

  const all = makeBtn("All", isCalFilterShowingAll(), setCalFilterAll);

  const kinds = CAL_FILTER_OPTIONS.map(option => {
    const active = !isCalFilterShowingAll() && calFilterSelection.has(option.key);
    const btn = makeBtn(option.label, active, () => toggleCalFilterKind(option.key));
    btn.dataset.kind = option.key;
    return btn;
  });

  const showCompleted = makeBtn("Show completed", calShowCompleted, () => {
    calShowCompleted = !calShowCompleted;
    applyCalFilterChange();
  }, "cal-filter-btn--completed");

  const views = CAL_VIEW_MODES.map(mode => {
    const btn = makeBtn(mode.label, calViewMode === mode.key, () => setCalViewMode(mode.key), "cal-view-btn");
    btn.dataset.view = mode.key;
    return btn;
  });

  const viewGroup = document.createElement("div");
  viewGroup.className = "cal-view-group";
  viewGroup.append(...views);

  bar.replaceChildren(all, ...kinds, showCompleted, viewGroup);
}

// ── Upcoming tasks rail ──────────────────────────────────────────────────────

/** How far ahead the rail beside the calendar looks. */
const CAL_UPCOMING_DAYS = 30;

/**
 * The rail shows the same cards the company detail page does — a pay run and
 * the tax deposit it feeds are one card, not two loose rows — with the
 * company name added, since this list spans every client.
 *
 * A card is a unit of work, so the grid's filters decide which cards appear
 * rather than reaching inside them: a card shows when any task in it matches,
 * and keeps all its sub-tasks so the paystub → deposit chain stays readable.
 */
function taskPassesCalFilters(task) {
  if (!task) return false;
  if (!calFilterSelection.has(task.kind)) return false;
  return !isTaskHiddenAsCompleted(task);
}

function buildUpcomingCardEntries() {
  // Overdue work sits before today, so the window reaches back as well.
  const from = ymd(addDays(new Date(), -CAL_UPCOMING_DAYS));
  const to = ymd(addDays(new Date(), CAL_UPCOMING_DAYS));
  const onChange = () => renderCalendar();
  const entries = [];

  getAllCompanies().forEach(company => {
    if (company.services?.payroll) {
      groupPayrollRuns(buildPayrollRuns(company, from, to)).forEach(group => {
        const anyVisible = group.runs.some(run => taskPassesCalFilters(run.paystub)) ||
                           taskPassesCalFilters(group.tax);
        if (!anyVisible) return;

        const tasks = [...group.runs.map(r => r.paystub), group.tax].filter(Boolean);
        entries.push({
          sortKey: group.runs[0].paystub.dueDate,
          company,
          taskIds: tasks.map(t => t.id),
          dueDates: tasks.map(t => t.dueDate),
          build: () => group.runs.length > 1
            ? createBatchedRunCard(company, group, { showCompany: true, onChange })
            : createPayrollRunCard(company, group.runs[0], { showCompany: true, onChange }),
        });
      });
    }

    if (typeof buildSalesTaxTasks === "function") {
      buildSalesTaxTasks(company, from, to)
        .filter(taskPassesCalFilters)
        .forEach(task => {
          entries.push({
            sortKey: task.dueDate,
            company,
            taskIds: [task.id],
            dueDates: [task.dueDate],
            build: () => createSalesTaxCard(company, task, { showCompany: true, onChange }),
          });
        });
    }
  });

  return entries.sort((a, b) =>
    a.sortKey.localeCompare(b.sortKey) || a.company.name.localeCompare(b.company.name));
}

/** Which status tab the Home rail is showing. */
let homeTaskStatus = "upcoming";

function renderUpcomingTasks() {
  const list = document.getElementById("upcomingTasksList");
  if (!list) return;

  const all = buildUpcomingCardEntries()
    .map(entry => ({ ...entry, status: classifyTaskStatus(entry.taskIds, entry.dueDates) }));

  const counts = { upcoming: 0, overdue: 0, completed: 0 };
  all.forEach(e => { counts[e.status] += 1; });

  renderTaskStatusTabs("homeTaskTabs", homeTaskStatus, counts, key => {
    homeTaskStatus = key;
    renderUpcomingTasks();
  });

  const shown = all.filter(e => e.status === homeTaskStatus);
  const count = document.getElementById("upcomingTasksCount");
  if (count) count.textContent = shown.length ? String(shown.length) : "";

  if (shown.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dash-empty";
    empty.textContent = `Nothing ${homeTaskStatus}.`;
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...shown.map(entry => {
    const card = entry.build();
    attachCalGroupSelection(card, entry.taskIds);
    return card;
  }));
}

// ── Entry points ─────────────────────────────────────────────────────────────

function renderCalendar() {
  // Every completion toggle routes back through here, so this is the one
  // place the group-completion cache needs clearing.
  invalidateCompletedGroupCache();
  renderCalFilterBar();
  renderCalendarGrid();
  renderCalDayPane();
  renderUpcomingTasks();
}

/** Cheap no-op unless the calendar is the active view. */
function refreshCalendarIfActive() {
  if (getCurrentAppView() === "home") renderCalendar();
}

function initCalendar() {
  document.getElementById("calPrev")?.addEventListener("click", () => stepCalPeriod(-1));
  document.getElementById("calNext")?.addEventListener("click", () => stepCalPeriod(1));
  document.getElementById("calToday")?.addEventListener("click", goToCalToday);

  document.getElementById("calDayPaneClose")?.addEventListener("click", closeCalDayPane);

  window.addEventListener("resize", () => {
    if (getCurrentAppView() === "home") sizeCalRows();
  });
}
