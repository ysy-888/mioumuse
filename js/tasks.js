/**
 * Trade show tasks and calendar events — derived, never stored.
 *
 * Each show produces:
 *   - one "show" event per day it runs (Day 1 … Day N), for the calendar
 *   - the email tasks in TRADE_SHOW_EMAIL_TASKS, counted back from Day 1
 *
 * Email dates are exactly N days before Day 1 — a task that lands on a
 * weekend stays on the weekend.
 *
 * Also home to the pieces every task list shares: the status tabs, the task
 * checkbox, and the per-show card.
 */

const TASK_KIND_EMAIL = "email";
const EVENT_KIND_SHOW = "show";
const TASK_ID_PREFIX_TRADE_SHOW = "ts";

/** e.g. "ts|ts-abc123|email-3w". No date in it, so moving a show keeps its checkmarks. */
function buildEmailTaskId(tradeShowId, emailKey) {
  return `${TASK_ID_PREFIX_TRADE_SHOW}|${tradeShowId}|${emailKey}`;
}

/**
 * What every day-chip of one show shares, so selecting the show lights up
 * its whole run on the calendar at once.
 */
function buildShowGroupId(tradeShowId) {
  return `${TASK_ID_PREFIX_TRADE_SHOW}|${tradeShowId}|show`;
}

function buildTradeShowEmailTasks(tradeShow) {
  const dayOne = parseYmd(tradeShow?.startDate);
  if (!dayOne) return [];
  return TRADE_SHOW_EMAIL_TASKS.map(email => ({
    id: buildEmailTaskId(tradeShow.id, email.key),
    kind: TASK_KIND_EMAIL,
    tradeShowId: tradeShow.id,
    dueDate: ymd(addDays(dayOne, -email.daysBefore)),
    label: email.label,
  }));
}

/** One event per day the show runs. */
function buildTradeShowDayEvents(tradeShow) {
  const start = parseYmd(tradeShow?.startDate);
  const end = parseYmd(tradeShow?.endDate) ?? start;
  if (!start) return [];

  const dayCount = daysBetween(tradeShow.startDate, ymd(end)) + 1;
  const events = [];
  for (let i = 0; i < dayCount; i++) {
    events.push({
      id: buildShowGroupId(tradeShow.id),
      kind: EVENT_KIND_SHOW,
      tradeShowId: tradeShow.id,
      dueDate: ymd(addDays(start, i)),
      dayNumber: i + 1,
      dayCount,
    });
  }
  return events;
}

/** Every id a show's card covers — the show itself plus its emails. */
function getTradeShowGroupIds(tradeShow) {
  return [buildShowGroupId(tradeShow.id), ...buildTradeShowEmailTasks(tradeShow).map(t => t.id)];
}

/** All emails ticked off. The show days themselves aren't checkable. */
function isTradeShowComplete(tradeShow) {
  const tasks = buildTradeShowEmailTasks(tradeShow);
  return tasks.length > 0 && tasks.every(t => isTaskComplete(t.id));
}

/** "2 of 3" — how far through its emails a show is. */
function getTradeShowEmailProgress(tradeShow) {
  const tasks = buildTradeShowEmailTasks(tradeShow);
  return { done: tasks.filter(t => isTaskComplete(t.id)).length, total: tasks.length };
}

/** The first email still open, or null once they're all done. */
function getNextOpenEmailTask(tradeShow) {
  return buildTradeShowEmailTasks(tradeShow).find(t => !isTaskComplete(t.id)) ?? null;
}

/** Upcoming / In progress / Past, against today. */
function getTradeShowTiming(tradeShow) {
  const today = todayYmd();
  if (!tradeShow?.startDate) return "upcoming";
  if (tradeShow.endDate < today) return "past";
  if (tradeShow.startDate <= today) return "live";
  return "upcoming";
}

const TRADE_SHOW_TIMING_LABELS = {
  upcoming: "Upcoming",
  live: "In progress",
  past: "Past",
};

// ── Task status tabs ─────────────────────────────────────────────────────────
//
// The same three buckets drive every task list. A card is bucketed by its own
// tasks: anything still open and past due makes the card overdue, everything
// done makes it completed, and the rest is upcoming.

const TASK_STATUS_TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Completed" },
];

function classifyTaskStatus(tasks) {
  const today = todayYmd();
  const open = tasks.filter(t => !isTaskComplete(t.id));
  if (open.length === 0) return "completed";
  return open.some(t => t.dueDate < today) ? "overdue" : "upcoming";
}

