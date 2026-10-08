/**
 * The list view behind both Campaigns and Trade Shows — timing filter,
 * search, sort, and row rendering, driven by a per-section config.
 *
 * Rows are schedule items (see js/tasks.js), so both sections read their
 * dates, status and task progress the same way.
 */

/**
 * The toolbar's timing filter. "Upcoming" includes anything in progress —
 * both still have work ahead of them.
 */
const RECORD_TIMING_FILTERS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "all", label: "All" },
];

const TIMING_ORDER = ["live", "upcoming", "past"];

// ── Column library ───────────────────────────────────────────────────────────
//
// Each column: `value` is the plain text (search + default sort + display),
// `compare` overrides the sort where text order would be wrong, and `render`
// overrides the display where it's more than text.

const RECORD_COLUMNS = {
  name: {
    value: item => item.title,
    render(td, item) {
      const wrap = document.createElement("span");
      wrap.className = "record-name-cell";
      const dot = document.createElement("span");
      dot.className = "item-dot";
      applyItemColor(dot, item);
      dot.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      mountSearchHighlightedText(name, item.title);
      wrap.append(dot, name);
      td.replaceChildren(wrap);
    },
  },
  campaignType: {
    value: item => getCampaignTypeLabel(item.record.type),
  },
  start: {
    value: item => formatLongDate(item.startDate),
    compare: (a, b) => a.startDate.localeCompare(b.startDate),
  },
  end: {
    value: item => formatLongDate(item.endDate),
    compare: (a, b) => a.endDate.localeCompare(b.endDate),
  },
  days: {
    // Days it's actually on — a weekends-only campaign counts its weekends.
    value: item => String(countItemDays(item)),
    compare: (a, b) => countItemDays(a) - countItemDays(b),
    render(td, item) {
      mountSearchHighlightedText(td, String(countItemDays(item)));
      if (item.weekdays?.length) td.title = `${formatWeekdayList(item.weekdays)} only`;
    },
  },
  status: {
    value: item => ITEM_TIMING_LABELS[getItemTiming(item)],
    compare: (a, b) => TIMING_ORDER.indexOf(getItemTiming(a)) - TIMING_ORDER.indexOf(getItemTiming(b)),
    render(td, item) {
      const timing = getItemTiming(item);
      const pill = document.createElement("span");
      pill.className = "item-status";
      pill.dataset.timing = timing;
      mountSearchHighlightedText(pill, ITEM_TIMING_LABELS[timing]);
      td.replaceChildren(pill);
    },
  },
  progress: {
    value: item => {
      const { done, total } = getItemTaskProgress(item);
      return `${done}/${total}`;
    },
    compare: (a, b) => getItemTaskProgress(a).done - getItemTaskProgress(b).done,
    render(td, item) {
      const { done, total } = getItemTaskProgress(item);
      const wrap = document.createElement("span");
      wrap.className = "item-progress";
      wrap.title = `${done} of ${total} done`;
      // Dots stop being readable past a handful; the count carries the rest.
      for (let i = 0; i < Math.min(total, 6); i++) {
        const dot = document.createElement("span");
        dot.className = "service-dot" + (i < done ? " is-on" : "");
        wrap.appendChild(dot);
      }
      const label = document.createElement("span");
      label.className = "item-progress-count";
      label.textContent = `${done}/${total}`;
      wrap.appendChild(label);
      td.replaceChildren(wrap);
    },
  },
  nextTask: {
    value: item => {
      const next = getNextOpenTask(item);
      return next ? `${formatTaskDate(next.dueDate)} · ${next.label}` : "";
    },
    // Items with nothing left to do sort last either way.
    compare: (a, b) => compareTextFieldValues(getNextOpenTask(a)?.dueDate ?? "", getNextOpenTask(b)?.dueDate ?? ""),
    render(td, item) {
      const next = getNextOpenTask(item);
      if (!next) {
        setDisplayText(td, EMPTY_DISPLAY);
        return;
      }
      const wrap = document.createElement("span");
      wrap.className = "item-next-task";
      const icon = createCalEventIcon(next.kind);
      const date = document.createElement("span");
      date.textContent = formatTaskDate(next.dueDate);
      if (isTaskOverdue(next)) date.className = "is-overdue";
      wrap.append(icon, date);
      wrap.title = next.label;
      td.replaceChildren(wrap);
    },
  },
  notes: {
    // Collapse newlines — the cell is a single line.
    value: item => String(item.record.notes ?? "").replace(/\s+/g, " ").trim(),
    sortable: false,
    render(td, item) {
      const value = RECORD_COLUMNS.notes.value(item);
      mountSearchHighlightedText(td, value);
      if (value) td.title = item.record.notes;
    },
  },
};

