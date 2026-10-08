/**
 * Calendar — every campaign and trade show, and every task, on the day it lands.
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

/** Every kind the filter knows about — used to tell "all on" from "narrowed". */
const CAL_KINDS = [EVENT_KIND_SHOW, EVENT_KIND_CAMPAIGN, TASK_KIND_EMAIL, TASK_KIND_BANNER, TASK_KIND_SOCIAL];

/** Which kinds are shown. All on by default. */
let calFilterSelection = new Set(CAL_KINDS);

/**
 * Tasks of an item whose every task is done are hidden by default; the filter
 * bar opts back into them. The days themselves always show — they're events,
 * not work to finish.
 */
let calShowCompleted = false;

function areTasksHiddenAsCompleted(item) {
  return !calShowCompleted && isItemComplete(item);
}

/** The item's tasks that pass the kind filter and the completed toggle. */
function getVisibleItemTasks(item) {
  if (areTasksHiddenAsCompleted(item)) return [];
  return item.tasks.filter(task => calFilterSelection.has(task.kind));
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

function selectCalGroup(taskIds) {
  // Clicking the selected card again clears it.
  if (isCalGroupSelected(taskIds) && calSelectedTaskIds.size === taskIds.length) {
    calSelectedTaskIds = new Set();
  } else {
    calSelectedTaskIds = new Set(taskIds);
  }
  applyCalGroupSelection();
}

/** Paint the selection across both the grid chips and the cards. */
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
 * Make a card selectable, wiring it to the shared highlight state. The ids
 * live on the element as a real array — they contain "|" as a separator, so
 * a joined data attribute would shred them.
 */
function attachCalGroupSelection(card, taskIds) {
  card.groupTaskIds = taskIds;
  card.classList.add("is-selectable");
  card.classList.toggle("is-selected", isCalGroupSelected(taskIds));
  card.addEventListener("click", e => {
    // Checkboxes and the show name keep their own behaviour.
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

/**
 * Everything one item puts on the calendar, after the filters: a chip per day
 * it runs, and a chip per task on its due date. Each entry carries its item.
 */
function buildItemCalendarEntries(item) {
  const entries = [];
  if (calFilterSelection.has(item.dayKind)) {
    buildItemDayEvents(item).forEach(event => entries.push({ ...event, done: false, item }));
  }
  getVisibleItemTasks(item).forEach(task => entries.push({ ...task, done: isTaskComplete(task.id), item }));
  return entries;
}

function isDayEntry(entry) {
  return entry.kind === EVENT_KIND_SHOW || entry.kind === EVENT_KIND_CAMPAIGN;
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
  [TASK_KIND_BANNER]: "Banner",
  [TASK_KIND_SOCIAL]: "Social",
};

function describeCalEntry(entry) {
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

  // Open the day, then select the item this chip belongs to.
  chip.addEventListener("click", e => {
    e.stopPropagation();
    if (calSelectedYmd !== entry.dueDate) selectCalDay(entry.dueDate);
    selectCalGroup(getItemGroupIds(entry.item));
    renderCalDayPane();
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

  const entries = byDate.get(cellYmd) ?? [];

  // How many tasks are still open on this day, at a glance.
  const openCount = entries.filter(entry => !isDayEntry(entry) && !entry.done).length;
  if (openCount > 0) {
    const badge = document.createElement("span");
    badge.className = "dash-cal-open-count";
    badge.textContent = String(openCount);
    badge.title = `${openCount} still open`;
    cell.appendChild(badge);
  }

  // Every chip is rendered; which ones actually show is decided by
  // applyCalCellOverflow, so selecting a show can reveal one that was
  // sitting inside "+N more" without rebuilding the grid.
  entries.forEach(entry => cell.appendChild(createCalEventChip(entry)));

  if (entries.length > 0) {
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
 * Order a cell's chips and decide which are visible: selected before
 * unselected, and within each, still-open before done. Selected chips are
 * always shown; the rest fill the room up to CAL_MAX_EVENTS, and the counter
 * only appears when it would hide more than one.
 */
function applyCalCellOverflow(cell) {
  const chips = [...cell.querySelectorAll(".dash-event")];
  if (chips.length === 0) return;

  const isSelected = chip => calSelectedTaskIds.has(chip.dataset.taskId);
  const rank = chip => (isSelected(chip) ? 0 : 2) + (chip.classList.contains("is-done") ? 1 : 0);

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
    const running = calFilterSelection.has(item.dayKind) && isActiveDay(item, dayYmd);
    const dayTasks = item.tasks.filter(t => t.dueDate === dayYmd && calFilterSelection.has(t.kind));
    if (!running && dayTasks.length === 0) return;

    entries.push({
      item,
      taskIds: getItemGroupIds(item),
      // A day with no task due has nothing to finish, so it stays open.
      done: dayTasks.length > 0 && dayTasks.every(t => isTaskComplete(t.id)),
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

  // What's left to do on this day, matching the badge on the calendar cell.
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
    const card = createScheduleCard(entry.item);
    attachCalGroupSelection(card, entry.taskIds);
    return card;
  }));
  applyCalGroupSelection();
}

// ── Filter bar ───────────────────────────────────────────────────────────────
//
// "All" is the resting state. Picking a kind narrows to just that one, and
// picking it again releases back to All.

const CAL_FILTER_OPTIONS = [
  { key: EVENT_KIND_CAMPAIGN, label: "Campaigns" },
  { key: EVENT_KIND_SHOW, label: "Trade Shows" },
  { key: TASK_KIND_EMAIL, label: "Emails" },
  { key: TASK_KIND_BANNER, label: "Banners" },
  { key: TASK_KIND_SOCIAL, label: "Social Media" },
];

function isCalFilterShowingAll() {
  return calFilterSelection.size === CAL_KINDS.length;
}

function setCalFilterAll() {
  calFilterSelection = new Set(CAL_KINDS);
  applyCalFilterChange();
}

function toggleCalFilterKind(key) {
  const onlyThisKind = !isCalFilterShowingAll() &&
                       calFilterSelection.size === 1 &&
                       calFilterSelection.has(key);
  calFilterSelection = onlyThisKind ? new Set(CAL_KINDS) : new Set([key]);
  applyCalFilterChange();
}

function applyCalFilterChange() {
  renderCalFilterBar();
  renderCalendarGrid();
  renderCalDayPane();
  renderUpcomingTasks();
}

/**
 * The filter bar collapses to one button naming the current filter ("All"
 * unless narrowed). Hovering it — or clicking, for touch — drops the full
 * set of options below it. Kept open by click until a click lands elsewhere.
 */
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

/** The label the collapsed button shows: "All", or the one kind picked. */
function getCalFilterLabel() {
  if (isCalFilterShowingAll()) return "All";
  return CAL_FILTER_OPTIONS.find(option => calFilterSelection.has(option.key))?.label ?? "All";
}

function renderCalFilterBar() {
  const bar = document.getElementById("calFilterBar");
  if (!bar) return;
  bar.classList.toggle("is-open", calFilterMenuOpen);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cal-filter-btn cal-filter-trigger is-active";
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", calFilterMenuOpen ? "true" : "false");
  if (!isCalFilterShowingAll()) trigger.dataset.kind = [...calFilterSelection][0];
  trigger.textContent = getCalFilterLabel();
  if (calShowCompleted) {
    // Completed work is on — worth a hint even while the menu is shut.
    const flag = document.createElement("span");
    flag.className = "cal-filter-trigger-flag";
    flag.title = "Showing completed";
    trigger.appendChild(flag);
  }
  trigger.addEventListener("click", e => {
    e.stopPropagation();
    calFilterMenuOpen = !calFilterMenuOpen;
    renderCalFilterBar();
  });

  const menu = document.createElement("div");
  menu.className = "cal-filter-menu";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Filter calendar");

  const all = makeCalFilterBtn("All", isCalFilterShowingAll(), setCalFilterAll);
  const kinds = CAL_FILTER_OPTIONS.map(option => {
    const active = !isCalFilterShowingAll() && calFilterSelection.has(option.key);
    const btn = makeCalFilterBtn(option.label, active, () => toggleCalFilterKind(option.key));
    btn.dataset.kind = option.key;
    return btn;
  });
  const showCompleted = makeCalFilterBtn("Show completed", calShowCompleted, () => {
    calShowCompleted = !calShowCompleted;
    applyCalFilterChange();
  }, "cal-filter-btn--completed");

  menu.append(all, ...kinds, showCompleted);
  bar.replaceChildren(trigger, menu);

  renderCalViewToggle();
  renderCalTodayButton();
}

/** Month / Week, on the header's right. */
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
 * picking "Banners" turns the rail into a banner to-do list.
 */
function buildUpcomingCardEntries() {
  const from = ymd(addDays(new Date(), -CAL_UPCOMING_DAYS));
  const to = ymd(addDays(new Date(), CAL_UPCOMING_DAYS));

  return getAllScheduleItems()
    .filter(item => {
      const taskInWindow = getVisibleItemTasks(item)
        .some(t => (t.dueDate >= from && t.dueDate <= to) || isTaskOverdue(t));
      const runningInWindow = calFilterSelection.has(item.dayKind) &&
        item.endDate >= from && item.startDate <= to &&
        listActiveDays(item).some(day => day >= from && day <= to);
      return taskInWindow || runningInWindow;
    })
    .map(item => ({
      item,
      taskIds: getItemGroupIds(item),
      buckets: getTaskStatusBuckets(item.tasks.filter(t => calFilterSelection.has(t.kind))),
    }))
    .sort((a, b) => a.item.startDate.localeCompare(b.item.startDate));
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
      ? "Nothing scheduled yet — add a campaign or a trade show to get started."
      : `Nothing ${homeTaskStatus}.`;
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...shown.map(entry => {
    const card = createScheduleCard(entry.item, { tasks: entry.buckets[homeTaskStatus] });
    attachCalGroupSelection(card, entry.taskIds);
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

  window.addEventListener("resize", () => {
    if (getCurrentAppView() !== "home") return;
    sizeCalRows();
    // Resizing the rows moves every week's position; without re-anchoring,
    // the scroll handler reads whatever week drifted into view and the
    // calendar jumps away from the one you were on.
    if (calViewMode === "month") scrollCalToDate(getCalTopYmd(), { instant: true });
  });
}
