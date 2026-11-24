/**
 * Styles — the style database imported from the N41 Style Master.
 *
 * A table of every Style # + Color, filtered from the Category, Season, N41
 * Status and IHD column headers, by the No photos button, and by search
 * across all of it. Thousands of rows, so the table draws a page at a time and grows
 * with "Show more".
 *
 * Rows can be ticked (or all of the current view at once) and added to the
 * Need to Shoot list, or deleted (kept in the database so imports skip them;
 * the trash button lists them to restore); the Shoot column shows where each
 * style stands.
 */

let filteredStyles = [];
let styleNoPhotosOnly = false; // needs the image folder
/** The deleted styles instead of the rest, to restore some. Search only. */
let styleShowDeleted = false;
let styleSortCol = null;
let styleSortDir = 1;
let stylePage = 1;
let stylePageSize = TABLE_PAGE_SIZE_DEFAULT; // read once the page loads (initStyles)

/**
 * Ticked rows, by styleKey. Kept across filtering and searching, so a
 * selection can be built up from several searches before acting on it.
 */
let selectedStyleKeys = new Set();

/** The figures, in order: the style's field and its key. Received is the Style Master's; the rest the ATS report's. */
const STYLE_QTY_FIGURES = [
  { col: "oh", label: "OH" }, { col: "wip", label: "WIP" }, { col: "oo", label: "OO" }, { col: "ats", label: "ATS" },
  { col: "receivedQty", label: "Received" }, { col: "invQty", label: "Invoiced" },
];

const STYLE_COLUMNS = {
  styleNo: { value: s => s.styleNo },
  color: { value: s => s.color },
  description: { value: s => s.description },
  category: { value: s => s.category },
  season: { value: s => s.season },
  // The Style Master's user2: "1", "2" or blank.
  show: { value: s => s.show ?? "" },
  status: { value: s => s.status },
  // Showing on the webstore (js/magento-availability.js).
  magento: { value: s => styleMgStatusText(s) },
  // "YYYY-MM" sorts as a date; shown as a JUL 26 pill.
  available: { value: s => s.availableDate ?? "", display: s => formatMonYY(s.availableDate) },
  // "YYYY-MM-DD" sorts as a date; blanks on top soonest first, at the bottom latest first.
  ihd: { value: s => ihdSortValue(s) }, // as it shows: a PO's 1/1 placeholder as blank, an old 0026-… as 2026
  notes: { value: s => s.notes ?? "" },
  // The figures, shown together in the Qty column (createStyleQtyStrip) but
  // each sorted and filtered from its own sub-header. Sorted as numbers,
  // blanks last either way.
  ...Object.fromEntries(STYLE_QTY_FIGURES.map(({ col }) => [col, {
    value: s => numOrNull(s[col]),
    numeric: true,
  }])),
};

/** The figure columns, in the order the Qty column and the style pane show them. */
const STYLE_QTY_COLS = STYLE_QTY_FIGURES.map(f => f.col);

/**
 * A style's figures to show: { col, label, text, tone } in order. 0 or blank
 * is a light dash ("empty") — except ATS, which reads 0 and is "pos" above
 * 0, "neg" at or below.
 */
function styleQtyFigures(style) {
  return STYLE_QTY_FIGURES.map(({ col, label }) => {
    const n = numOrNull(style[col]);
    if (col === "ats" && n !== null) return { col, label, text: n.toLocaleString(), tone: n > 0 ? "pos" : "neg" };
    if (n === null || n === 0) return { col, label, text: "—", tone: "empty" };
    return { col, label, text: n.toLocaleString(), tone: "" };
  });
}

/** The Styles table's Qty cell: the six figures in a row, lined up under the sub-headers. */
function createStyleQtyStrip(style) {
  const strip = document.createElement("span");
  strip.className = "style-qtys";
  styleQtyFigures(style).forEach(({ col, text, tone }) => {
    const v = document.createElement("span");
    v.className = "style-qty" + (tone ? ` is-${tone}` : "");
    v.dataset.col = col;
    v.textContent = text;
    strip.appendChild(v);
  });
  return strip;
}

/** A figure's filter choice: above 0, 0 or blank, below 0 (as on Magento Products). */
const STYLE_QTY_BUCKETS = { pos: "Above 0", zero: "– (0 or blank)", neg: "Below 0" };

function styleQtyFilterKey(v) {
  const n = numOrNull(v);
  return n === null || n === 0 ? "zero" : n > 0 ? "pos" : "neg";
}

