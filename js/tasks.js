/**
 * Schedule items — trade shows and campaigns in one shape, so the calendar,
 * the task rails, and the side pane can treat them alike.
 *
 * An item has a date range (drawn on the calendar one chip per day) and a
 * list of tasks (drawn on their due dates, each one checkable):
 *
 *   Trade show  tasks derived from Day 1 — TRADE_SHOW_EMAIL_TASKS, counted
 *               back exactly (a weekend date stays on the weekend)
 *   Campaign    tasks chosen one by one, each with its own due date
 *
 * Also home to the pieces every task list shares: the status buckets, the
 * task checkbox, and the per-item card.
 */

const EVENT_KIND_SHOW = "show";
const EVENT_KIND_CAMPAIGN = "campaign";
const TASK_KIND_EMAIL = "email";
const TASK_KIND_BANNER = "banner";
const TASK_KIND_SOCIAL = "social";

const TASK_ID_PREFIX_TRADE_SHOW = "ts";
const TASK_ID_PREFIX_CAMPAIGN = "cp";

const ITEM_TYPE_TRADE_SHOW = "tradeShow";
const ITEM_TYPE_CAMPAIGN = "campaign";

// ── Task ids ─────────────────────────────────────────────────────────────────
//
// No dates in any of these, so moving a show or a task keeps its checkmark.

/** e.g. "ts|ts-abc123|email-3w". */
function buildEmailTaskId(tradeShowId, emailKey) {
  return `${TASK_ID_PREFIX_TRADE_SHOW}|${tradeShowId}|${emailKey}`;
}

/** e.g. "cp|cp-abc123|t-def456". */
function buildCampaignTaskId(campaignId, taskId) {
  return `${TASK_ID_PREFIX_CAMPAIGN}|${campaignId}|${taskId}`;
}

// ── Tasks per record ─────────────────────────────────────────────────────────

function buildTradeShowEmailTasks(tradeShow) {
  const dayOne = parseYmd(tradeShow?.startDate);
  if (!dayOne) return [];
  return TRADE_SHOW_EMAIL_TASKS.map(email => ({
    id: buildEmailTaskId(tradeShow.id, email.key),
    kind: TASK_KIND_EMAIL,
    dueDate: ymd(addDays(dayOne, -email.daysBefore)),
    label: email.label,
  }));
}

