/**
 * Complete — the history of styles that got their pictures: from a
 * photoshoot marked complete, or marked complete by hand as CG (made in
 * Photoshop or with AI, from the Shoot cell's ⋮ menu). One row each time,
 * newest first; filter by Photoshoot / CG and search. A CG row can be undone.
 * The rows live in style_completions (js/store.js).
 */

let completeMethodFilter = "all"; // "all" | "photoshoot" | "cg"
let filteredCompletions = [];
let completePage = 1;
let completePageSize = TABLE_PAGE_SIZE_DEFAULT; // read once the page loads (initComplete)
/** The filters the page was last drawn with — a change starts back at page 1. */
let completePagedFor = "";
const completeSort = { col: null, dir: 1 };

const COMPLETE_METHOD_LABELS = { photoshoot: "Photoshoot", cg: "CG" };

function completionShootTitle(c) {
  const shoot = c.shootId ? getPhotoshootById(c.shootId) : null;
  return shoot ? `${getPhotoshootTitle(shoot)} · ${formatShootDate(shoot.date)}` : "";
}

const COMPLETE_SORT_COLUMNS = {
  styleNo: c => c.styleNo,
  color: c => c.color,
  description: c => findStyle(c.styleNo, c.color)?.description ?? "",
  reason: c => getShootReasonLabel(c.reason),
  method: c => COMPLETE_METHOD_LABELS[c.method],
  shoot: c => completionShootTitle(c),
  completed: c => c.completedAt,
};

function renderCompleteView() {
  const q = (document.getElementById("completeSearchInput")?.value ?? "").trim().toLowerCase();
  setActiveSearchQuery(q);
  document.querySelectorAll("#completeMethodFilters .filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.method === completeMethodFilter);
  });

  filteredCompletions = getStyleCompletions().filter(c => {
    if (completeMethodFilter !== "all" && c.method !== completeMethodFilter) return false;
    if (!q) return true;
    const style = findStyle(c.styleNo, c.color);
    return `${c.styleNo} ${c.color} ${style?.description ?? ""} ${completionShootTitle(c)} ${COMPLETE_METHOD_LABELS[c.method]}`.toLowerCase().includes(q);
  });
  // Default order: newest first.
  filteredCompletions.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  applyColumnSort(filteredCompletions, completeSort, COMPLETE_SORT_COLUMNS);
  const pagedFor = [completeMethodFilter, q].join("|");
  completePage = pagedFor === completePagedFor ? clampTablePage(completePage, filteredCompletions.length, completePageSize) : 1;
  completePagedFor = pagedFor;

  const counter = document.getElementById("completeRowCounter");
  if (counter) counter.textContent = filteredCompletions.length === 1 ? "1 style" : `${filteredCompletions.length.toLocaleString()} styles`;

  const tbody = document.getElementById("completeTableBody");
  if (!tbody) return;
  const cols = [...document.querySelectorAll("#completeTable thead th[data-col]")].map(th => th.dataset.col);
  if (!filteredCompletions.length) {
    const msg = getStyleCompletions().length
      ? "Nothing matches the current filters."
      : "Nothing complete yet — styles show here when a photoshoot with them is marked complete, or when you mark one complete (Shoot column ⋮ → Mark as Complete).";
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(msg)}</td></tr>`;
    renderCompletePager();
    return;
  }

  tbody.replaceChildren(...filteredCompletions
    .slice((completePage - 1) * completePageSize, completePage * completePageSize)
    .map(c => createCompleteRow(c, cols)));
  renderCompletePager();
  syncStylePaneRows();
}

function createCompleteRow(c, cols) {
  const style = findStyle(c.styleNo, c.color);
  const tr = document.createElement("tr");
  tr.className = style ? "clickable-row" : "";
  tr.dataset.styleNo = c.styleNo;
  tr.dataset.color = c.color;
  cols.forEach(col => {
    const td = document.createElement("td");
    td.dataset.col = col;
    switch (col) {
      case "image": td.appendChild(createStyleThumb(c.styleNo, c.color)); break;
      case "description":
        mountSearchHighlightedText(td, style?.description ?? "");
        if (style?.description) td.title = style.description;
        break;
      case "reason":
        if (c.reason) {
          const icon = document.createElement("span");
          icon.className = "complete-reason";
          icon.innerHTML = shootReasonIcon(c.reason);
          icon.title = getShootReasonLabel(c.reason);
          td.appendChild(icon);
        } else setDisplayText(td, EMPTY_DISPLAY);
        break;
      case "method": {
        const pill = document.createElement("span");
        pill.className = "complete-method";
        pill.dataset.method = c.method;
        pill.textContent = COMPLETE_METHOD_LABELS[c.method];
        td.appendChild(pill);
        break;
      }
      case "shoot": mountSearchHighlightedText(td, completionShootTitle(c) || (c.method === "photoshoot" ? "(deleted shoot)" : "")); break;
      case "completed": setDisplayText(td, c.completedAt ? formatMdy(c.completedAt.slice(0, 10)) : EMPTY_DISPLAY); break;
      case "actions":
        if (c.method === "cg") {
          const undo = document.createElement("button");
          undo.type = "button";
          undo.className = "btn complete-undo";
          undo.textContent = "Undo";
          undo.title = "Take back this CG completion — the style goes back on Need to Shoot";
          undo.addEventListener("click", () => undoCompletion(c));
          td.appendChild(undo);
        }
        break;
      default: mountSearchHighlightedText(td, c[col] ?? "");
    }
    tr.appendChild(td);
  });
  return tr;
}

async function undoCompletion(c) {
  if (!confirm(`Undo ${c.styleNo} ${c.color} marked complete (CG) on ${formatMdy(c.completedAt.slice(0, 10))}?\n\nIt goes back on Need to Shoot.`)) return;
  try {
    await undoCgCompletion(c.id);
    showIndicator(`${c.styleNo} ${c.color} is back on Need to Shoot`, "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't undo.", "error");
  }
  refreshPhotoshootViews();
}

function renderCompletePager() {
  renderTablePager("completePager", {
    total: filteredCompletions.length,
    page: completePage,
    pageSize: completePageSize,
    noun: "Styles",
    onPage: n => {
      completePage = n;
      renderCompleteView();
      document.getElementById("completeTableWrap")?.scrollTo({ top: 0 });
    },
    onPageSize: n => {
      completePageSize = n;
      saveTablePageSize("completeTable", n);
      completePage = 1;
      renderCompleteView();
    },
  });
}

function initComplete() {
  completePageSize = readTablePageSize("completeTable");
  initColumnSort("completeTable", completeSort, COMPLETE_SORT_COLUMNS, renderCompleteView);
  document.querySelectorAll("#completeMethodFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => { completeMethodFilter = btn.dataset.method; renderCompleteView(); });
  });
  document.getElementById("completeSearchInput")?.addEventListener("input", renderCompleteView);
  document.getElementById("completeTableBody")?.addEventListener("click", e => {
    if (e.target.closest("button, a, input")) return;
    const tr = e.target.closest("tr.clickable-row[data-style-no]");
    if (tr) openStylePane(tr.dataset.styleNo, tr.dataset.color);
  });
}
