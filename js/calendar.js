/**
 * Calendar — every campaign, trade show and photoshoot, and every task, on the day it lands.
 *
 * A continuously scrolling month grid (or a single week) with a day pane that
 * opens beside it. A campaign or show appears on each day it runs; its tasks
 * appear on their due dates. Selecting one lights up all of it at once — its
 * days and every task leading up to them.
 */

const CAL_MONTHS_BEFORE = 2;
const CAL_MONTHS_AFTER = 12;
const CAL_MAX_EVENTS = 5;

/** "month" is the continuously scrolling grid; "week" is a single row. */
let calViewMode = "month";
let calWeekStart = null;       // Sunday of the week on screen, in week mode

const CAL_VIEW_MODES = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
];

let calCursor = null;          // { year, month } the arrows/title target
/**
 * The date whose week sits in the month grid's top row. Today by default, so
 * the calendar opens on this week rather than on the 1st of the month; the
 * month arrows set it to the 1st, and scrolling keeps it current.
 */
let calTopYmd = null;
let calSelectedYmd = "";       // day whose pane is open
let calScrollEl = null;
let calMonthAnchors = {};
let calScrollRaf = 0;

/**
 * The filter: three types, each with the things under it — a campaign's or a
 * show's task types, a photoshoot's kind (Studio / Editorial). A type that's
 * off hides its days and its tasks; under a type that's on, an unticked task
 * type hides just those tasks.
 */
const CAL_TASK_SUBFILTERS = [
  { key: TASK_KIND_EMAIL, label: "Email" },
  { key: TASK_KIND_SOCIAL, label: "Social Media" },
  { key: TASK_KIND_BANNER, label: "Graphic" },
  { key: TASK_KIND_VIDEO, label: "Video" },
];

const CAL_TYPE_FILTERS = [
  { key: EVENT_KIND_CAMPAIGN, label: "Campaign", subs: CAL_TASK_SUBFILTERS },
  { key: EVENT_KIND_SHOW, label: "Trade Show", subs: CAL_TASK_SUBFILTERS },
  { key: EVENT_KIND_SHOOT, label: "Photoshoot", subs: PHOTOSHOOT_TYPES.map(t => ({ key: t.key, label: t.label })) },
];

/** Types shown, and under each the sub-filters ticked. All on by default. */
let calTypeOn = new Set(CAL_TYPE_FILTERS.map(t => t.key));
let calSubOn = Object.fromEntries(CAL_TYPE_FILTERS.map(t => [t.key, new Set(t.subs.map(sub => sub.key))]));

/** Whether the item's days show: its type is on (and, for a shoot, its kind). */
function isCalItemShown(item) {
  if (!calTypeOn.has(item.dayKind)) return false;
  if (item.type === ITEM_TYPE_PHOTOSHOOT && PHOTOSHOOT_TYPE_KEYS.includes(item.record.type)) {
    return calSubOn[EVENT_KIND_SHOOT].has(item.record.type);
  }
  return true;
}

/** Whether one of the item's tasks shows: its type is on and the task type ticked. */
function isCalTaskShown(item, task) {
  return calTypeOn.has(item.dayKind) && (calSubOn[item.dayKind]?.has(task.kind) ?? true);
}

/**
 * Tasks of an item whose every task is done are hidden by default; the filter
 * bar opts back into them. The days themselves always show — they're events,
 * not work to finish.
 */
let calShowCompleted = false;

/**
 * Chip look: "solid" (events a solid block, tasks a lighter shade) or
 * "classic" (pale events, white tasks edged in colour). Remembered in this
 * browser only — it's a viewing preference.
 */
const CAL_CHIP_STYLE_KEY = "calChipStyle";
let calChipStyle = (() => {
  try { return localStorage.getItem(CAL_CHIP_STYLE_KEY) === "classic" ? "classic" : "solid"; } catch { return "solid"; }
})();

function setCalChipStyle(style) {
  calChipStyle = style;
  try { localStorage.setItem(CAL_CHIP_STYLE_KEY, style); } catch { /* not remembered */ }
  applyCalChipStyle();
}

/** The grid's chip look, and the tick on "Classic chips" in the ⋮ menu. */
function applyCalChipStyle() {
  const classic = calChipStyle === "classic";
  document.getElementById("calGrid")?.classList.toggle("is-classic-chips", classic);
  const item = document.getElementById("headerMenuClassicChips");
  if (item) {
    item.setAttribute("aria-checked", classic ? "true" : "false");
    item.classList.toggle("is-checked", classic);
  }
}

function areTasksHiddenAsCompleted(item) {
  return !calShowCompleted && isItemComplete(item);
}

/** The item's tasks that pass the kind filter and the completed toggle. */
function getVisibleItemTasks(item) {
  if (areTasksHiddenAsCompleted(item)) return [];
  return item.tasks.filter(task => isCalTaskShown(item, task));
}

