/** Trade Shows list view — timing filter, search, sort, and row rendering. */

const TRADE_SHOW_COLUMNS = ["Show", "Start", "End", "Days", "Status", "Emails", "Next email", "Notes"];

/** Columns the toolbar search scans. */
const TRADE_SHOW_SEARCH_COLUMNS = ["Show", "Start", "End", "Status", "Notes"];

/** Columns that carry a sortable value. */
const TRADE_SHOW_SORTABLE_COLUMNS = new Set(["Show", "Start", "End", "Days", "Status", "Emails", "Next email"]);

/**
 * The toolbar's timing filter. "Upcoming" includes shows in progress — both
 * still have work ahead of them.
 */
const TRADE_SHOW_TIMING_FILTERS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "all", label: "All" },
];

let filteredTradeShows = [];
let tradeShowTimingFilter = "upcoming";
let tradeShowSortCol = null;
let tradeShowSortDir = 1;

// ── Column access ────────────────────────────────────────────────────────────

/** Canonical accessor: column label → a single display string. */
function getTradeShowColumnValue(tradeShow, col) {
  switch (col) {
    case "Show":   return getTradeShowTitle(tradeShow);
    case "Start":  return formatLongDate(tradeShow.startDate);
    case "End":    return formatLongDate(tradeShow.endDate);
    case "Days":   return String(daysBetween(tradeShow.startDate, tradeShow.endDate) + 1);
    case "Status": return TRADE_SHOW_TIMING_LABELS[getTradeShowTiming(tradeShow)];
    case "Emails": {
      const { done, total } = getTradeShowEmailProgress(tradeShow);
      return `${done}/${total}`;
    }
    case "Next email": {
      const next = getNextOpenEmailTask(tradeShow);
      return next ? formatTaskDate(next.dueDate) : "";
    }
    // Collapse newlines — the cell is a single line.
    case "Notes":  return String(tradeShow.notes ?? "").replace(/\s+/g, " ").trim();
    default:       return "";
  }
}

// ── Sorting ──────────────────────────────────────────────────────────────────

const TIMING_ORDER = ["live", "upcoming", "past"];

function compareTradeShowsByColumn(col, a, b) {
  switch (col) {
    case "Start":  return a.startDate.localeCompare(b.startDate);
    case "End":    return a.endDate.localeCompare(b.endDate);
    case "Days":   return daysBetween(a.startDate, a.endDate) - daysBetween(b.startDate, b.endDate);
    case "Status": return TIMING_ORDER.indexOf(getTradeShowTiming(a)) - TIMING_ORDER.indexOf(getTradeShowTiming(b));
    case "Emails": return getTradeShowEmailProgress(a).done - getTradeShowEmailProgress(b).done;
    case "Next email": {
      // Shows with nothing left to send sort last either way.
      const ad = getNextOpenEmailTask(a)?.dueDate ?? "";
      const bd = getNextOpenEmailTask(b)?.dueDate ?? "";
      return compareTextFieldValues(ad, bd);
    }
    default:
      return compareTextFieldValues(getTradeShowColumnValue(a, col), getTradeShowColumnValue(b, col));
  }
}

/**
 * With no explicit sort, upcoming shows read soonest-first and past shows
 * most-recent-first — whichever is nearest today leads either way.
 */
function compareTradeShowsForSort(a, b) {
  if (tradeShowSortCol) {
    const primary = compareTradeShowsByColumn(tradeShowSortCol, a, b) * tradeShowSortDir;
    if (primary !== 0) return primary;
  }
  const byStart = compareTradeShowsByColumn("Start", a, b);
  return tradeShowTimingFilter === "past" ? -byStart : byStart;
}

/** Cycle: unsorted → ascending → descending → unsorted. */
function sortTradeShowsBy(col) {
  if (!TRADE_SHOW_SORTABLE_COLUMNS.has(col)) return;
  if (tradeShowSortCol === col) {
    if (tradeShowSortDir === 1) {
      tradeShowSortDir = -1;
    } else {
      tradeShowSortCol = null;
      tradeShowSortDir = 1;
    }
  } else {
    tradeShowSortCol = col;
    tradeShowSortDir = 1;
  }
  updateTradeShowSortHeaders();
  applyTradeShowFilters();
}

function updateTradeShowSortHeaders() {
  document.querySelectorAll("#tradeShowsTable thead th[data-col]").forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (tradeShowSortCol && th.dataset.col === tradeShowSortCol) {
      th.classList.add(tradeShowSortDir === 1 ? "sorted-asc" : "sorted-desc");
    }
  });
}

// ── Filter + search pipeline ─────────────────────────────────────────────────

function rowPassesTimingFilter(tradeShow) {
  const timing = getTradeShowTiming(tradeShow);
  if (tradeShowTimingFilter === "upcoming") return timing !== "past";
  if (tradeShowTimingFilter === "past") return timing === "past";
  return true;
}