/** In due-date order, so a campaign's run-up reads top to bottom. */
function buildCampaignTasks(campaign) {
  return (campaign?.tasks ?? [])
    .filter(task => task.dueDate)
    .map(task => ({
      id: buildCampaignTaskId(campaign.id, task.id),
      kind: task.category,
      dueDate: task.dueDate,
      label: getCampaignTaskCategoryLabel(task.category),
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// ── Items ────────────────────────────────────────────────────────────────────

function tradeShowToItem(tradeShow) {
  return {
    type: ITEM_TYPE_TRADE_SHOW,
    id: tradeShow.id,
    record: tradeShow,
    title: getTradeShowTitle(tradeShow),
    chipLabel: getTradeShowLabel(tradeShow.show),
    startDate: tradeShow.startDate,
    endDate: tradeShow.endDate,
    weekdays: [],
    dayKind: EVENT_KIND_SHOW,
    color: { attr: "show", value: tradeShow.show },
    tasks: buildTradeShowEmailTasks(tradeShow),
    groupId: `${TASK_ID_PREFIX_TRADE_SHOW}|${tradeShow.id}|days`,
  };
}

function campaignToItem(campaign) {
  return {
    type: ITEM_TYPE_CAMPAIGN,
    id: campaign.id,
    record: campaign,
    title: getCampaignTitle(campaign),
    chipLabel: getCampaignTitle(campaign),
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    // Only these weekdays count as "on" between the dates; [] = every day.
    weekdays: campaign.weekdays,
    dayKind: EVENT_KIND_CAMPAIGN,
    color: { attr: "campaignType", value: campaign.type },
    tasks: buildCampaignTasks(campaign),
    groupId: `${TASK_ID_PREFIX_CAMPAIGN}|${campaign.id}|days`,
  };
}

function getAllScheduleItems() {
  return [
    ...getAllTradeShows().map(tradeShowToItem),
    ...getAllCampaigns().map(campaignToItem),
  ];
}

function getScheduleItem(type, id) {
  if (type === ITEM_TYPE_CAMPAIGN) {
    const campaign = getCampaignById(id);
    return campaign ? campaignToItem(campaign) : null;
  }
  const tradeShow = getTradeShowById(id);
  return tradeShow ? tradeShowToItem(tradeShow) : null;
}

/** Tag an element so crm.css paints it in the item's colour. */
function applyItemColor(el, item) {
  el.dataset[item.color.attr] = item.color.value;
}

/** What a day chip says beyond the name: "Day 2" for a show, "Starts" for a campaign. */
function describeItemDay(item, dayNumber, dayCount) {
  if (item.type === ITEM_TYPE_TRADE_SHOW) return `Day ${dayNumber}`;
  if (dayCount === 1) return "1 day";
  if (dayNumber === 1) return "Starts";
  if (dayNumber === dayCount) return "Ends";
  return `Day ${dayNumber}`;
}

/**
 * One event per day the item is on — every day of its range, or only its
 * chosen weekdays. Day numbers count the days it's on, so a weekends-only
 * sale reads Starts, Day 2, Day 3 … Ends across its Saturdays and Sundays.
 */
function buildItemDayEvents(item) {
  const days = listActiveDays(item);
  return days.map((day, i) => ({
    id: item.groupId,
    kind: item.dayKind,
    dueDate: day,
    dayNumber: i + 1,
    dayCount: days.length,
  }));
}

/** How many days the item is on. */
function countItemDays(item) {
  return countActiveDays(item);
}

/** "18 days", plus the weekdays when it only runs on some of them. */
function describeItemLength(item) {
  const n = countItemDays(item);
  const length = n === 1 ? "1 day" : `${n} days`;
  return item.weekdays?.length ? `${length} · ${formatWeekdayList(item.weekdays)} only` : length;
}

/** Every id an item's card covers — its days plus its tasks. */
function getItemGroupIds(item) {
  return [item.groupId, ...item.tasks.map(t => t.id)];
}

/** All tasks ticked off. The days themselves aren't checkable. */
function isItemComplete(item) {
  return item.tasks.length > 0 && item.tasks.every(t => isTaskComplete(t.id));
}

/** "2 of 3" — how far through its tasks an item is. */
function getItemTaskProgress(item) {
  return { done: item.tasks.filter(t => isTaskComplete(t.id)).length, total: item.tasks.length };
}

/** The first task still open, or null once they're all done. */
function getNextOpenTask(item) {
  return item.tasks.find(t => !isTaskComplete(t.id)) ?? null;
}

/** Upcoming / In progress / Past, against today. */
function getItemTiming(item) {
  const today = todayYmd();
  if (!item?.startDate) return "upcoming";
  if (item.endDate < today) return "past";
  if (item.startDate <= today) return "live";
  return "upcoming";
}

const ITEM_TIMING_LABELS = {
  upcoming: "Upcoming",
  live: "In progress",
  past: "Past",
};

// ── Task status buckets ──────────────────────────────────────────────────────
//
// A card can sit in more than one tab at once — an item with one missed task
// and two still to come is both overdue and upcoming:
//
//   Upcoming   any task still open and not yet due. The card shows all of
//              its tasks, missed ones with their date in red, so the whole
//              run-up reads in order.
//   Overdue    any task open past its due date. The card shows only those.
//   Completed  every task done.

const TASK_STATUS_TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Completed" },
];

function isTaskOverdue(task) {
  return !isTaskComplete(task.id) && task.dueDate < todayYmd();
}

/**
 * The tabs a card belongs in, each mapped to the tasks it shows there.
 * A tab the card isn't in is simply absent.
 */
function getTaskStatusBuckets(tasks) {
  const today = todayYmd();
  const open = tasks.filter(t => !isTaskComplete(t.id));
  const buckets = {};
  if (open.some(t => t.dueDate >= today)) buckets.upcoming = tasks;
  const overdue = open.filter(t => t.dueDate < today);
  if (overdue.length > 0) buckets.overdue = overdue;
  if (tasks.length > 0 && open.length === 0) buckets.completed = tasks;
  return buckets;
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
 * Re-render whatever is on screen after a task is ticked or a record changes.
 * Each renderer is a cheap no-op when its view isn't the active one.
 */
function refreshTaskViews() {
  refreshCalendarIfActive();
  refreshItemPane();
  refreshRecordListsIfActive();
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
  if (isTaskOverdue(task)) {
    due.classList.add("is-overdue");
    due.title = "Overdue";
  }

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
  // Linked to a Mailchimp campaign: a small mark coloured by its state.
  const mc = typeof createMcTaskBadge === "function" ? createMcTaskBadge(task.id) : null;
  if (mc) label.appendChild(mc);
  return label;
}

// ── Glyphs ───────────────────────────────────────────────────────────────────

const CAL_EVENT_ICON_PATHS = {
  // Trade show — a booth / storefront awning.
  [EVENT_KIND_SHOW]: ["M3 9h18l-2-5H5z", "M4 9v11h16V9", "M9 20v-6h6v6"],
  // Campaign — a price tag.
  [EVENT_KIND_CAMPAIGN]: ["M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z", "M7.5 7.5h.01"],
  // Email — an envelope.
  [TASK_KIND_EMAIL]: ["M3 5h18v14H3z", "m3 6 9 7 9-7"],
  // Banner — a wide picture frame.
  [TASK_KIND_BANNER]: ["M2 6h20v12H2z", "m2 16 6-5 4 3 3-2 7 5", "M16 9.5h.01"],
  // Social media — a speech bubble.
  [TASK_KIND_SOCIAL]: ["M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"],
};

/** A glyph per kind, so days, emails, banners and posts read apart at a glance. */
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

  (CAL_EVENT_ICON_PATHS[kind] ?? []).forEach(d => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  });
  return svg;
}

// ── Item card ────────────────────────────────────────────────────────────────

/**
 * One card per item: its name and dates up top, its tasks as checkable rows.
 * `showName` drops the name line where the context already says whose tasks
 * these are. `tasks` narrows the rows — the Overdue tab passes just the
 * missed ones.
 */
function createScheduleCard(item, { showName = true, onChange, tasks } = {}) {
  const complete = isItemComplete(item);
  const card = document.createElement("div");
  card.className = "payroll-run schedule-card" + (complete ? " is-complete" : "");
  applyItemColor(card, item);

  const head = document.createElement("div");
  head.className = "payroll-run-head";

  if (showName) {
    const name = document.createElement("button");
    name.type = "button";
    name.className = "payroll-run-company";
    name.textContent = item.title;
    name.addEventListener("click", () => openItemPane(item.type, item.id));
    head.appendChild(name);
  }

  const meta = document.createElement("div");
  meta.className = "payroll-run-meta";

  const pill = document.createElement("span");
  pill.className = "schedule-pill schedule-card-pill";
  applyItemColor(pill, item);
  pill.textContent = formatDateRange(item.startDate, item.endDate);
  meta.appendChild(pill);

  if (complete) {
    const badge = document.createElement("span");
    badge.className = "payroll-run-complete-badge";
    badge.textContent = "Done";
    meta.appendChild(badge);
  }
  head.appendChild(meta);
  card.appendChild(head);

  const rows = tasks ?? item.tasks;
  const tasksWrap = document.createElement("div");
  tasksWrap.className = "payroll-run-tasks schedule-card-tasks";
  rows.forEach(task => tasksWrap.appendChild(createTaskCheckbox(task, onChange)));
  if (rows.length === 0) {
    const empty = document.createElement("span");
    empty.className = "schedule-card-empty";
    empty.textContent = "No tasks yet.";
    tasksWrap.appendChild(empty);
  }
  card.appendChild(tasksWrap);

  return card;
}
