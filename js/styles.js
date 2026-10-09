/**
 * Styles — the style database imported from the N41 ATS export.
 *
 * A table of every Style # + Color, filtered by N41 status from the toolbar
 * and by season and category from the two selects, with search across all
 * of it. Thousands of rows, so the table draws a page at a time and grows
 * with "Show more".
 *
 * Rows can be ticked (or all of the current view at once) and added to the
 * Need to Shoot list; the Shoot column shows where each style stands.
 */

const STYLE_PAGE = 300;

let filteredStyles = [];
let styleStatusFilter = "";
let styleSeasonFilter = "";
let styleCategoryFilter = "";
let styleSortCol = null;
let styleSortDir = 1;
let styleShown = STYLE_PAGE;

/**
 * Ticked rows, by styleKey. Kept across filtering and searching, so a
 * selection can be built up from several searches before acting on it.
 */
let selectedStyleKeys = new Set();

const STYLE_COLUMNS = {
  styleNo: { value: s => s.styleNo },
  color: { value: s => s.color },
  description: { value: s => s.description },
  category: { value: s => s.category },
  season: { value: s => s.season },
  status: { value: s => s.status },
};

/** Distinct values of a field, most common first — for the filter controls. */
function countStyleValues(field) {
  const counts = new Map();
  getAllStyles().forEach(s => counts.set(s[field], (counts.get(s[field]) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function compareStyles(a, b) {
  if (styleSortCol) {
    const primary = compareTextFieldValues(STYLE_COLUMNS[styleSortCol].value(a), STYLE_COLUMNS[styleSortCol].value(b)) * styleSortDir;
    if (primary !== 0) return primary;
  }
  return a.styleNo.localeCompare(b.styleNo, undefined, { numeric: true }) || a.color.localeCompare(b.color);
}

function applyStyleFilters({ keepShown = false } = {}) {
  const q = (document.getElementById("styleSearchInput")?.value ?? "").trim().toLowerCase();
  setActiveSearchQuery(q);

  filteredStyles = getAllStyles().filter(s => {
    if (styleStatusFilter && s.status !== styleStatusFilter) return false;
    if (styleSeasonFilter && s.season !== styleSeasonFilter) return false;
    if (styleCategoryFilter && s.category !== styleCategoryFilter) return false;
    if (!q) return true;
    return `${s.styleNo} ${s.color} ${s.description} ${s.category} ${s.season} ${s.status}`.toLowerCase().includes(q);
  });
  filteredStyles.sort(compareStyles);
  if (!keepShown) styleShown = STYLE_PAGE;

  renderStyleFilters();
  renderStylesTable();
  const counter = document.getElementById("stylesRowCounter");
  if (counter) {
    const n = filteredStyles.length;
    counter.textContent = n === 1 ? "1 style" : `${n.toLocaleString()} styles`;
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────

/** Status buttons and the season / category selects, rebuilt from the data. */
function renderStyleFilters() {
  const group = document.getElementById("styleStatusFilters");
  if (group) {
    const statuses = countStyleValues("status").filter(([v]) => v);
    group.replaceChildren(...[["", null], ...statuses].map(([value, n]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-btn" + (value === styleStatusFilter ? " active" : "");
      btn.dataset.status = value;
      btn.textContent = value || "All";
      if (n) btn.title = `${n.toLocaleString()} styles`;
      btn.addEventListener("click", () => {
        styleStatusFilter = value;
        applyStyleFilters();
      });
      return btn;
    }));
  }

  const fillSelect = (id, field, current, label) => {
    const select = document.getElementById(id);
    if (!select) return;
    const values = countStyleValues(field).filter(([v]) => v).sort((a, b) => a[0].localeCompare(b[0]));
    select.replaceChildren(
      new Option(`All ${label}`, ""),
      ...values.map(([v, n]) => new Option(`${v} (${n.toLocaleString()})`, v)),
    );
    select.value = current;
  };
  fillSelect("styleSeasonFilter", "season", styleSeasonFilter, "seasons");
  fillSelect("styleCategoryFilter", "category", styleCategoryFilter, "categories");
}

// ── Table ────────────────────────────────────────────────────────────────────

function createStyleStatusPill(status) {
  const pill = document.createElement("span");
  pill.className = "style-status";
  pill.dataset.status = status;
  mountSearchHighlightedText(pill, status || EMPTY_DISPLAY);
  return pill;
}

function renderStylesTable() {
  const tbody = document.getElementById("stylesTableBody");
  if (!tbody) return;
  const cols = [...document.querySelectorAll("#stylesTable thead th[data-col]")].map(th => th.dataset.col);

  if (filteredStyles.length === 0) {
    const msg = getAllStyles().length === 0
      ? "No styles yet — use Import Excel to load the ATS export."
      : "No styles match the current filters.";
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(msg)}</td></tr>`;
    return;
  }

  const rows = filteredStyles.slice(0, styleShown).map(style => {
    const tr = document.createElement("tr");
    // Click a row for all of its photos.
    tr.className = "clickable-row";
    tr.dataset.styleNo = style.styleNo;
    tr.dataset.color = style.color;
    cols.forEach(col => {
      const td = document.createElement("td");
      td.dataset.col = col;
      if (col === "select") td.appendChild(createStyleCheckbox(style));
      else if (col === "image") td.appendChild(createStyleThumb(style.styleNo, style.color));
      else if (col === "shoot") td.appendChild(createShootStatusBadge(style.styleNo, style.color));
      else if (col === "status") td.appendChild(createStyleStatusPill(style.status));
      else mountSearchHighlightedText(td, STYLE_COLUMNS[col].value(style));
      if (col === "description" && style.description) td.title = style.description;
      tr.appendChild(td);
    });
    return tr;
  });

  const remaining = filteredStyles.length - styleShown;
  if (remaining > 0) {
    const tr = document.createElement("tr");
    tr.className = "state-row style-more-row";
    const td = document.createElement("td");
    td.colSpan = cols.length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = `Show ${Math.min(STYLE_PAGE, remaining).toLocaleString()} more (${remaining.toLocaleString()} left)`;
    btn.addEventListener("click", () => {
      styleShown += STYLE_PAGE;
      renderStylesTable();
    });
    td.appendChild(btn);
    tr.appendChild(td);
    rows.push(tr);
  }
  tbody.replaceChildren(...rows);
  syncStyleSelectionUi();
}

// ── Selection ────────────────────────────────────────────────────────────────

function createStyleCheckbox(style) {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "row-select";
  cb.checked = selectedStyleKeys.has(styleKey(style.styleNo, style.color));
  cb.setAttribute("aria-label", `Select ${style.styleNo} ${style.color}`);
  cb.addEventListener("change", () => {
    const key = styleKey(style.styleNo, style.color);
    if (cb.checked) selectedStyleKeys.add(key); else selectedStyleKeys.delete(key);
    syncStyleSelectionUi();
  });
  return cb;
}

function getSelectedStyles() {
  return getAllStyles().filter(s => selectedStyleKeys.has(styleKey(s.styleNo, s.color)));
}

/** The header box (all / some / none of the filtered rows) and the action bar. */
function syncStyleSelectionUi() {
  const all = document.getElementById("styleSelectAll");
  if (all) {
    const picked = filteredStyles.filter(s => selectedStyleKeys.has(styleKey(s.styleNo, s.color))).length;
    all.checked = picked > 0 && picked === filteredStyles.length;
    all.indeterminate = picked > 0 && picked < filteredStyles.length;
    all.title = `Select all ${filteredStyles.length.toLocaleString()} in this view`;
  }
  const bar = document.getElementById("styleSelectionBar");
  if (bar) {
    const n = selectedStyleKeys.size;
    bar.hidden = n === 0;
    const count = document.getElementById("styleSelectionCount");
    if (count) count.textContent = `${n.toLocaleString()} selected`;
  }
}

function clearStyleSelection() {
  selectedStyleKeys = new Set();
  renderStylesTable();
}

async function addSelectedToShootList() {
  const styles = getSelectedStyles();
  if (!styles.length) return;
  try {
    const added = await addToShootList(styles);
    const already = styles.length - added;
    clearStyleSelection();
    refreshPhotoshootViews();
    showIndicator(added
      ? `${added.toLocaleString()} added to Need to Shoot${already ? ` (${already.toLocaleString()} already on it)` : ""}`
      : "Already on Need to Shoot", "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't add to Need to Shoot.", "error");
  }
}

/** Cycle: unsorted → ascending → descending → unsorted. */
function sortStylesBy(col) {
  if (!STYLE_COLUMNS[col]) return;
  if (styleSortCol === col) {
    if (styleSortDir === 1) styleSortDir = -1;
    else { styleSortCol = null; styleSortDir = 1; }
  } else {
    styleSortCol = col;
    styleSortDir = 1;
  }
  document.querySelectorAll("#stylesTable thead th[data-col]").forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (styleSortCol && th.dataset.col === styleSortCol) th.classList.add(styleSortDir === 1 ? "sorted-asc" : "sorted-desc");
  });
  applyStyleFilters();
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initStylesView() {
  document.querySelectorAll("#stylesTable thead th[data-col]").forEach(th => {
    th.addEventListener("click", () => sortStylesBy(th.dataset.col));
  });
  document.getElementById("styleSearchInput")?.addEventListener("input", () => applyStyleFilters());
  document.getElementById("stylesTableBody")?.addEventListener("click", e => {
    // The tick box (and its cell) selects; anywhere else opens the photos.
    if (e.target.closest('td[data-col="select"]')) {
      if (e.target.tagName !== "INPUT") e.target.closest("td").querySelector("input")?.click();
      return;
    }
    const tr = e.target.closest("tr[data-style-no]");
    if (tr) openStyleGallery(tr.dataset.styleNo, tr.dataset.color);
  });

  // Header box: every row in the current view, not just the ones drawn.
  document.getElementById("styleSelectAll")?.addEventListener("change", e => {
    filteredStyles.forEach(s => {
      const key = styleKey(s.styleNo, s.color);
      if (e.target.checked) selectedStyleKeys.add(key); else selectedStyleKeys.delete(key);
    });
    renderStylesTable();
  });
  document.getElementById("styleAddToShootBtn")?.addEventListener("click", addSelectedToShootList);
  document.getElementById("styleClearSelectionBtn")?.addEventListener("click", clearStyleSelection);
  document.getElementById("styleSeasonFilter")?.addEventListener("change", e => {
    styleSeasonFilter = e.target.value;
    applyStyleFilters();
  });
  document.getElementById("styleCategoryFilter")?.addEventListener("change", e => {
    styleCategoryFilter = e.target.value;
    applyStyleFilters();
  });
  initStyleImport();
}