/** Columns the toolbar search scans. */
const RECORD_SEARCH_COLUMNS = ["name", "campaignType", "start", "end", "status", "notes"];

// ── List instances ───────────────────────────────────────────────────────────

/** view key → list, so the shell can refresh whichever one is on screen. */
const RECORD_LISTS = {};

/**
 * config: {
 *   view            app view this list lives in
 *   ids             { table, body, search, timing, counter }
 *   getItems()      every row, as schedule items
 *   noun            ["campaign", "campaigns"]
 *   emptyText       shown when there's nothing at all yet
 * }
 * Columns come from the table's own <th data-col="…"> headers, keyed into
 * RECORD_COLUMNS.
 */
function createRecordList(config) {
  const state = { timing: "upcoming", sortCol: null, sortDir: 1, rows: [] };

  const table = () => document.getElementById(config.ids.table);
  const columns = () => [...(table()?.querySelectorAll("thead th[data-col]") ?? [])].map(th => th.dataset.col);
  const isSortable = col => RECORD_COLUMNS[col] && RECORD_COLUMNS[col].sortable !== false;

  function compareBy(col, a, b) {
    const column = RECORD_COLUMNS[col];
    if (column.compare) return column.compare(a, b);
    return compareTextFieldValues(column.value(a), column.value(b));
  }

  /**
   * With no explicit sort, upcoming rows read soonest-first and past rows
   * most-recent-first — whichever is nearest today leads either way.
   */
  function compareForSort(a, b) {
    if (state.sortCol) {
      const primary = compareBy(state.sortCol, a, b) * state.sortDir;
      if (primary !== 0) return primary;
    }
    const byStart = RECORD_COLUMNS.start.compare(a, b);
    return state.timing === "past" ? -byStart : byStart;
  }

  function passesTiming(item) {
    const timing = getItemTiming(item);
    if (state.timing === "upcoming") return timing !== "past";
    if (state.timing === "past") return timing === "past";
    return true;
  }

  function apply() {
    const q = (document.getElementById(config.ids.search)?.value ?? "").trim().toLowerCase();
    setActiveSearchQuery(q);

    state.rows = config.getItems().filter(item => {
      if (!passesTiming(item)) return false;
      if (!q) return true;
      return RECORD_SEARCH_COLUMNS
        .filter(col => columns().includes(col))
        .map(col => RECORD_COLUMNS[col].value(item))
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    state.rows.sort(compareForSort);

    render();
    const counter = document.getElementById(config.ids.counter);
    if (counter) {
      const n = state.rows.length;
      counter.textContent = `${n} ${n === 1 ? config.noun[0] : config.noun[1]}`;
    }
  }

  function render() {
    const tbody = document.getElementById(config.ids.body);
    if (!tbody) return;
    const cols = columns();

    if (state.rows.length === 0) {
      const msg = config.getItems().length === 0
        ? config.emptyText
        : `No ${config.noun[1]} match the current filters.`;
      tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(msg)}</td></tr>`;
      return;
    }

    tbody.replaceChildren(...state.rows.map(item => {
      const tr = document.createElement("tr");
      tr.className = "clickable-row";
      tr.dataset.itemId = item.id;
      cols.forEach(col => {
        const td = document.createElement("td");
        td.dataset.col = col;
        const column = RECORD_COLUMNS[col];
        if (column?.render) column.render(td, item);
        else mountSearchHighlightedText(td, column?.value(item) ?? "");
        tr.appendChild(td);
      });
      return tr;
    }));
    // Fresh rows — put the open record's highlight back on.
    syncPaneRowHighlight();
  }

  /** Cycle: unsorted → ascending → descending → unsorted. */
  function sortBy(col) {
    if (!isSortable(col)) return;
    if (state.sortCol === col) {
      if (state.sortDir === 1) state.sortDir = -1;
      else { state.sortCol = null; state.sortDir = 1; }
    } else {
      state.sortCol = col;
      state.sortDir = 1;
    }
    syncSortHeaders();
    apply();
  }

  function syncSortHeaders() {
    table()?.querySelectorAll("thead th[data-col]").forEach(th => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (state.sortCol && th.dataset.col === state.sortCol) {
        th.classList.add(state.sortDir === 1 ? "sorted-asc" : "sorted-desc");
      }
    });
  }

  function syncTimingToolbar() {
    document.querySelectorAll(`#${config.ids.timing} .filter-btn`).forEach(btn => {
      btn.classList.toggle("active", btn.dataset.timing === state.timing);
    });
  }

  function init() {
    const group = document.getElementById(config.ids.timing);
    group?.replaceChildren(...RECORD_TIMING_FILTERS.map(option => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-btn";
      btn.dataset.timing = option.key;
      btn.textContent = option.label;
      btn.addEventListener("click", () => {
        state.timing = option.key;
        syncTimingToolbar();
        apply();
      });
      return btn;
    }));
    syncTimingToolbar();

    table()?.querySelectorAll("thead th[data-col]").forEach(th => {
      if (!isSortable(th.dataset.col)) th.classList.add("th-no-sort");
      th.addEventListener("click", () => sortBy(th.dataset.col));
    });

    document.getElementById(config.ids.search)?.addEventListener("input", apply);

    // Single click opens the record — the section's primary drill-down.
    document.getElementById(config.ids.body)?.addEventListener("click", e => {
      const tr = e.target.closest("tr[data-item-id]");
      if (tr) openItemPane(config.itemType, tr.dataset.itemId);
    });

    syncSortHeaders();
  }

  const list = { apply, init, view: config.view };
  RECORD_LISTS[config.view] = list;
  return list;
}