// ── Group selection ──────────────────────────────────────────────────────────
//
// A show and its emails are one unit of work spread across several weeks, so
// selecting a card lights up every day it touches.

/** Ids belonging to the currently selected card, or empty for none. */
let calSelectedTaskIds = new Set();

function isCalGroupSelected(taskIds) {
  return taskIds.length > 0 && taskIds.every(id => calSelectedTaskIds.has(id));
}

function isCalGroupSelectedExactly(taskIds) {
  return isCalGroupSelected(taskIds) && calSelectedTaskIds.size === taskIds.length;
}

function clearCalGroupSelection() {
  if (calSelectedTaskIds.size === 0) return;
  calSelectedTaskIds = new Set();
  applyCalGroupSelection();
}

/**
 * One click does both: highlight the card and its days, and open the item
 * in the side pane. Clicking the open, highlighted card again closes both.
 */
function selectCalGroup(taskIds, item) {
  if (isCalItemPaneOpen(item) && (taskIds.length === 0 || isCalGroupSelectedExactly(taskIds))) {
    closeCalItemPane(item); // clears the highlight too
    return;
  }
  // The item's pane takes the day pane's place — they'd show the same work.
  if (calSelectedYmd) closeCalDayPane();
  // Open first: opening one pane closes the other, which clears the highlight.
  openCalItemPane(item);
  calSelectedTaskIds = new Set(taskIds);
  applyCalGroupSelection();
}

// A shoot has its own pane (js/photoshoots.js); campaigns and shows share one.

function isCalItemPaneOpen(item) {
  if (item.type === ITEM_TYPE_PHOTOSHOOT) return paneShootId === item.id;
  return paneItemRef?.type === item.type && paneItemRef?.id === item.id;
}

function openCalItemPane(item) {
  if (item.type === ITEM_TYPE_PHOTOSHOOT) openShootPane(item.id);
  else openItemPane(item.type, item.id);
}

function closeCalItemPane(item) {
  if (item.type === ITEM_TYPE_PHOTOSHOOT) closeShootPane();
  else closeItemPane();
}

/** Paint the selection across both the grid chips and the cards. */
function applyCalGroupSelection() {
  document.querySelectorAll("#calGrid .dash-event[data-task-id]").forEach(chip => {
    chip.classList.toggle("is-group-selected", calSelectedTaskIds.has(chip.dataset.taskId));
  });
  document.querySelectorAll(".payroll-run.is-selectable").forEach(card => {
    card.classList.toggle("is-selected", isCalGroupSelected(card.groupTaskIds ?? []));
  });
}

/**
 * Make a card selectable, wiring it to the shared highlight state. The ids
 * live on the element as a real array — they contain "|" as a separator, so
 * a joined data attribute would shred them.
 */