/** Builds the tab strip; `onChange` receives the newly picked status key. */
function renderTaskStatusTabs(containerId, activeKey, counts, onChange) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;

  wrap.replaceChildren(...TASK_STATUS_TABS.map(tab => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "task-tab" + (tab.key === activeKey ? " is-active" : "");
    btn.dataset.status = tab.key;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", tab.key === activeKey ? "true" : "false");
    btn.textContent = tab.label;

    const n = counts?.[tab.key] ?? 0;
    if (n > 0) {
      const badge = document.createElement("span");
      badge.className = "task-tab-count";
      badge.textContent = String(n);
      btn.appendChild(badge);
    }
    btn.addEventListener("click", () => onChange(tab.key));
    return btn;
  }));
}

// ── Refresh ──────────────────────────────────────────────────────────────────

/**
 * Re-render whatever is on screen after a task is ticked or a show changes.
 * Each renderer is a cheap no-op when its view isn't the active one.
 */
function refreshTaskViews() {
  if (typeof refreshCalendarIfActive === "function") refreshCalendarIfActive();
  if (typeof refreshTradeShowDetailIfActive === "function") refreshTradeShowDetailIfActive();
  if (typeof applyTradeShowFilters === "function") applyTradeShowFilters();
}

// ── Task checkbox ────────────────────────────────────────────────────────────

/**
 * `data-task-id` is what calendar highlighting matches on, so every row
 * carries it regardless of which list it's in.
 */
function createTaskCheckbox(task, onChange) {
  const label = document.createElement("label");
  label.className = "payroll-task" + (isTaskComplete(task.id) ? " is-done" : "");
  label.dataset.kind = task.kind;
  label.dataset.taskId = task.id;

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = isTaskComplete(task.id);

  const box = document.createElement("span");
  box.className = "payroll-task-box";
  box.setAttribute("aria-hidden", "true");

  // Same glyph the calendar chips use, so a row and its event read as one thing.
  const icon = createCalEventIcon(task.kind);
  icon.classList.add("payroll-task-icon");

  const text = document.createElement("span");
  text.className = "payroll-task-text";

  // Deadline leads — it's what you're scanning for.
  const due = document.createElement("span");
  due.className = "payroll-task-due";
  due.textContent = formatTaskDateShort(task.dueDate);

  const name = document.createElement("span");
  name.className = "payroll-task-name";
  name.textContent = task.label;

  text.append(due, name);

  cb.addEventListener("change", async () => {
    const next = cb.checked;
    try {
      await setTaskComplete(task.id, next);
    } catch (err) {
      cb.checked = !next;
      showIndicator(err.message || "Could not update task.", "error");
      return;
    }
    label.classList.toggle("is-done", next);
    (onChange ?? refreshTaskViews)();
  });

  label.append(cb, box, icon, text);
  return label;
}

// ── Calendar glyphs ──────────────────────────────────────────────────────────

/** A glyph per kind, so show days and emails read apart at a glance. */
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
    // Trade show — a booth / storefront awning.
    [EVENT_KIND_SHOW]: ["M3 9h18l-2-5H5z", "M4 9v11h16V9", "M9 20v-6h6v6"],
    // Email — an envelope.
    [TASK_KIND_EMAIL]: ["M3 5h18v14H3z", "m3 6 9 7 9-7"],
  }[kind] ?? [];

  paths.forEach(d => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  });
  return svg;
}

// ── Show card ────────────────────────────────────────────────────────────────

/**
 * One card per show: its name and dates up top, its emails as checkable rows.
 * `showName` is off on the show's own detail page, which already says whose
 * emails these are.
 */
function createTradeShowCard(tradeShow, { showName = true, onChange } = {}) {
  const complete = isTradeShowComplete(tradeShow);
  const card = document.createElement("div");
  card.className = "payroll-run trade-show-card" + (complete ? " is-complete" : "");
  card.dataset.show = tradeShow.show;

  const head = document.createElement("div");
  head.className = "payroll-run-head";

  if (showName) {
    const name = document.createElement("button");
    name.type = "button";
    name.className = "payroll-run-company";
    name.textContent = getTradeShowTitle(tradeShow);
    name.addEventListener("click", () => openTradeShowDetail(tradeShow.id));
    head.appendChild(name);
  }

  const meta = document.createElement("div");
  meta.className = "payroll-run-meta";

  const pill = document.createElement("span");
  pill.className = "schedule-pill trade-show-pill";
  pill.dataset.show = tradeShow.show;
  pill.textContent = formatDateRange(tradeShow.startDate, tradeShow.endDate);
  meta.appendChild(pill);

  if (complete) {
    const badge = document.createElement("span");
    badge.className = "payroll-run-complete-badge";
    badge.textContent = "Done";
    meta.appendChild(badge);
  }
  head.appendChild(meta);
  card.appendChild(head);

  const tasksWrap = document.createElement("div");
  tasksWrap.className = "payroll-run-tasks trade-show-card-tasks";
  buildTradeShowEmailTasks(tradeShow).forEach(task => {
    tasksWrap.appendChild(createTaskCheckbox(task, onChange));
  });
  card.appendChild(tasksWrap);

  return card;
}