/** Re-render the list on screen, if one is. */
function refreshRecordListsIfActive() {
  RECORD_LISTS[getCurrentAppView()]?.apply();
}

// ── The two sections ─────────────────────────────────────────────────────────

const campaignList = createRecordList({
  view: "campaigns",
  itemType: ITEM_TYPE_CAMPAIGN,
  ids: {
    table: "campaignsTable",
    body: "campaignsTableBody",
    search: "campaignSearchInput",
    timing: "campaignTimingFilters",
    counter: "campaignsRowCounter",
  },
  getItems: () => getAllCampaigns().map(campaignToItem),
  noun: ["campaign", "campaigns"],
  emptyText: "No campaigns yet — use Add campaign to create one.",
});

const tradeShowList = createRecordList({
  view: "tradeShows",
  itemType: ITEM_TYPE_TRADE_SHOW,
  ids: {
    table: "tradeShowsTable",
    body: "tradeShowsTableBody",
    search: "tradeShowSearchInput",
    timing: "tradeShowTimingFilters",
    counter: "tradeShowsRowCounter",
  },
  getItems: () => getAllTradeShows().map(tradeShowToItem),
  noun: ["show", "shows"],
  emptyText: "No trade shows yet — use Add trade show to create one.",
});

function initRecordLists() {
  Object.values(RECORD_LISTS).forEach(list => list.init());
}