function attachCalGroupSelection(card, taskIds, item) {
  card.groupTaskIds = taskIds;
  card.classList.add("is-selectable");
  card.classList.toggle("is-selected", isCalGroupSelected(taskIds));
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open ${item.title}`);
  card.addEventListener("click", e => {
    // Task rows still tick their checkbox rather than opening the card.
    if (e.target.closest("input, button, label, a")) return;
    selectCalGroup(taskIds, item);
  });
  card.addEventListener("keydown", e => {
    if (e.target !== card || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    selectCalGroup(taskIds, item);
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

/**
 * Everything one item puts on the calendar, after the filters: a chip per day
 * it runs, and a chip per task on its due date. Each entry carries its item.
 */
function buildItemCalendarEntries(item) {
  const entries = [];
  if (isCalItemShown(item)) {
    // A shoot's day is the work itself, so it greys out once it's complete.
    const done = item.type === ITEM_TYPE_PHOTOSHOOT && isItemComplete(item);
    buildItemDayEvents(item).forEach(event => entries.push({ ...event, done, item }));
  }
  getVisibleItemTasks(item).forEach(task => entries.push({ ...task, done: isTaskComplete(task.id), item }));
  return entries;
}

function isDayEntry(entry) {
  return entry.kind === EVENT_KIND_SHOW || entry.kind === EVENT_KIND_CAMPAIGN || entry.kind === EVENT_KIND_SHOOT;
}

/** ymd → entry[] for the visible range, after filters. */
function buildCalEventsByDate() {
  const { start, end } = getCalRange();
  const from = ymd(start);
  const to = ymd(end);
  const byDate = new Map();

  getAllScheduleItems().forEach(item => {
    buildItemCalendarEntries(item).forEach(entry => {
      if (entry.dueDate < from || entry.dueDate > to) return;
      if (!byDate.has(entry.dueDate)) byDate.set(entry.dueDate, []);
      byDate.get(entry.dueDate).push(entry);
    });
  });

  // Days first — they frame the date — then tasks, each by name.
  byDate.forEach(entries => entries.sort((a, b) =>
    (isDayEntry(a) ? 0 : 1) - (isDayEntry(b) ? 0 : 1) ||
    a.item.chipLabel.localeCompare(b.item.chipLabel)));
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
  applyCalMonthFocus();
}

/**
 * In the scrolling month grid, days outside the month named in the title
 * step back, so the month you're reading stands out from its neighbours.
 */
function applyCalMonthFocus() {
  if (!calScrollEl || !calCursor) return;
  const key = `${calCursor.year}-${calCursor.month}`;
  calScrollEl.querySelectorAll(".dash-cal-body > .dash-cal-cell").forEach(cell => {
    cell.classList.toggle("is-other-month", cell.dataset.month !== key);
  });
}

/** The Sunday that opens the week on screen. */
function getCalWeekStart() {
  if (!calWeekStart) {
    const now = new Date();
    calWeekStart = addDays(now, -now.getDay());
  }
  return calWeekStart;
}

function setCalWeekTitle() {
  const el = document.getElementById("calTitle");
  if (!el) return;
  const start = getCalWeekStart();
  el.textContent = formatDateRange(ymd(start), ymd(addDays(start, 6)));
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
  calTopYmd = ymd(next);
  setCalTitle(calCursor.year, calCursor.month);
  scrollCalToDate(calTopYmd);
}

/** Jump back to today in whichever view is open — this week at the top. */
function goToCalToday() {
  const now = new Date();
  if (calViewMode === "week") {
    calWeekStart = addDays(now, -now.getDay());
    renderCalendar();
    return;
  }
  calCursor = { year: now.getFullYear(), month: now.getMonth() };
  calTopYmd = ymd(now);
  setCalTitle(calCursor.year, calCursor.month);
  scrollCalToDate(calTopYmd);
}

function getCalTopYmd() {
  return calTopYmd ?? todayYmd();
}

function setCalViewMode(mode) {
  if (calViewMode === mode) return;
  calViewMode = mode;
  // Line the two views up on the same week, so switching doesn't teleport:
  // the week view shows the month grid's top row, and back again.
  if (mode === "week") {
    const top = parseYmd(getCalTopYmd()) ?? new Date();
    calWeekStart = addDays(top, -top.getDay());
  } else if (calWeekStart) {
    calCursor = { year: calWeekStart.getFullYear(), month: calWeekStart.getMonth() };
    calTopYmd = ymd(calWeekStart);
  }
  renderCalendar();
}

/** Scroll the month grid so the week holding `dayYmd` is the top row. */
function scrollCalToDate(dayYmd, { instant = false } = {}) {
  const cell = calScrollEl?.querySelector(`.dash-cal-cell[data-ymd="${dayYmd}"]`);
  if (!cell) return;
  const headH = calScrollEl.querySelector(".dash-cal-head")?.offsetHeight ?? 0;
  calScrollEl.scrollTo({
    top: cell.offsetTop - headH,
    behavior: instant ? "auto" : "smooth",
  });
}

/**
 * Keep the title and the top-row date in step with what's actually on
 * screen: the title names the latest month that has started by the top row,
 * and the top row is remembered so a re-render or resize lands back on it.
 */
function onCalScroll() {
  if (calScrollRaf) return;
  calScrollRaf = requestAnimationFrame(() => {
    calScrollRaf = 0;
    if (!calScrollEl) return;
    const headH = calScrollEl.querySelector(".dash-cal-head")?.offsetHeight ?? 0;
    const probe = calScrollEl.scrollTop + headH + 8;

    // Every 7th cell starts a row.
    const cells = calScrollEl.querySelectorAll(".dash-cal-body > .dash-cal-cell");
    for (let i = 0; i < cells.length; i += 7) {
      if (cells[i].offsetTop > probe) break;
      calTopYmd = cells[i].dataset.ymd;
    }

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

/** The badge on a task chip — the cell is far too narrow for full labels. */
const CAL_TASK_SHORT_LABELS = {
  [TASK_KIND_EMAIL]: "Email",
  [TASK_KIND_BANNER]: "Graphic",
  [TASK_KIND_SOCIAL]: "Social",
  [TASK_KIND_VIDEO]: "Video",
};

function describeCalEntry(entry) {
  if (entry.kind === EVENT_KIND_SHOOT) {
    const shoot = entry.item.record;
    return `${describeShootCardLine(shoot)}${shoot.status === "complete" ? " · Complete" : ""}`;
  }
  if (isDayEntry(entry)) {
    return `Day ${entry.dayNumber} of ${entry.dayCount} · ${formatDateRange(entry.item.startDate, entry.item.endDate)}`;
  }
  return `${entry.label} · due ${formatTaskDate(entry.dueDate)}`;
}

function createCalEventChip(entry) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `dash-event cal-event--${isDayEntry(entry) ? "day" : "task"} cal-event--${entry.kind}${entry.done ? " is-done" : ""}`;
  applyItemColor(chip, entry.item);
  chip.title = `${entry.item.title} · ${describeCalEntry(entry)}`;
  // What the group highlight matches on.
  chip.dataset.taskId = entry.id;

  chip.appendChild(createCalEventIcon(entry.kind));

  const label = document.createElement("span");
  label.className = "dash-event-title";
  label.textContent = entry.item.chipLabel;
  chip.appendChild(label);

  const meta = document.createElement("span");
  meta.className = "dash-event-meta";
  meta.textContent = isDayEntry(entry)
    ? describeItemDay(entry.item, entry.dayNumber, entry.dayCount)
    : CAL_TASK_SHORT_LABELS[entry.kind] ?? entry.label;
  chip.appendChild(meta);

  // A chip selects just what it is — an event bar its whole event, a task
  // that one task — and opens the item's pane. Never the day under it.
  chip.addEventListener("click", e => {
    e.stopPropagation();
    selectCalGroup(isDayEntry(entry) ? getItemGroupIds(entry.item) : [entry.id], entry.item);
  });
  return chip;
}

// ── Multi-day bars ───────────────────────────────────────────────────────────
//
// A show, a campaign or a holiday that runs several days in a row is drawn as
// one connected bar, like a wall calendar: each week row gives every bar a
// lane (a fixed slot under the date), and a day the bar doesn't cover keeps
// that slot empty so the bars line up across the row. Tasks follow below.

/** Which bar a value belongs to: an item's days, or a holiday. */
function getCalBarKey(value) {
  return value.item ? `i|${value.item.type}|${value.item.id}` : `h|${value.id}`;
}

/** Does the bar named `key` cover `dayYmd`? (after the filters) */
function calBarCovers(key, dayYmd, byDate) {
  if (key.startsWith("h|")) return getHolidaysOn(dayYmd).some(h => `h|${h.id}` === key);
  return (byDate.get(dayYmd) ?? []).some(e => isDayEntry(e) && getCalBarKey(e) === key);
}

/**
 * Lanes for one week row: lanes[l][i] is what sits in lane l on day i
 * ({ key, value, start, end } — the run it belongs to), or null. Runs that
 * start earlier come first, then longer ones, then holidays, then by name.
 */
function buildCalWeekLanes(ymds, byDate) {
  const bars = new Map(); // key → { label, days: value per day index }
  ymds.forEach((dayYmd, i) => {
    const values = [
      ...getHolidaysOn(dayYmd),
      ...(byDate.get(dayYmd) ?? []).filter(isDayEntry),
    ];
    values.forEach(value => {
      const key = getCalBarKey(value);
      if (!bars.has(key)) bars.set(key, { label: value.item ? value.item.chipLabel : value.name, days: [] });
      bars.get(key).days[i] = value;
    });
  });

  // Each bar's runs of consecutive days within the row.
  const runs = [];
  bars.forEach((bar, key) => {
    let run = null;
    for (let i = 0; i < ymds.length; i++) {
      if (!bar.days[i]) continue;
      if (run && run.end === i - 1) run.end = i;
      else { run = { key, bar, start: i, end: i }; runs.push(run); }
    }
  });
  runs.sort((a, b) =>
    a.start - b.start ||
    (b.end - b.start) - (a.end - a.start) ||
    (a.key.startsWith("h|") ? 0 : 1) - (b.key.startsWith("h|") ? 0 : 1) ||
    a.bar.label.localeCompare(b.bar.label));

  const lanes = [];
  runs.forEach(run => {
    let lane = lanes.findIndex(row => row.slice(run.start, run.end + 1).every(slot => !slot));
    if (lane === -1) { lane = lanes.length; lanes.push(Array(ymds.length).fill(null)); }
    for (let i = run.start; i <= run.end; i++) {
      lanes[lane][i] = { key: run.key, value: run.bar.days[i], start: run.start, end: run.end };
    }
  });
  return lanes;
}

/** One lane's piece of a bar on day `i`, shaped to join its neighbours. */
function createCalBarChip(slot, i, ymds, byDate) {
  const dayYmd = ymds[i];
  const chip = slot.key.startsWith("h|")
    ? createCalHolidayChip(slot.value)
    : createCalEventChip(slot.value);

  // Every piece of the bar answers to hover together (initCalendar).
  chip.dataset.bar = slot.key;

  const day = parseYmd(dayYmd);
  const joinsLeft = i > slot.start || calBarCovers(slot.key, ymd(addDays(day, -1)), byDate);
  const joinsRight = i < slot.end || calBarCovers(slot.key, ymd(addDays(day, 1)), byDate);
  if (joinsLeft || joinsRight) chip.classList.add("is-span");
  if (joinsLeft) chip.classList.add("is-join-left");
  if (joinsRight) chip.classList.add("is-join-right");
  // The row's first piece carries the name, written across the whole run.
  if (i === slot.start) {
    chip.classList.add("is-span-head");
    chip.style.setProperty("--span-days", String(slot.end - i + 1));
  }
  return chip;
}

/** Keeps an empty lane's height, so the bars below it stay lined up. */
function createCalLaneGap() {
  const gap = document.createElement("span");
  gap.className = "dash-event dash-cal-lane-gap";
  gap.setAttribute("aria-hidden", "true");
  gap.textContent = "\u00a0";
  return gap;
}

/** The seven cells of one week row, starting on `weekStart` (a Sunday). */
function buildCalWeekCells(weekStart, byDate, today) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const ymds = dates.map(date => ymd(date));
  const lanes = buildCalWeekLanes(ymds, byDate);
  return dates.map((date, i) => buildCalCell(date, byDate, today, { lanes, i, ymds }));
}

function buildCalCell(date, byDate, today, week) {
  const cellYmd = ymd(date);
  const cell = document.createElement("div");
  cell.className = "dash-cal-cell";
  cell.dataset.ymd = cellYmd;
  if (isWeekend(date)) cell.classList.add("is-weekend");
  if (cellYmd === today) cell.classList.add("is-today");
  if (cellYmd === calSelectedYmd) cell.classList.add("is-selected");

  if (cellYmd < today) cell.classList.add("is-past");
  cell.dataset.month = `${date.getFullYear()}-${date.getMonth()}`;

  // Every day reads M/D, so the month is never in doubt; today says so too.
  const dateRow = document.createElement("span");
  dateRow.className = "dash-cal-date";
  if (date.getDate() === 1) {
    cell.classList.add("is-month-start");
    calMonthAnchors[cell.dataset.month] = cell;
  }
  const num = document.createElement("span");
  num.className = "dash-cal-num";
  num.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
  dateRow.appendChild(num);
  if (cellYmd === today) {
    const todayLabel = document.createElement("span");
    todayLabel.className = "dash-cal-today-label";
    todayLabel.textContent = "Today";
    dateRow.appendChild(todayLabel);
  }
  cell.appendChild(dateRow);

  if (getHolidaysOn(cellYmd).length) cell.classList.add("is-holiday");

  const entries = byDate.get(cellYmd) ?? [];

  // The bars first, each in its lane (an empty lane keeps its height, up to
  // the last bar on this day), then the day's tasks.
  const { lanes, i } = week;
  let lastLane = -1;
  lanes.forEach((row, lane) => { if (row[i]) lastLane = lane; });
  for (let lane = 0; lane <= lastLane; lane++) {
    const slot = lanes[lane][i];
    cell.appendChild(slot ? createCalBarChip(slot, i, week.ymds, byDate) : createCalLaneGap());
  }
  entries.filter(entry => !isDayEntry(entry)).forEach(entry => cell.appendChild(createCalEventChip(entry)));

  if (entries.length > 0) {
    const more = document.createElement("span");
    more.className = "dash-cal-more";
    more.hidden = true;
    cell.appendChild(more);

    cell.classList.add("has-events");
    cell.addEventListener("click", () => selectCalDay(cellYmd));
    applyCalCellOverflow(cell);
  } else {
    // An empty day has nothing to open, so clicking it puts the open one away.
    cell.addEventListener("click", () => {
      if (calSelectedYmd) closeCalDayPane();
    });
  }

  return cell;
}

/**
 * Decide which of a cell's chips show. They keep their order — bars in their
 * lanes, then tasks — whatever is selected. The first CAL_MAX_EVENTS slots
 * show (an empty lane counts, so bars stay lined up), and the counter only
 * appears when it would hide more than one.
 */
function applyCalCellOverflow(cell) {
  const slots = [...cell.querySelectorAll(".dash-event")];
  if (slots.length === 0) return;

  // Week cells are tall and scroll on their own, so nothing is capped there.
  const cap = calViewMode === "week" ? slots.length : CAL_MAX_EVENTS;
  const collapse = slots.length > cap + 1;
  slots.forEach((slot, i) => { slot.hidden = collapse && i >= cap; });

  const hidden = slots.filter(slot => slot.hidden && !slot.classList.contains("dash-cal-lane-gap")).length;
  const more = cell.querySelector(".dash-cal-more");
  if (more) {
    more.hidden = hidden === 0;
    more.textContent = `+${hidden} more`;
  }
}

function sizeCalRows() {
  if (!calScrollEl) return;
  // Drawn while Home isn't showing (data loading in the background) there's
  // nothing to measure; the size watcher (initCalendar) sizes it once it shows.
  if (!calScrollEl.clientHeight) return;
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
  body.append(...buildCalWeekCells(getCalWeekStart(), byDate, today));
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
  // The range runs Sunday to Saturday, so it splits into whole weeks.
  for (let d = new Date(start); d <= end; d = addDays(d, 7)) {
    body.append(...buildCalWeekCells(d, byDate, today));
  }
  scroll.appendChild(body);
  grid.appendChild(scroll);

  calScrollEl = scroll;
  applyCalMonthFocus();
  scroll.addEventListener("scroll", onCalScroll, { passive: true });
  sizeCalRows();
  scrollCalToDate(getCalTopYmd(), { instant: true });
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
 * The items with anything on `dayYmd` — running that day, or a task due.
 * Kind filter only: the pane has its own Completed tab, so hiding finished
 * work here would empty the tab that exists to show it.
 */
function buildDayPaneEntries(dayYmd) {
  const entries = [];
  getAllScheduleItems().forEach(item => {
    const running = isCalItemShown(item) && isActiveDay(item, dayYmd);
    const dayTasks = item.tasks.filter(t => t.dueDate === dayYmd && isCalTaskShown(item, t));
    if (!running && dayTasks.length === 0) return;

    entries.push({
      item,
      dayTasks,
      taskIds: getItemGroupIds(item),
      // A day with no task due has nothing to finish, so it stays open —
      // except a shoot, which is finished when it's marked complete.
      done: item.type === ITEM_TYPE_PHOTOSHOOT
        ? isItemComplete(item)
        : dayTasks.length > 0 && dayTasks.every(t => isTaskComplete(t.id)),
      openCount: dayTasks.filter(t => !isTaskComplete(t.id)).length,
    });
  });
  return entries.sort((a, b) => a.item.startDate.localeCompare(b.item.startDate));
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

  const entries = buildDayPaneEntries(calSelectedYmd);
  const open = entries.filter(entry => !entry.done);
  const done = entries.filter(entry => entry.done);

  // What's left to do on this day.
  const openTaskCount = entries.reduce((n, entry) => n + entry.openCount, 0);
  const count = document.getElementById("calDayPaneCount");
  if (count) count.textContent = openTaskCount ? String(openTaskCount) : "";

  renderDayPaneTabs({ open: open.length, done: done.length });

  const body = document.getElementById("calDayPaneList");
  if (!body) return;

  const shown = calDayPaneTab === "done" ? done : open;
  if (shown.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dash-empty";
    empty.textContent = entries.length === 0
      ? "Nothing on this day."
      : calDayPaneTab === "done" ? "Nothing completed yet." : "All done for this day.";
    body.replaceChildren(empty);
    return;
  }

  body.replaceChildren(...shown.map(entry => {
    // Only what's due on this day, not the item's whole task list.
    const card = createScheduleCard(entry.item, { tasks: entry.dayTasks, emptyText: "No tasks due this day." });
    attachCalGroupSelection(card, entry.taskIds, entry.item);
    return card;
  }));
  applyCalGroupSelection();
}

// ── Filter bar ───────────────────────────────────────────────────────────────
//
// Three type buttons — Campaign, Trade Show, Photoshoot — switch each type on
// and off. The Filters button opens the detail: a checkbox list per type with
// what's under it, and Show completed.

function applyCalFilterChange() {
  renderCalFilterBar();
  renderCalendarGrid();
  renderCalDayPane();
  renderUpcomingTasks();
}

function setCalTypeOn(key, on) {
  if (on) calTypeOn.add(key);
  else calTypeOn.delete(key);
  applyCalFilterChange();
}

function setCalSubOn(typeKey, subKey, on) {
  const subs = calSubOn[typeKey];
  if (on) {
    subs.add(subKey);
    // Ticking something under a type that's off brings the type back.
    calTypeOn.add(typeKey);
  } else {
    subs.delete(subKey);
  }
  applyCalFilterChange();
}

function resetCalFilters() {
  calTypeOn = new Set(CAL_TYPE_FILTERS.map(t => t.key));
  calSubOn = Object.fromEntries(CAL_TYPE_FILTERS.map(t => [t.key, new Set(t.subs.map(sub => sub.key))]));
  calShowCompleted = false;
  applyCalFilterChange();
}

/** Anything narrowed inside the Filters menu (the type buttons show their own). */
function isCalAdvancedFilterSet() {
  return calShowCompleted || CAL_TYPE_FILTERS.some(t => calSubOn[t.key].size < t.subs.length);
}

function isCalFilterDefault() {
  return !isCalAdvancedFilterSet() && calTypeOn.size === CAL_TYPE_FILTERS.length;
}

let calFilterMenuOpen = false;

function makeCalFilterBtn(label, active, onClick, extraClass = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cal-filter-btn" + (active ? " is-active" : "") + (extraClass ? " " + extraClass : "");
  btn.textContent = label;
  btn.setAttribute("aria-pressed", active ? "true" : "false");
  btn.addEventListener("click", onClick);
  return btn;
}

function makeCalCheck(label, checked, onChange, extraClass = "") {
  const row = document.createElement("label");
  row.className = "cal-adv-check" + (extraClass ? " " + extraClass : "");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const text = document.createElement("span");
  text.textContent = label;
  row.append(input, text);
  return row;
}

function renderCalFilterBar() {
  const bar = document.getElementById("calFilterBar");
  if (!bar) return;
  bar.classList.toggle("is-open", calFilterMenuOpen);

  // The three types, each its own button.
  const types = document.createElement("div");
  types.className = "cal-type-group";
  types.setAttribute("role", "group");
  types.setAttribute("aria-label", "Show on the calendar");
  CAL_TYPE_FILTERS.forEach(type => {
    const on = calTypeOn.has(type.key);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cal-type-btn" + (on ? " is-on" : "");
    btn.dataset.kind = type.key;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    const dot = document.createElement("span");
    dot.className = "cal-type-dot";
    dot.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = type.label;
    btn.append(dot, text);
    btn.addEventListener("click", () => setCalTypeOn(type.key, !on));
    types.appendChild(btn);
  });

  // Filters: the detail, in a menu.
  const wrap = document.createElement("div");
  wrap.className = "cal-adv-wrap";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cal-adv-trigger" + (isCalAdvancedFilterSet() ? " is-set" : "");
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", calFilterMenuOpen ? "true" : "false");
  trigger.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/></svg><span>Filters</span>';
  trigger.title = "More filters";
  trigger.addEventListener("click", e => {
    e.stopPropagation();
    calFilterMenuOpen = !calFilterMenuOpen;
    renderCalFilterBar();
  });

  const menu = document.createElement("div");
  menu.className = "cal-adv-menu";
  menu.hidden = !calFilterMenuOpen;
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Filter calendar");
  menu.addEventListener("click", e => e.stopPropagation());

  const cols = document.createElement("div");
  cols.className = "cal-adv-cols";
  CAL_TYPE_FILTERS.forEach(type => {
    const typeOn = calTypeOn.has(type.key);
    const col = document.createElement("div");
    col.className = "cal-adv-col" + (typeOn ? "" : " is-off");
    col.dataset.kind = type.key;
    col.appendChild(makeCalCheck(type.label, typeOn, on => setCalTypeOn(type.key, on), "cal-adv-check--type"));
    const list = document.createElement("div");
    list.className = "cal-adv-subs";
    type.subs.forEach(sub => {
      list.appendChild(makeCalCheck(sub.label, typeOn && calSubOn[type.key].has(sub.key),
        on => setCalSubOn(type.key, sub.key, on)));
    });
    col.appendChild(list);
    cols.appendChild(col);
  });

  const foot = document.createElement("div");
  foot.className = "cal-adv-foot";
  foot.appendChild(makeCalCheck("Show completed", calShowCompleted, on => {
    calShowCompleted = on;
    applyCalFilterChange();
  }, "cal-adv-check--completed"));
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "cal-adv-reset";
  reset.textContent = "Reset";
  reset.disabled = isCalFilterDefault();
  reset.addEventListener("click", resetCalFilters);
  foot.appendChild(reset);

  menu.append(cols, foot);
  wrap.append(trigger, menu);
  bar.replaceChildren(types, wrap);
  // Opens leftward from its button, unless that would run off the page.
  if (calFilterMenuOpen && menu.getBoundingClientRect().left < 8) menu.classList.add("is-flipped");
  applyCalChipStyle();

  renderCalViewToggle();
  renderCalTodayButton();
}

function renderCalViewToggle() {
  const group = document.getElementById("calViewToggle");
  if (!group) return;
  group.replaceChildren(...CAL_VIEW_MODES.map(mode => {
    const btn = makeCalFilterBtn(mode.label, calViewMode === mode.key, () => setCalViewMode(mode.key), "cal-view-btn");
    btn.dataset.view = mode.key;
    return btn;
  }));
}

/** The jump-to-today button names today, e.g. "Thu, Oct 8". */
function renderCalTodayButton() {
  const btn = document.getElementById("calToday");
  if (!btn) return;
  btn.textContent = formatTaskDate(todayYmd());
  btn.title = "Go to today";
}

// ── Upcoming tasks rail ──────────────────────────────────────────────────────

/** How far either side of today the rail looks. */
const CAL_UPCOMING_DAYS = 45;

/**
 * One card per item with something inside the window — a task due, or the
 * item itself running — plus any item with a missed task, however long ago:
 * overdue work doesn't age out of the list just because it's old.
 *
 * The kind filter narrows which tasks a card buckets on and shows, so
 * picking "Graphics" turns the rail into a graphics to-do list.
 */
function buildUpcomingCardEntries() {
  const from = ymd(addDays(new Date(), -CAL_UPCOMING_DAYS));
  const to = ymd(addDays(new Date(), CAL_UPCOMING_DAYS));

  return getAllScheduleItems()
    .filter(item => {
      const taskInWindow = getVisibleItemTasks(item)
        .some(t => (t.dueDate >= from && t.dueDate <= to) || isTaskOverdue(t));
      const runningInWindow = isCalItemShown(item) &&
        item.endDate >= from && item.startDate <= to &&
        listActiveDays(item).some(day => day >= from && day <= to);
      return taskInWindow || runningInWindow;
    })
    .map(item => ({
      item,
      taskIds: getItemGroupIds(item),
      buckets: item.type === ITEM_TYPE_PHOTOSHOOT
        ? getShootStatusBuckets(item)
        : getTaskStatusBuckets(item.tasks.filter(t => isCalTaskShown(item, t))),
    }))
    .sort((a, b) => a.item.startDate.localeCompare(b.item.startDate));
}

/**
 * A shoot has no tasks to bucket on, so its status decides instead: planned
 * and still ahead is Upcoming, planned but already past is Overdue (it never
 * got marked complete), and complete is Completed. No rows either way.
 */
function getShootStatusBuckets(item) {
  if (isItemComplete(item)) return { completed: [] };
  return item.startDate < todayYmd() ? { overdue: [] } : { upcoming: [] };
}

/** Which status tab the Home rail is showing. */
let homeTaskStatus = "upcoming";

function renderUpcomingTasks() {
  const list = document.getElementById("upcomingTasksList");
  if (!list) return;

  const all = buildUpcomingCardEntries();
  // An item can count toward more than one tab — see getTaskStatusBuckets.
  const counts = { upcoming: 0, overdue: 0, completed: 0 };
  all.forEach(e => Object.keys(e.buckets).forEach(key => { counts[key] += 1; }));

  renderTaskStatusTabs("homeTaskTabs", homeTaskStatus, counts, key => {
    homeTaskStatus = key;
    renderUpcomingTasks();
  });

  const shown = all.filter(e => e.buckets[homeTaskStatus]);
  const count = document.getElementById("upcomingTasksCount");
  if (count) count.textContent = shown.length ? String(shown.length) : "";

  if (shown.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dash-empty";
    empty.textContent = getAllScheduleItems().length === 0
      ? "Nothing scheduled yet — add a campaign, a trade show or a photoshoot to get started."
      : `Nothing ${homeTaskStatus}.`;
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...shown.map(entry => {
    const card = createScheduleCard(entry.item, { tasks: entry.buckets[homeTaskStatus] });
    attachCalGroupSelection(card, entry.taskIds, entry.item);
    return card;
  }));
}

// ── Entry points ─────────────────────────────────────────────────────────────

function renderCalendar() {
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

  // Hovering any day of a bar lights up the whole bar, every day it runs.
  const grid = document.getElementById("calGrid");
  const setBarHover = (key, on) => {
    grid.querySelectorAll(".dash-event[data-bar]").forEach(piece => {
      if (piece.dataset.bar === key) piece.classList.toggle("is-bar-hover", on);
    });
  };
  grid?.addEventListener("mouseover", e => {
    const piece = e.target.closest?.(".dash-event[data-bar]");
    if (piece && !piece.contains(e.relatedTarget)) setBarHover(piece.dataset.bar, true);
  });
  grid?.addEventListener("mouseout", e => {
    const piece = e.target.closest?.(".dash-event[data-bar]");
    if (piece && !piece.contains(e.relatedTarget)) setBarHover(piece.dataset.bar, false);
  });

  document.getElementById("headerMenuClassicChips")?.addEventListener("click", () => {
    setCalChipStyle(calChipStyle === "classic" ? "solid" : "classic");
  });

  // A filter menu opened by click closes on the next click elsewhere, or Escape.
  const closeFilterMenu = () => {
    if (!calFilterMenuOpen) return;
    calFilterMenuOpen = false;
    renderCalFilterBar();
  };
  document.addEventListener("click", e => {
    if (!e.target.closest("#calFilterBar")) closeFilterMenu();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeFilterMenu();
  });

  // The month rows fit five weeks to the height showing, so they're re-measured
  // whenever that changes: the window resizing, the day pane opening, and Home
  // coming into view after the calendar was drawn while hidden (which measured
  // nothing and left the rows short, bars spilling into the next week).
  const resize = () => {
    if (!calScrollEl?.clientHeight) return;
    sizeCalRows();
    // Resizing the rows moves every week's position; without re-anchoring,
    // the scroll handler reads whatever week drifted into view and the
    // calendar jumps away from the one you were on.
    if (calViewMode === "month") scrollCalToDate(getCalTopYmd(), { instant: true });
  };
  const calBox = document.getElementById("calGrid");
  if (calBox && "ResizeObserver" in window) {
    let lastH = -1;
    new ResizeObserver(() => {
      const h = calBox.clientHeight;
      if (h === lastH) return; // only the height sets the rows
      lastH = h;
      resize();
    }).observe(calBox);
  }
  window.addEventListener("resize", () => {
    if (getCurrentAppView() === "home") resize();
  });
}
