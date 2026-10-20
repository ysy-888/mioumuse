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
  // "YYYY-MM-DD" sorts as a date; blanks sort last either way.
  ihd: { value: s => s.ihd },
};

/** Distinct values of a field, most common first — for the filter controls. */
function countStyleValues(field) {
  const counts = new Map();
  getAllStyles().forEach(s => counts.set(s[field], (counts.get(s[field]) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function compareStyles(a, b) {
  if (styleSortCol) {
    // compareSortValues (js/photoshoots.js) keeps blanks last in both directions.
    const primary = compareSortValues(STYLE_COLUMNS[styleSortCol].value(a), STYLE_COLUMNS[styleSortCol].value(b), styleSortDir);
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
    if (!columnFilterPasses("stylesTable", "ihd", monthFilterKey(s.ihd))) return false;
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

/**
 * The Shoot cell: where the style stands, plus an "Add to Need to Shoot"
 * button when it isn't waiting to be shot (never listed, or already shot).
 */
function createStyleShootCell(style) {
  const wrap = document.createElement("span");
  wrap.className = "style-shoot-cell";
  const fill = () => {
    const onList = needsShoot(style.styleNo, style.color);
    const shot = describeShootStatus(style.styleNo, style.color)?.tone === "shot";
    wrap.replaceChildren();
    if (onList || shot) wrap.appendChild(createShootStatusBadge(style.styleNo, style.color));
    if (onList) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn style-add-shoot-btn";
    btn.textContent = shot ? "+ Shoot again" : "+ Need to Shoot";
    btn.title = shot ? "Add to Need to Shoot again" : "Add to Need to Shoot";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await addToShootList([style]);
        fill();
        refreshPhotoshootViews();
        showIndicator(`${style.styleNo} ${style.color} added to Need to Shoot`, "success");
      } catch (err) {
        btn.disabled = false;
        showIndicator(err.message || "Couldn't add to Need to Shoot.", "error");
      }
    });
    wrap.appendChild(btn);
  };
  fill();
  return wrap;
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
      else if (col === "shoot") td.appendChild(createStyleShootCell(style));
      else if (col === "ihd") td.appendChild(createIhdInput(style));
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

// ── IHD (in-house date) ──────────────────────────────────────────────────────
//
// Edited right in the table, as text: the first click selects the whole date
// (so it can be copied, or pasted over), and it shows as MM/DD/YY. Typed or
// pasted dates save on Enter or when you leave the cell; the calendar button
// picks one and saves straight away. Esc undoes the edit.

/** `onSaved` runs after a successful save — for views whose warnings depend on it. */
function createIhdInput(style, { onSaved } = {}) {
  const wrap = document.createElement("span");
  wrap.className = "cell-date";

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "mm/dd/yy";
  input.className = "cell-date-input";
  input.value = formatMdy(style.ihd);
  input.setAttribute("aria-label", `IHD for ${style.styleNo} ${style.color}`);

  // The calendar: a native date box kept out of sight, opened by the button.
  const picker = document.createElement("input");
  picker.type = "date";
  picker.className = "cell-date-picker";
  picker.tabIndex = -1;
  picker.setAttribute("aria-hidden", "true");

  const pickBtn = document.createElement("button");
  pickBtn.type = "button";
  pickBtn.className = "cell-date-pick";
  pickBtn.title = "Pick a date";
  pickBtn.setAttribute("aria-label", `Pick IHD for ${style.styleNo} ${style.color}`);
  pickBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "cell-date-clear";
  clear.textContent = "✕";
  clear.title = "Clear IHD";
  clear.setAttribute("aria-label", `Clear IHD for ${style.styleNo} ${style.color}`);
  clear.hidden = !style.ihd;

  const show = () => {
    input.value = formatMdy(style.ihd);
    input.classList.remove("is-invalid");
  };

  const save = async value => {
    const before = style.ihd;
    if (value === before) {
      show();
      return;
    }
    wrap.classList.add("is-saving");
    try {
      await setStyleIhd(style.styleNo, style.color, value);
      show();
      clear.hidden = !value;
      wrap.classList.remove("is-saving");
      wrap.classList.add("is-saved");
      setTimeout(() => wrap.classList.remove("is-saved"), 1200);
      onSaved?.();
    } catch (err) {
      show();
      wrap.classList.remove("is-saving");
      showIndicator(err.message || "Couldn't save the IHD.", "error");
    }
  };

  const commit = () => {
    const text = input.value.trim();
    const value = parseDateText(text);
    if (value === null) {
      showIndicator(`"${text}" isn't a date — try 10/28/26.`, "error");
      show();
      return;
    }
    save(value);
  };

  // Select the whole date on the first click. The mouseup that follows the
  // focusing click would drop the selection, so that one is cancelled.
  let justFocused = false;
  input.addEventListener("focus", () => {
    input.select();
    justFocused = true;
  });
  input.addEventListener("mouseup", e => {
    if (justFocused) e.preventDefault();
    justFocused = false;
  });
  input.addEventListener("keydown", e => {
    justFocused = false;
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur(); // blur commits
    } else if (e.key === "Escape") {
      e.stopPropagation();
      show();
      input.blur();
    }
  });
  input.addEventListener("input", () => {
    input.classList.toggle("is-invalid", parseDateText(input.value) === null);
  });
  input.addEventListener("blur", commit);

  pickBtn.addEventListener("click", () => {
    picker.value = style.ihd;
    try {
      picker.showPicker();
    } catch {
      picker.focus();
      picker.click();
    }
  });
  picker.addEventListener("change", () => {
    if (picker.value && isPlausibleYmd(picker.value)) save(picker.value);
  });
  clear.addEventListener("click", () => save(""));

  wrap.append(input, picker, pickBtn, clear);
  return wrap;
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
    if (!STYLE_COLUMNS[th.dataset.col]) th.classList.add("th-no-sort");
    th.addEventListener("click", () => sortStylesBy(th.dataset.col));
  });
  initColumnFilter("stylesTable", "ihd", {
    options: () => monthFilterOptions(getAllStyles().map(s => s.ihd)),
    onChange: () => applyStyleFilters(),
  });
  document.getElementById("styleSearchInput")?.addEventListener("input", () => applyStyleFilters());
  document.getElementById("stylesTableBody")?.addEventListener("click", e => {
    // The tick box (and its cell) selects; the IHD cell edits; the Need to
    // Shoot button adds; anywhere else
    // opens the photos.
    if (e.target.closest('td[data-col="select"]')) {
      if (e.target.tagName !== "INPUT") e.target.closest("td").querySelector("input")?.click();
      return;
    }
    if (e.target.closest('td[data-col="ihd"], .style-add-shoot-btn')) return;
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