function styleQtyFilterOptions(col) {
  const counts = new Map();
  getAllStyles().forEach(s => {
    const key = styleQtyFilterKey(STYLE_COLUMNS[col].value(s));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Object.keys(STYLE_QTY_BUCKETS).filter(k => counts.has(k))
    .map(key => ({ key, label: STYLE_QTY_BUCKETS[key], count: counts.get(key) }));
}

/** N41's available month, "2026-07" → "JUL 26" ("" when there's none). */
function formatMonYY(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym ?? ""));
  if (!m) return "";
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][Number(m[2]) - 1];
  return month ? `${month} ${m[1].slice(2)}` : "";
}

/**
 * The Available month as a rounded pill (null when there's none) — amber
 * when the colour's newest PO is filed under another month (applyPoIhds).
 */
function formatAvailableMonth(ym) {
  return formatMonYY(ym).split(" ")[0];
}

function createAvailablePill(ym, style = null) {
  const text = formatAvailableMonth(ym);
  if (!text) return null;
  const pill = document.createElement("span");
  pill.className = "available-pill";
  pill.textContent = text;
  if (style?.availMismatch && style.newestPo) {
    const po = style.newestPo;
    pill.classList.add("is-mismatch");
    pill.title = `Doesn't match its newest PO: PO # ${po.poNo} is in ${formatMonYY(po.month)}`
      + (po.tentative ? " (ETA not set yet)" : ` (ETA ${formatMdy(po.etaFinal)}${po.etaFromReceived ? ", received" : ""})`);
  }
  return pill;
}

/**
 * The Available pill with the IHD under it once it's confirmed — a PO ETA
 * that isn't N41's 1/1 placeholder, or a date typed in (as on the POs page).
 */
function createAvailableWithIhd(style) {
  const dates = document.createElement("div");
  dates.className = "po-color-dates";
  const pill = createAvailablePill(style.availableDate, style);
  if (pill) dates.appendChild(pill);
  else {
    const empty = document.createElement("span");
    setDisplayText(empty, EMPTY_DISPLAY);
    dates.appendChild(empty);
  }
  const ihd = ihdSortValue(style);
  if (ihd) {
    const date = document.createElement("span");
    date.className = "po-color-ihd";
    date.textContent = formatMdy(ihd);
    date.title = style.ihdFromPo ? "IHD — from the PO ETA" : "IHD — typed in";
    dates.appendChild(date);
  }
  return dates;
}

/** What search looks through for a style. */
function styleSearchText(s) {
  return `${s.styleNo} ${s.color} ${s.description} ${s.category} ${s.season} ${s.status} ${formatMonYY(s.availableDate)} ${formatMonYY(s.availableDate).replace(" ", "")} ${s.memo ?? ""} ${s.notes ?? ""}`.toLowerCase();
}

/** Statuses the No photos button leaves out (CANCEL also covers CANCELLED…). */
const NO_PHOTOS_SKIP_STATUSES = ["COMPANY", "CANCEL", "INACTIVE"];

/** The styles the table is showing: the live ones, or the deleted ones. */
function getShownStyleSource() {
  return styleShowDeleted ? getDeletedStyles() : getAllStyles();
}

/** Header filters (N41 Status, Category, Season): a key per value, blank as (Blank). */
function statusFilterKey(status) {
  return String(status ?? "").trim() || BLANK_FILTER_LABEL;
}

