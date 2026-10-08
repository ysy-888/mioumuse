/**
 * Calendar — every trade show and every email task, on the day it lands.
 *
 * A continuously scrolling month grid (or a single week) with a day pane that
 * opens beside it. A show appears on each day it runs; its emails appear on
 * their due dates. Selecting a show lights up all of it at once — the show
 * days and the three emails leading up to them.
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
let calSelectedYmd = "";       // day whose pane is open
let calScrollEl = null;
let calMonthAnchors = {};
let calScrollRaf = 0;

/** Every kind the filter knows about — used to tell "all on" from "narrowed". */
const CAL_KINDS = [EVENT_KIND_SHOW, TASK_KIND_EMAIL];

/** Which kinds are shown. All on by default. */
let calFilterSelection = new Set(CAL_KINDS);

/**
 * Emails for a show whose every email is done are hidden by default; the
 * filter bar opts back into them. The show days themselves always show —
 * they're events, not work to finish.
 */
let calShowCompleted = false;

function isEmailHiddenAsCompleted(tradeShow) {
  return !calShowCompleted && isTradeShowComplete(tradeShow);
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

/** Everything one show puts on the calendar, after the kind filter. */
function buildShowCalendarItems(tradeShow) {
  const items = [];
  if (calFilterSelection.has(EVENT_KIND_SHOW)) {
    buildTradeShowDayEvents(tradeShow).forEach(event => items.push({ ...event, done: false }));
  }
  if (calFilterSelection.has(TASK_KIND_EMAIL) && !isEmailHiddenAsCompleted(tradeShow)) {
    buildTradeShowEmailTasks(tradeShow).forEach(task => items.push({ ...task, done: isTaskComplete(task.id) }));
  }
  return items.map(item => ({ ...item, tradeShow }));
}

/** ymd → item[] for the visible range, after filters. */
function buildCalEventsByDate() {
  const { start, end } = getCalRange();
  const from = ymd(start);
  const to = ymd(end);
  const byDate = new Map();

  getAllTradeShows().forEach(tradeShow => {
    buildShowCalendarItems(tradeShow).forEach(item => {
      if (item.dueDate < from || item.dueDate > to) return;
      if (!byDate.has(item.dueDate)) byDate.set(item.dueDate, []);
      byDate.get(item.dueDate).push(item);
    });
  });

  // Show days first — they frame the day — then emails, each by show name.
  byDate.forEach(items => items.sort((a, b) =>
    (a.kind === EVENT_KIND_SHOW ? 0 : 1) - (b.kind === EVENT_KIND_SHOW ? 0 : 1) ||
    getTradeShowLabel(a.tradeShow.show).localeCompare(getTradeShowLabel(b.tradeShow.show))));
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

function describeCalItem(item) {
  if (item.kind === EVENT_KIND_SHOW) {
    return `Day ${item.dayNumber} of ${item.dayCount} · ${formatDateRange(item.tradeShow.startDate, item.tradeShow.endDate)}`;
  }
  return `${item.label} · due ${formatTaskDate(item.dueDate)}`;
}

function createCalEventChip(item) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `dash-event cal-event--${item.kind}${item.done ? " is-done" : ""}`;
  chip.dataset.show = item.tradeShow.show;
  chip.title = `${getTradeShowTitle(item.tradeShow)} · ${describeCalItem(item)}`;
  // What the group highlight matches on.
  chip.dataset.taskId = item.id;

  chip.appendChild(createCalEventIcon(item.kind));

  const label = document.createElement("span");
  label.className = "dash-event-title";
  label.textContent = getTradeShowLabel(item.tradeShow.show);
  chip.appendChild(label);

  const meta = document.createElement("span");
  meta.className = "dash-event-meta";
  meta.textContent = item.kind === EVENT_KIND_SHOW ? `Day ${item.dayNumber}` : "Email";
  chip.appendChild(meta);

  // Open the day, then select the show this chip belongs to.
  chip.addEventListener("click", e => {
    e.stopPropagation();
    if (calSelectedYmd !== item.dueDate) selectCalDay(item.dueDate);
    selectCalGroup(getTradeShowGroupIds(item.tradeShow));
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

  const items = byDate.get(cellYmd) ?? [];

  // How many emails are still open on this day, at a glance.
  const openCount = items.filter(item => item.kind === TASK_KIND_EMAIL && !item.done).length;
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
  items.forEach(item => cell.appendChild(createCalEventChip(item)));

  if (items.length > 0) {
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
 * The shows with anything on `dayYmd` — running that day, or an email due.
 * Kind filter only: the pane has its own Completed tab, so hiding finished
 * work here would empty the tab that exists to show it.
 */
function buildDayPaneEntries(dayYmd) {
  const entries = [];
  getAllTradeShows().forEach(tradeShow => {
    const running = calFilterSelection.has(EVENT_KIND_SHOW) &&
      tradeShow.startDate <= dayYmd && dayYmd <= tradeShow.endDate;
    const dayTasks = calFilterSelection.has(TASK_KIND_EMAIL)
      ? buildTradeShowEmailTasks(tradeShow).filter(t => t.dueDate === dayYmd)
      : [];
    if (!running && dayTasks.length === 0) return;

    entries.push({
      tradeShow,
      taskIds: getTradeShowGroupIds(tradeShow),
      // A show day with no email due has nothing to finish, so it stays open.
      done: dayTasks.length > 0 && dayTasks.every(t => isTaskComplete(t.id)),
      openCount: dayTasks.filter(t => !isTaskComplete(t.id)).length,
    });
  });
  return entries.sort((a, b) => a.tradeShow.startDate.localeCompare(b.tradeShow.startDate));
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
    const card = createTradeShowCard(entry.tradeShow);
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
  { key: EVENT_KIND_SHOW, label: "Trade Shows" },
  { key: TASK_KIND_EMAIL, label: "Emails" },
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

/** How far either side of today the rail looks. */
const CAL_UPCOMING_DAYS = 45;

/**
 * One card per show with something inside the window — an email due, or the
 * show itself running — plus any show with a missed email, however long ago:
 * overdue work doesn't age out of the list just because it's old.
 */
function buildUpcomingCardEntries() {
  const from = ymd(addDays(new Date(), -CAL_UPCOMING_DAYS));
  const to = ymd(addDays(new Date(), CAL_UPCOMING_DAYS));

  return getAllTradeShows()
    .filter(tradeShow => {
      const emails = buildTradeShowEmailTasks(tradeShow);
      const emailsShown = calFilterSelection.has(TASK_KIND_EMAIL) && !isEmailHiddenAsCompleted(tradeShow);
      const emailInWindow = emailsShown &&
        emails.some(t => (t.dueDate >= from && t.dueDate <= to) || isTaskOverdue(t));
      const showInWindow = calFilterSelection.has(EVENT_KIND_SHOW) &&
        tradeShow.endDate >= from && tradeShow.startDate <= to;
      return emailInWindow || showInWindow;
    })
    .map(tradeShow => ({
      tradeShow,
      taskIds: getTradeShowGroupIds(tradeShow),
      buckets: getTaskStatusBuckets(buildTradeShowEmailTasks(tradeShow)),
    }))
    .sort((a, b) => a.tradeShow.startDate.localeCompare(b.tradeShow.startDate));
}

/** Which status tab the Home rail is showing. */
let homeTaskStatus = "upcoming";

function renderUpcomingTasks() {
  const list = document.getElementById("upcomingTasksList");
  if (!list) return;

  const all = buildUpcomingCardEntries();
  // A show can count toward more than one tab — see getTaskStatusBuckets.
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
    empty.textContent = getAllTradeShows().length === 0
      ? "No trade shows yet — add one from the Trade Shows tab."
      : `Nothing ${homeTaskStatus}.`;
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...shown.map(entry => {
    const card = createTradeShowCard(entry.tradeShow, { tasks: entry.buckets[homeTaskStatus] });
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

  window.addEventListener("resize", () => {
    if (getCurrentAppView() === "home") sizeCalRows();
  });
}