function applyTradeShowFilters() {
  const q = (document.getElementById("tradeShowSearchInput")?.value ?? "").trim().toLowerCase();
  setActiveSearchQuery(q);

  filteredTradeShows = getAllTradeShows().filter(tradeShow => {
    if (!rowPassesTimingFilter(tradeShow)) return false;
    if (!q) return true;
    const haystack = TRADE_SHOW_SEARCH_COLUMNS
      .map(col => getTradeShowColumnValue(tradeShow, col))
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  filteredTradeShows.sort(compareTradeShowsForSort);
  renderTradeShowsTable();
  updateTradeShowsRowCounter();
}

function updateTradeShowsRowCounter() {
  const el = document.getElementById("tradeShowsRowCounter");
  if (!el) return;
  const n = filteredTradeShows.length;
  el.textContent = n === 1 ? "1 show" : `${n} shows`;
}

function syncTradeShowTimingToolbar() {
  document.querySelectorAll("#tradeShowTimingFilters .filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.timing === tradeShowTimingFilter);
  });
}

function initTradeShowTimingFilters() {
  const group = document.getElementById("tradeShowTimingFilters");
  if (!group) return;

  group.replaceChildren(...TRADE_SHOW_TIMING_FILTERS.map(option => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn";
    btn.dataset.timing = option.key;
    btn.textContent = option.label;
    btn.addEventListener("click", () => {
      tradeShowTimingFilter = option.key;
      syncTradeShowTimingToolbar();
      applyTradeShowFilters();
    });
    return btn;
  }));
  syncTradeShowTimingToolbar();
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderTradeShowNameCell(td, tradeShow) {
  const wrap = document.createElement("span");
  wrap.className = "trade-show-name-cell";

  const dot = document.createElement("span");
  dot.className = "trade-show-dot";
  dot.dataset.show = tradeShow.show;
  dot.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  mountSearchHighlightedText(name, getTradeShowTitle(tradeShow));

  wrap.append(dot, name);
  td.replaceChildren(wrap);
}

function renderTradeShowStatusCell(td, tradeShow) {
  const timing = getTradeShowTiming(tradeShow);
  const pill = document.createElement("span");
  pill.className = "trade-show-status";
  pill.dataset.timing = timing;
  mountSearchHighlightedText(pill, TRADE_SHOW_TIMING_LABELS[timing]);
  td.replaceChildren(pill);
}

function renderTradeShowEmailsCell(td, tradeShow) {
  const { done, total } = getTradeShowEmailProgress(tradeShow);
  const wrap = document.createElement("span");
  wrap.className = "trade-show-email-dots";
  wrap.title = `${done} of ${total} emails sent`;
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("span");
    dot.className = "service-dot" + (i < done ? " is-on" : "");
    wrap.appendChild(dot);
  }
  const label = document.createElement("span");
  label.className = "trade-show-email-count";
  label.textContent = `${done}/${total}`;
  wrap.appendChild(label);
  td.replaceChildren(wrap);
}

function renderTradeShowsTable() {
  const tbody = document.getElementById("tradeShowsTableBody");
  if (!tbody) return;

  if (filteredTradeShows.length === 0) {
    const msg = getAllTradeShows().length === 0
      ? "No trade shows yet — use Add trade show to create one."
      : "No trade shows match the current filters.";
    tbody.innerHTML = `<tr class="state-row"><td colspan="${TRADE_SHOW_COLUMNS.length}">${escapeHtml(msg)}</td></tr>`;
    return;
  }

  tbody.replaceChildren(...filteredTradeShows.map(tradeShow => {
    const tr = document.createElement("tr");
    tr.className = "clickable-row";
    tr.dataset.tradeShowId = tradeShow.id;

    TRADE_SHOW_COLUMNS.forEach(col => {
      const td = document.createElement("td");
      td.dataset.col = col;

      if (col === "Show") renderTradeShowNameCell(td, tradeShow);
      else if (col === "Status") renderTradeShowStatusCell(td, tradeShow);
      else if (col === "Emails") renderTradeShowEmailsCell(td, tradeShow);
      else {
        const value = getTradeShowColumnValue(tradeShow, col);
        mountSearchHighlightedText(td, value);
        if (col === "Notes" && value) td.title = tradeShow.notes;
      }
      tr.appendChild(td);
    });
    return tr;
  }));
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initTradeShowsView() {
  initTradeShowTimingFilters();

  document.querySelectorAll("#tradeShowsTable thead th[data-col]").forEach(th => {
    if (!TRADE_SHOW_SORTABLE_COLUMNS.has(th.dataset.col)) th.classList.add("th-no-sort");
    th.addEventListener("click", () => sortTradeShowsBy(th.dataset.col));
  });

  document.getElementById("tradeShowSearchInput")?.addEventListener("input", applyTradeShowFilters);

  // Single click opens the show — the section's primary drill-down.
  document.getElementById("tradeShowsTableBody")?.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-trade-show-id]");
    if (tr) openTradeShowDetail(tr.dataset.tradeShowId);
  });

  updateTradeShowSortHeaders();
}
