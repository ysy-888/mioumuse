/**
 * Home — the dashboard: a greeting, Tasks (the calendar's upcoming / overdue /
 * completed cards), a mini calendar (a month, a dot per thing on a day; pick a
 * day for its agenda) and the Inbox (latest chats, unread first to the eye).
 *
 * The full calendar is its own page now ("calendar", js/calendar.js).
 */

const home = {
  cursor: null, // { year, month } of the mini calendar
  selected: "", // ymd picked on it ("" = today)
  taskStatus: "upcoming",
  inboxCount: 7,
};

function homeEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderHome() {
  if (getCurrentAppView() !== "home") return;
  renderHomeGreeting();
  renderHomeTasks();
  renderHomeCalendar();
  renderHomeInbox();
}

// ── Greeting ─────────────────────────────────────────────────────────────────

function renderHomeGreeting() {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const me = typeof chat !== "undefined" && chat.me ? chatPerson(chat.me)?.name : "";
  const first = String(me || "").trim().split(/\s+/)[0];
  document.getElementById("homeGreeting").textContent = first && first !== "Someone" ? `${part}, ${first}` : part;
  document.getElementById("homeDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// ── Tasks: the calendar's rail, on its own ───────────────────────────────────

function renderHomeTasks() {
  const list = document.getElementById("homeTasksList");
  if (!list) return;
  const all = buildUpcomingCardEntries();
  const counts = { upcoming: 0, overdue: 0, completed: 0 };
  all.forEach(e => Object.keys(e.buckets).forEach(key => { counts[key] += 1; }));
  renderTaskStatusTabs("homeDashTaskTabs", home.taskStatus, counts, key => {
    home.taskStatus = key;
    renderHomeTasks();
  });
  const shown = all.filter(e => e.buckets[home.taskStatus]);
  if (!shown.length) {
    const empty = document.createElement("div");
    empty.className = "dash-empty";
    empty.textContent = getAllScheduleItems().length === 0
      ? "Nothing scheduled yet — add a campaign, a trade show or a photoshoot to get started."
      : `Nothing ${home.taskStatus}.`;
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...shown.map(entry => {
    const card = createScheduleCard(entry.item, { tasks: entry.buckets[home.taskStatus] });
    card.addEventListener("click", e => {
      if (e.target.closest("input, button, a, label")) return;
      openCalItemPane(entry.item);
    });
    return card;
  }));
}

// ── Mini calendar ────────────────────────────────────────────────────────────

/** ymd → entries (days an item is on, tasks due) between two dates. */
function homeEntriesBetween(from, to) {
  const byDate = new Map();
  getAllScheduleItems().forEach(item => {
    buildItemCalendarEntries(item).forEach(entry => {
      if (entry.dueDate < from || entry.dueDate > to) return;
      if (!byDate.has(entry.dueDate)) byDate.set(entry.dueDate, []);
      byDate.get(entry.dueDate).push(entry);
    });
  });
  return byDate;
}

function renderHomeCalendar() {
  const grid = document.getElementById("homeCalGrid");
  if (!grid) return;
  const now = new Date();
  if (!home.cursor) home.cursor = { year: now.getFullYear(), month: now.getMonth() };
  const { year, month } = home.cursor;
  const first = new Date(year, month, 1);
  const start = addDays(first, -first.getDay());
  const end = addDays(start, 41);
  document.getElementById("homeCalTitle").textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const byDate = homeEntriesBetween(ymd(start), ymd(end));
  const today = todayYmd();
  const selected = home.selected || today;
  const heads = ["S", "M", "T", "W", "T", "F", "S"].map(d => `<span class="home-cal-dow">${d}</span>`).join("");
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const key = ymd(d);
    const entries = byDate.get(key) ?? [];
    // A dot per thing on the day (its colour), three at most.
    const items = [...new Map(entries.map(e => [`${e.item.type}:${e.item.id}`, e])).values()];
    const dots = items.slice(0, 3).map(e => `<i class="home-cal-dot" data-${homeEsc(dataAttrName(e.item.color.attr))}="${homeEsc(e.item.color.value)}"></i>`).join("");
    const cls = ["home-cal-day"];
    if (d.getMonth() !== month) cls.push("is-other");
    if (key === today) cls.push("is-today");
    if (key === selected) cls.push("is-selected");
    if (entries.length) cls.push("has-events");
    cells += `<button type="button" class="${cls.join(" ")}" data-day="${key}" title="${entries.length ? `${entries.length} on ${formatTaskDate(key)}` : formatTaskDate(key)}">
      <span class="home-cal-num">${d.getDate()}</span><span class="home-cal-dots">${dots}</span></button>`;
  }
  grid.innerHTML = `<div class="home-cal-head">${heads}</div><div class="home-cal-days">${cells}</div>`;
  renderHomeAgenda(selected, byDate.get(selected) ?? homeEntriesBetween(selected, selected).get(selected) ?? []);
}

/** "campaignType" → "campaign-type" (the attribute applyItemColor sets). */
function dataAttrName(attr) {
  return String(attr).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}

function renderHomeAgenda(day, entries) {
  const box = document.getElementById("homeCalAgenda");
  const label = day === todayYmd() ? "Today" : formatTaskDate(day);
  // Days first (what's running), then the tasks due.
  const sorted = [...entries].sort((a, b) => (isDayEntry(a) ? 0 : 1) - (isDayEntry(b) ? 0 : 1) || a.item.chipLabel.localeCompare(b.item.chipLabel));
  box.innerHTML = `<div class="home-agenda-head">${homeEsc(label)}<span>${sorted.length || ""}</span></div>`
    + (sorted.length
      ? sorted.map((e, i) => `<button type="button" class="home-agenda-row${e.done ? " is-done" : ""}" data-agenda="${i}" data-${homeEsc(dataAttrName(e.item.color.attr))}="${homeEsc(e.item.color.value)}">
          <i class="home-agenda-bar"></i>
          <span class="home-agenda-title">${homeEsc(e.item.title)}</span>
          <span class="home-agenda-meta">${homeEsc(isDayEntry(e) ? describeItemDay(e.item, e.dayNumber, e.dayCount) : (CAL_TASK_SHORT_LABELS[e.kind] ?? e.label))}</span>
        </button>`).join("")
      : `<div class="home-agenda-empty">Nothing on this day.</div>`);
  box._entries = sorted;
}

function stepHomeCalendar(delta) {
  const { year, month } = home.cursor;
  const d = new Date(year, month + delta, 1);
  home.cursor = { year: d.getFullYear(), month: d.getMonth() };
  renderHomeCalendar();
}

// ── Inbox ────────────────────────────────────────────────────────────────────

function renderHomeInbox() {
  const list = document.getElementById("homeInboxList");
  if (!list || typeof chat === "undefined") return;
  const unread = chatTotalUnread();
  const badge = document.getElementById("homeInboxUnread");
  badge.hidden = !unread;
  badge.textContent = `${unread > 99 ? "99+" : unread} unread`;
  if (!chat.ready) { list.innerHTML = `<div class="home-agenda-empty">Loading…</div>`; return; }
  const convs = sortedChatConvs().slice(0, home.inboxCount);
  list.innerHTML = convs.length
    ? convs.map(c => chatListRowHtml(c).replace(" is-active", "")).join("")
    : `<div class="home-agenda-empty">No messages yet. <button type="button" class="home-card-link" data-home-new-chat>Start a chat</button></div>`;
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function initHome() {
  document.getElementById("homeCalPrev")?.addEventListener("click", () => stepHomeCalendar(-1));
  document.getElementById("homeCalNext")?.addEventListener("click", () => stepHomeCalendar(1));
  document.getElementById("homeCalToday")?.addEventListener("click", () => {
    home.cursor = null;
    home.selected = "";
    renderHomeCalendar();
  });
  document.getElementById("homeCalGrid")?.addEventListener("click", e => {
    const day = e.target.closest("[data-day]");
    if (!day) return;
    home.selected = day.dataset.day;
    const d = parseYmd(home.selected);
    if (d.getMonth() !== home.cursor.month) home.cursor = { year: d.getFullYear(), month: d.getMonth() };
    renderHomeCalendar();
  });
  // A day's thing opens its pane.
  document.getElementById("homeCalAgenda")?.addEventListener("click", e => {
    const row = e.target.closest("[data-agenda]");
    const entry = row && e.currentTarget._entries?.[Number(row.dataset.agenda)];
    if (entry) openCalItemPane(entry.item);
  });
  // The full calendar, on the day picked.
  document.getElementById("homeCalOpen")?.addEventListener("click", () => {
    const day = home.selected || todayYmd();
    switchAppView("calendar");
    requestAnimationFrame(() => scrollCalToDate(day, { instant: true }));
  });
  document.getElementById("homeInboxAll")?.addEventListener("click", () => switchAppView("messages"));
  document.getElementById("homeInboxList")?.addEventListener("click", e => {
    if (e.target.closest("[data-home-new-chat]")) return openNewChatDialog();
    const row = e.target.closest("[data-open-conv]");
    if (row) openMiniChat(row.dataset.openConv);
  });
}