function statusFilterOptions(statuses) {
  const counts = new Map();
  statuses.forEach(s => {
    const key = statusFilterKey(s);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.keys()]
    .sort((a, b) => (a === BLANK_FILTER_LABEL) - (b === BLANK_FILTER_LABEL) || a.localeCompare(b))
    .map(key => ({ key, label: key, count: counts.get(key) }));
}

/** COMPANY and CANCEL (or CANCELLED…) start unticked. */
function isStatusHiddenByDefault(key) {
  const upper = key.toUpperCase();
  return STATUS_HIDDEN_BY_DEFAULT.some(s => upper === s || upper.startsWith(s));
}

/** On Styles, INACTIVE starts unticked too. */
function isStyleStatusHiddenByDefault(key) {
  return isStatusHiddenByDefault(key) || key.toUpperCase() === "INACTIVE";
}

function compareStyles(a, b) {
  if (styleSortCol && STYLE_COLUMNS[styleSortCol].numeric) {
    const x = STYLE_COLUMNS[styleSortCol].value(a);
    const y = STYLE_COLUMNS[styleSortCol].value(b);
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else if (x !== y) return styleSortDir * (x - y);
  } else if (styleSortCol) {
    // compareSortValues (js/photoshoots.js) keeps blanks last — but IHD soonest first puts them on top.
    const primary = compareSortValues(STYLE_COLUMNS[styleSortCol].value(a), STYLE_COLUMNS[styleSortCol].value(b), styleSortDir,
      { blankFirstAscending: BLANK_FIRST_SORT_COLUMNS.has(styleSortCol) });
    if (primary !== 0) return primary;
  }
  return a.styleNo.localeCompare(b.styleNo, undefined, { numeric: true }) || a.color.localeCompare(b.color);
}

function applyStyleFilters({ keepShown = false } = {}) {
  const q = (document.getElementById("styleSearchInput")?.value ?? "").trim().toLowerCase();
  setActiveSearchQuery(q);
  const noPhotos = styleNoPhotosOnly && arePhotosKnown();

  filteredStyles = getShownStyleSource().filter(s => {
    if (styleShowDeleted) return !q || styleSearchText(s).includes(q);
    if (!columnFilterPasses("stylesTable", "status", statusFilterKey(s.status))) return false;
    if (!columnFilterPasses("stylesTable", "category", statusFilterKey(s.category))) return false;
    if (!columnFilterPasses("stylesTable", "season", statusFilterKey(s.season))) return false;
    if (!columnFilterPasses("stylesTable", "show", statusFilterKey(s.show))) return false;
    if (!columnFilterPasses("stylesTable", "available", monthFilterKey(s.availableDate))) return false;
    if (noPhotos && (NO_PHOTOS_SKIP_STATUSES.some(st => statusFilterKey(s.status).toUpperCase().startsWith(st)) || hasStyleImages(s.styleNo, s.color))) return false;
    if (!STYLE_QTY_COLS.every(col => columnFilterPasses("stylesTable", col, styleQtyFilterKey(STYLE_COLUMNS[col].value(s))))) return false;
    if (!q) return true;
    return styleSearchText(s).includes(q);
  });
  filteredStyles.sort(compareStyles);
  // A new search or filter starts at page 1; a redraw (a save, a photo scan) stays put.
  stylePage = keepShown ? clampTablePage(stylePage, filteredStyles.length, stylePageSize) : 1;

  renderStyleFilters();
  renderStylesTable();
  const counter = document.getElementById("stylesRowCounter");
  if (counter) {
    const n = filteredStyles.length;
    const noun = styleShowDeleted ? "deleted style" : "style";
    counter.textContent = n === 1 ? `1 ${noun}` : `${n.toLocaleString()} ${noun}s`;
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────

/**
 * The No photos button: only usable once the image folder has been read.
 * The Deleted button: there once anything's deleted. Showing the deleted
 * styles turns the rest of the filters off.
 */
function renderStyleFilters() {
  const btn = document.getElementById("styleNoPhotosBtn");
  if (btn) {
    const known = arePhotosKnown() && !styleShowDeleted;
    btn.classList.toggle("active", known && styleNoPhotosOnly);
    btn.setAttribute("aria-pressed", String(known && styleNoPhotosOnly));
    btn.disabled = !known;
    btn.title = btn.getAttribute("aria-label") + (!styleShowDeleted && !arePhotosKnown() ? " — link the image folder (menu ⋮) to filter by photos" : "");
  }
  const deleted = document.getElementById("styleDeletedBtn");
  if (deleted) {
    const count = getDeletedStyles().length;
    deleted.hidden = !count && !styleShowDeleted;
    deleted.classList.toggle("active", styleShowDeleted);
    deleted.setAttribute("aria-pressed", String(styleShowDeleted));
    deleted.title = `${deleted.getAttribute("aria-label")} (${count.toLocaleString()})`;
  }
}

function setStyleShowDeleted(on) {
  styleShowDeleted = on;
  selectedStyleKeys = new Set();
  applyStyleFilters();
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
 * The Shoot cell: a Need to Shoot button when the style isn't waiting (never
 * listed, or already done); Photoshoot / CG when it is — and beside them the
 * date it's scheduled for or was shot.
 */
function createStyleShootCell(style, { suggested = false, editSample = false } = {}) {
  const wrap = document.createElement("span");
  wrap.className = "style-shoot-cell";
  const addSample = editSample ? addSampleStatusSelect : addSampleStatusPill;
  const fill = () => {
    if (isNoShootStyle(style.styleNo, style.color)) {
      const none = document.createElement("span");
      none.className = "style-no-shoot";
      none.textContent = "No shoot needed";
      none.title = `${style.status} styles aren't photographed`;
      wrap.replaceChildren(none);
      addSample(wrap, style);
      return;
    }
    // The lit button says which; only a date (scheduled / shot) needs more.
    const tone = describeShootStatus(style.styleNo, style.color)?.tone;
    wrap.replaceChildren(createShootPicker(style.styleNo, style.color, () => {
      fill();
      refreshPhotoshootViews();
    }, { suggested }));
    if (tone === "scheduled" || tone === "shot") wrap.appendChild(createShootStatusBadge(style.styleNo, style.color, { compact: true }));
    addSample(wrap, style);
  };
  fill();
  return wrap;
}

function getSampleStatusLabel(key) {
  return SAMPLE_STATUSES.find(s => s.key === key)?.label ?? "";
}

/** The TOP date / PO from the production sheet, for a tooltip — "" if none. */
function sampleStatusTitle(saved) {
  return saved?.topDate ? `TOP comments in ${formatMdy(saved.topDate)}${saved.topPo ? ` · PO ${saved.topPo}` : ""}` : "";
}

/**
 * How many of these styles ([{ styleNo, color }]) are at each sample status:
 * [{ key, label, count }] for TOP / SHOW / PP, then None ("").
 */
function countSampleStatuses(styles) {
  const counts = new Map([...SAMPLE_STATUS_KEYS, ""].map(k => [k, 0]));
  for (const s of styles) {
    const key = findStyle(s.styleNo, s.color)?.sampleStatus ?? "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...SAMPLE_STATUSES, { key: "", label: "None" }].map(s => ({ ...s, count: counts.get(s.key) }));
}

// ── Samples: which are in, and which one goes to the shoot ──────────────────
//
// A colour's samples: Show (the Style Master's user2, a count from N41),
// PP1–PP3 (ticked in order — ppSamples is the count) and TOP. Its sample
// status, the one taken to the photoshoot, can only be one it has; it's
// flagged when a better one is in. Best first: TOP, SHOW, PP (SAMPLE_STATUSES).

/** How many show samples (the Style Master's user2): 0 when blank. */
function showSampleCount(style) {
  const n = parseInt(String(style?.show ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Whether the colour has this sample ("top" | "show" | "pp"). */
function hasSample(style, key) {
  if (!style) return false;
  if (key === "top") return Boolean(style.topSample);
  if (key === "show") return showSampleCount(style) > 0;
  if (key === "pp") return (style.ppSamples ?? 0) > 0;
  return false;
}

/** The best sample it has that beats `status` (TOP over SHOW over PP), "" if none. */
function betterSampleThan(style, status = style?.sampleStatus) {
  const i = SAMPLE_STATUS_KEYS.indexOf(status);
  if (i <= 0) return "";
  return SAMPLE_STATUS_KEYS.slice(0, i).find(k => hasSample(style, k)) ?? "";
}

/**
 * Why the status is flagged, "" when it isn't: the sample isn't in (any
 * more), or a better one is.
 */
function sampleStatusFlag(style, status = style?.sampleStatus) {
  if (!style || !status) return "";
  const label = getSampleStatusLabel(status);
  if (!hasSample(style, status)) {
    return status === "show" ? "⚑ No SHOW sample — Show is blank in N41" : `⚑ No ${label} sample is ticked for this colour`;
  }
  const better = betterSampleThan(style, status);
  return better ? `⚑ A ${getSampleStatusLabel(better)} sample is in — better than ${label}` : "";
}

/** The colour's sample status (TOP / SHOW / PP) as a read-only pill, nothing if none. */
function addSampleStatusPill(wrap, style) {
  const saved = findStyle(style.styleNo, style.color) ?? style;
  if (!getSampleStatusLabel(saved.sampleStatus)) return;
  wrap.classList.add("has-top");
  const pill = document.createElement("span");
  pill.className = "style-top-pill";
  pill.dataset.sample = saved.sampleStatus;
  pill.textContent = getSampleStatusLabel(saved.sampleStatus);
  const flag = sampleStatusFlag(saved);
  pill.classList.toggle("is-show-pp", Boolean(flag));
  pill.title = `Sample status: ${pill.textContent}${saved.sampleStatus === "top" && saved.topDate ? ` · ${sampleStatusTitle(saved)}` : ""}`
    + (flag ? `\n${flag}` : "");
  wrap.appendChild(pill);
}

/**
 * The sample status — the sample taken to the shoot — as a dropdown
 * (— / TOP / SHOW / PP) that saves as soon as it's picked: Need to Shoot,
 * the shoot pane, the style pane, a PO's colours. Only the samples the
 * colour has can be picked; flagged red when a better one is in.
 */
function createSampleStatusSelect(style) {
  const saved = findStyle(style.styleNo, style.color);
  const select = document.createElement("select");
  select.className = "sample-status-select";
  select.setAttribute("aria-label", `Sample status for ${style.styleNo} ${style.color}`);
  const options = SAMPLE_STATUSES.map(s => {
    const has = hasSample(saved, s.key);
    const o = new Option(s.label, s.key);
    o.disabled = !has;
    o.title = has ? "" : `No ${s.label} sample ticked`;
    return o;
  });
  select.append(new Option("—", ""), ...options);
  const show = value => {
    select.value = value;
    select.dataset.sample = value;
    const top = value === "top" ? sampleStatusTitle(saved) : "";
    const flag = sampleStatusFlag(saved, value);
    select.classList.toggle("is-show-pp", Boolean(flag));
    const none = options.every(o => o.disabled);
    select.title = value
      ? `Sample status: ${getSampleStatusLabel(value)}${top ? ` · ${top}` : ""}${flag ? `\n${flag}` : ""}`
      : none ? "No samples ticked yet — tick them in the style's Samples" : "Sample status";
  };
  show(saved?.sampleStatus ?? "");
  if (!saved) {
    select.disabled = true;
    select.title = "Not in the Styles database";
    return select;
  }
  // Keep a click on it from opening the row it sits in.
  for (const type of ["click", "mousedown", "pointerdown", "dblclick"]) select.addEventListener(type, e => e.stopPropagation());
  select.addEventListener("change", async () => {
    const before = saved.sampleStatus;
    const value = select.value;
    show(value);
    select.disabled = true;
    try {
      await setStyleSampleStatus(saved.styleNo, saved.color, value);
      // Lets a count of them (a shoot's) update.
      select.dispatchEvent(new CustomEvent("samplestatuschange", { bubbles: true }));
      // The style pane, if it's open on this colour beside the list.
      if (select.closest("#stylePane")) refreshSampleViews(); // the lists behind it
      else if (paneStyle?.styleNo === saved.styleNo && paneStyle?.color === saved.color) refreshStylePaneSummary();
    } catch (err) {
      show(before);
      showIndicator(err.message || "Couldn't save the sample status.", "error");
    } finally {
      select.disabled = false;
    }
  });
  return select;
}

function addSampleStatusSelect(wrap, style) {
  wrap.classList.add("has-top");
  wrap.appendChild(createSampleStatusSelect(style));
}

/**
 * The PP1 / PP2 / PP3 and TOP tick boxes for a colour. PPs go in order:
 * PP2 can be ticked once PP1 is, and only the last one ticked can be
 * cleared. Saves as soon as one is clicked, then redraws every view that
 * shows the colour's samples.
 */
function createSampleChecks(style) {
  const saved = findStyle(style.styleNo, style.color);
  const wrap = document.createElement("span");
  wrap.className = "sample-checks";
  const box = (label, checked, enabled, title, onChange) => {
    const l = document.createElement("label");
    l.className = "sample-check" + (checked ? " is-on" : "");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.disabled = !saved || !enabled;
    input.setAttribute("aria-label", `${label} sample for ${style.styleNo} ${style.color}`);
    input.addEventListener("change", () => onChange(input));
    l.title = saved ? title : "Not in the Styles database";
    l.append(input, document.createTextNode(label));
    // Keep a click from opening the row it sits in.
    l.addEventListener("click", e => e.stopPropagation());
    return l;
  };
  const save = async (input, change) => {
    input.disabled = true;
    try {
      await setStyleSamples(saved.styleNo, saved.color, change);
      refreshSampleViews();
    } catch (err) {
      input.checked = !input.checked;
      input.disabled = false;
      showIndicator(err.message || "Couldn't save the sample.", "error");
    }
  };
  const pp = saved?.ppSamples ?? 0;
  const pps = document.createElement("span");
  pps.className = "sample-check-group";
  // PP2 and PP3 show once the one before is ticked.
  [1, 2, 3].filter(n => n <= pp + 1).forEach(n => {
    const on = n <= pp;
    // Tick the next one, or clear the last one.
    const enabled = on ? n === pp : n === pp + 1;
    const title = enabled
      ? (on ? `PP${n} is in — untick if it isn't` : `Tick when PP${n} is in`)
      : (on ? `Untick PP${pp} first` : `Tick PP${n - 1} first`);
    pps.appendChild(box(`PP${n}`, on, enabled, title, input => save(input, { ppSamples: input.checked ? n : n - 1 })));
  });
  const top = Boolean(saved?.topSample);
  wrap.append(pps, box("TOP", top, true, top ? "The TOP sample is in" : "Tick when the TOP sample is in", input => save(input, { topSample: input.checked })));
  return wrap;
}

/** After a colour's samples change: every view showing them. */
function refreshSampleViews() {
  refreshStylePaneSummary?.();
  if (typeof isPoDetailOpen === "function" && isPoDetailOpen()) renderPoDetailColors();
  if (typeof isPhotoshootView === "function" && isPhotoshootView()) refreshPhotoshootViews();
  if (getCurrentAppView() === "styles") applyStyleFilters?.();
}

function renderStylesTable() {
  const tbody = document.getElementById("stylesTableBody");
  if (!tbody) return;
  const cols = [...document.querySelectorAll("#stylesTable thead th[data-col]")].map(th => th.dataset.col);

  if (filteredStyles.length === 0) {
    const msg = styleShowDeleted
      ? (getDeletedStyles().length ? "No deleted styles match the search." : "No deleted styles.")
      : getAllStyles().length === 0
        ? "No styles yet — use Import N41 Data in the menu (⋮) to load the Style Master."
        : "No styles match the current filters.";
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(msg)}</td></tr>`;
    renderStylesPager();
    return;
  }

  const rows = filteredStyles.slice((stylePage - 1) * stylePageSize, stylePage * stylePageSize).map(style => {
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
      else if (col === "notes") td.appendChild(createStyleNotesInput(style, { onSaved: refreshStylePaneSummary }));
      else if (col === "status") td.appendChild(createStyleStatusPill(style.status));
      else if (col === "magento") td.appendChild(createStyleMgStatusCell(style));
      else if (col === "available") td.appendChild(createAvailableWithIhd(style));
      else if (col === "qtys") td.appendChild(createStyleQtyStrip(style));
      else {
        mountSearchHighlightedText(td, (STYLE_COLUMNS[col].display ?? STYLE_COLUMNS[col].value)(style));
        if (STYLE_COLUMNS[col].numeric) td.classList.add("cell-num");
      }
      if (col === "description" && style.description) td.title = style.description;
      tr.appendChild(td);
    });
    return tr;
  });

  tbody.replaceChildren(...rows);
  renderStylesPager();
  syncStyleSelectionUi();
  syncStylePaneRows();
}

function renderStylesPager() {
  renderTablePager("stylesPager", {
    total: filteredStyles.length,
    page: stylePage,
    pageSize: stylePageSize,
    noun: "Styles",
    onPage: n => {
      stylePage = n;
      renderStylesTable();
      document.getElementById("stylesTableWrap")?.scrollTo({ top: 0 });
    },
    onPageSize: n => {
      stylePageSize = n;
      saveTablePageSize("stylesTable", n);
      stylePage = 1;
      renderStylesTable();
    },
  });
}

// ── Notes ────────────────────────────────────────────────────────────────────
//
// Free text on a Style # + Color, edited in place: a one-line box in the
// table, a taller one in the style pane. Saves when you leave it (or Enter
// in the table); Esc undoes the edit.

function createStyleNotesInput(style, { multiline = false, onSaved } = {}) {
  const box = document.createElement(multiline ? "textarea" : "input");
  if (!multiline) box.type = "text";
  box.className = multiline ? "cell-notes-input cell-notes-input--pane" : "cell-notes-input";
  if (multiline) box.rows = 3;
  box.placeholder = multiline ? "Add a note" : "";
  box.autocomplete = "off";
  box.value = style.notes ?? "";
  box.title = style.notes ?? "";
  box.setAttribute("aria-label", `Notes for ${style.styleNo} ${style.color}`);

  const show = () => {
    box.value = style.notes ?? "";
    box.title = style.notes ?? "";
  };
  box.addEventListener("keydown", e => {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      box.blur(); // blur saves
    } else if (e.key === "Escape") {
      e.stopPropagation();
      show();
      box.blur();
    }
  });
  box.addEventListener("blur", async () => {
    const value = box.value.trim();
    if (value === (style.notes ?? "")) return show();
    box.classList.add("is-saving");
    try {
      await setStyleNotes(style.styleNo, style.color, value);
      show();
      box.classList.add("is-saved");
      setTimeout(() => box.classList.remove("is-saved"), 1200);
      onSaved?.();
    } catch (err) {
      show();
      showIndicator(err.message || "Couldn't save the note.", "error");
    } finally {
      box.classList.remove("is-saving");
    }
  });
  return box;
}

// ── IHD (in-house date) ──────────────────────────────────────────────────────
//
// Edited right in the table, as text: the first click selects the whole date
// (so it can be copied, or pasted over), and it shows as MM/DD/YY. Typed or
// pasted dates save on Enter or when you leave the cell; the calendar button
// picks one and saves straight away. Esc undoes the edit.

/** `onSaved` runs after a successful save — for views whose warnings depend on it. */
/** A PO-set IHD: the date, with every PO and its ETA in the tooltip. */
function createPoIhdText(style) {
  const span = document.createElement("span");
  span.className = "cell-date-po";
  const today = todayYmd();
  span.classList.toggle("is-past", Boolean(style.ihd) && style.ihd < today);
  span.textContent = formatIhd(style.ihd);
  const lines = getStylePoLines(style.styleNo, style.color);
  if (!lines.length) {
    const pos = [...new Set(getStylePoLines(style.styleNo).map(l => l.poNo))];
    span.title = `This colour isn't on ${style.styleNo}'s PO${pos.length > 1 ? "s" : ""} (${pos.join(", ")}) — no ETA, so no IHD`;
    return span;
  }
  span.title = "IHD from the PO ETAs — the next one from today" +
    (style.ihd && style.ihd < today ? " (all have passed: the latest)" : "") + "\n" +
    lines.map(l => `PO ${l.poNo} · ETA ${formatIhd(l.eta)}`).join("\n");
  return span;
}

function createIhdInput(style, { onSaved } = {}) {
  // On a PO: the IHD is the next ETA (js/store.js applyPoIhds) — shown, not typed.
  if (style.ihdFromPo) return createPoIhdText(style);
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
  return getShownStyleSource().filter(s => selectedStyleKeys.has(styleKey(s.styleNo, s.color)));
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
    // Deleted styles can only be restored.
    bar.querySelectorAll("#styleAddToShootBtn, #styleDeleteBtn").forEach(el => { el.hidden = styleShowDeleted; });
    document.getElementById("styleRestoreBtn").hidden = !styleShowDeleted;
  }
}

/**
 * Delete the ticked styles: hidden everywhere in the app and skipped by
 * later imports, but kept in the database, so they can be restored. Any
 * still waiting on Need to Shoot come off it.
 */
async function deleteSelectedStyles() {
  const styles = getSelectedStyles();
  if (!styles.length) return;
  const waiting = styles.filter(s => {
    const entry = getShootListEntry(s.styleNo, s.color);
    return entry && !entry.shotShootId;
  });
  const n = styles.length === 1 ? `${styles[0].styleNo} ${styles[0].color}` : `${styles.length.toLocaleString()} styles`;
  const extra = waiting.length ? `\n\n${waiting.length.toLocaleString()} of them ${waiting.length === 1 ? "comes" : "come"} off Need to Shoot.` : "";
  if (!confirm(`Delete ${n}?\n\nThey're hidden from the app and skipped when the Style Master is imported again. Restore them from the Deleted styles button.${extra}`)) return;
  try {
    await setStylesDeleted(styles, true);
    if (waiting.length) await removeFromShootList(waiting);
    clearStyleSelection();
    applyStyleFilters({ keepShown: true });
    refreshPhotoshootViews();
    showIndicator(`Deleted ${n}`, "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't delete.", "error");
  }
}

async function restoreSelectedStyles() {
  const styles = getSelectedStyles();
  if (!styles.length) return;
  const n = styles.length === 1 ? `${styles[0].styleNo} ${styles[0].color}` : `${styles.length.toLocaleString()} styles`;
  try {
    await setStylesDeleted(styles, false);
    selectedStyleKeys = new Set();
    // Nothing left to restore: back to the styles.
    if (!getDeletedStyles().length) styleShowDeleted = false;
    applyStyleFilters({ keepShown: true });
    refreshPhotoshootViews();
    showIndicator(`Restored ${n}`, "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't restore.", "error");
  }
}

function clearStyleSelection() {
  selectedStyleKeys = new Set();
  renderStylesTable();
}

/** The ticked styles onto Need to Shoot — each one's type comes from its PO. */
async function addSelectedToShootList() {
  const listName = "Need to Shoot";
  const styles = getSelectedStyles();
  if (!styles.length) return;
  try {
    const added = await addToShootList(styles);
    const skipped = styles.filter(s => isNoShootStyle(s.styleNo, s.color)).length;
    const already = styles.length - added - skipped;
    clearStyleSelection();
    refreshPhotoshootViews();
    const notes = [
      already ? `${already.toLocaleString()} already on it` : "",
      skipped ? `${skipped.toLocaleString()} COMPANY skipped — no shoot needed` : "",
    ].filter(Boolean).join(", ");
    showIndicator(added
      ? `${added.toLocaleString()} added to ${listName}${notes ? ` (${notes})` : ""}`
      : skipped === styles.length ? "COMPANY styles don't need a photoshoot" : `Nothing added${notes ? ` (${notes})` : ""}`,
    added ? "success" : "");
  } catch (err) {
    showIndicator(err.message || `Couldn't add to ${listName}.`, "error");
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
  // The headers, and the Qty column's sub-headers.
  document.querySelectorAll("#stylesTable thead th[data-col], #stylesTable thead .style-qty-head").forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (styleSortCol && th.dataset.col === styleSortCol) th.classList.add(styleSortDir === 1 ? "sorted-asc" : "sorted-desc");
  });
  applyStyleFilters();
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initStylesView() {
  stylePageSize = readTablePageSize("stylesTable");
  document.querySelectorAll("#stylesTable thead th[data-col]").forEach(th => {
    if (!STYLE_COLUMNS[th.dataset.col]) th.classList.add("th-no-sort");
    th.addEventListener("click", () => sortStylesBy(th.dataset.col));
  });
  // Each figure in the Qty column sorts from its own sub-header (the column itself doesn't).
  document.querySelectorAll("#stylesTable thead .style-qty-head").forEach(head => {
    head.addEventListener("click", e => {
      e.stopPropagation();
      sortStylesBy(head.dataset.col);
    });
  });
  STYLE_QTY_COLS.forEach(col => initColumnFilter("stylesTable", col, {
    el: document.querySelector(`#stylesTable thead .style-qty-head[data-col="${col}"]`),
    options: () => styleQtyFilterOptions(col),
    onChange: () => applyStyleFilters(),
    sortable: true,
  }));
  initColumnFilter("stylesTable", "category", {
    options: () => statusFilterOptions(getAllStyles().map(s => s.category)),
    onChange: () => applyStyleFilters(),
    sortable: true,
  });
  initColumnFilter("stylesTable", "season", {
    options: () => statusFilterOptions(getAllStyles().map(s => s.season)),
    onChange: () => applyStyleFilters(),
    sortable: true,
  });
  initColumnFilter("stylesTable", "available", {
    options: () => monthFilterOptions(getAllStyles().map(s => s.availableDate)).map(option => ({
      ...option,
      label: option.key === BLANK_FILTER_LABEL ? "No Available date" : formatMonYY(option.key),
    })),
    onChange: () => applyStyleFilters(),
    sortable: true,
  });
  initColumnFilter("stylesTable", "show", {
    options: () => statusFilterOptions(getAllStyles().map(s => s.show)),
    onChange: () => applyStyleFilters(),
    sortable: true,
  });
  initColumnFilter("stylesTable", "status", {
    options: () => statusFilterOptions(getAllStyles().map(s => s.status)),
    onChange: () => applyStyleFilters(),
    hideByDefault: isStyleStatusHiddenByDefault,
    sortable: true,
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
    if (e.target.closest('td[data-col="ihd"], td[data-col="notes"], .shoot-picker')) return;
    const tr = e.target.closest("tr[data-style-no]");
    if (tr) openStylePane(tr.dataset.styleNo, tr.dataset.color);
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
  document.getElementById("styleNoPhotosBtn")?.addEventListener("click", () => {
    styleNoPhotosOnly = !styleNoPhotosOnly;
    applyStyleFilters();
  });
  document.getElementById("styleDeletedBtn")?.addEventListener("click", () => setStyleShowDeleted(!styleShowDeleted));
  document.getElementById("styleDeleteBtn")?.addEventListener("click", deleteSelectedStyles);
  document.getElementById("styleRestoreBtn")?.addEventListener("click", restoreSelectedStyles);
  initStyleImport();
}
