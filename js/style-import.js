/**
 * Import N41's Style Master into the Styles database, and look back at
 * past imports (header menu → Update history).
 *
 * The file is read here in the browser — it's never uploaded; only the
 * cleaned-up fields are saved. The Style Master (.csv or .xlsx; row 1 is
 * headings, "style" in A) is style information only — the stock figures
 * (OH / WIP / OO / ATS / Inv Qty) come from the ATS report (js/ats-import.js)
 * and the POs from the PO detail (js/purchase-orders.js). Columns are found
 * by their headings, so N41 can add or move columns:
 *
 *   style  Style #           color     Color         status  N41 Status
 *   availableDate  Available (date → "YYYY-MM", shown as JUL26)
 *   season  Season           descript  Description   category  Category
 *   memo  Memo ("updated by Mass Update" dropped)    receivedQty  Received qty
 *   id  N41's record id — see below
 *
 *   A heading that isn't in the file leaves that field as the style has it
 *   (new ones get none) — an older export without category keeps categories.
 *
 * N41's record id stays the same when N41 changes a record's Style # or
 * colour, so a style is matched on it first, then on Style # + Color. One
 * whose id is in the database under another name was renamed in N41: it's
 * listed under Update as "Renamed", and confirming moves it — with its IHD,
 * notes, Need to Shoot entry, photoshoots, banners and Complete history — to
 * the new name (renameStyleRecord). Styles that only gain their id are saved
 * quietly; the first import with the id column links them all.
 *
 * A Style # + Color is one record. Before anything is saved, the dialog lists
 * every change under three tabs — Update, New Styles (a Style # seen for the
 * first time) and New Colors (another color of a Style # already there) —
 * and confirming saves only those. Styles missing from the file are left as they are. Each import that
 * saves anything is recorded in full, so it can be looked through later.
 */

/** "5/31/2025 00:00:00" (or a Date) → "2025-05"; "" when it isn't a date. */
function importMonth(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  }
  const text = cleanCell(value);
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(text);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{4})-(\d{2})/.exec(text);
  return m ? `${m[1]}-${m[2]}` : "";
}

/** N41 appends "updated by Mass Update" on every bulk edit — keep the rest. */
function cleanImportMemo(value) {
  return cleanCell(value).split(",").map(s => s.trim())
    .filter(s => s && !/^updated by mass update$/i.test(s)).join(", ");
}

/** "1000.00" → "1000"; "" when blank or not a number. */
function cleanImportQty(value) {
  const text = cleanCell(value).replace(/,/g, "");
  if (!text) return "";
  const n = Number(text);
  return Number.isFinite(n) ? String(n) : "";
}

/** N41's record id: digits, or "". */
function cleanImportId(value) {
  const text = cleanCell(value);
  return /^\d+$/.test(text) ? text : "";
}

/** The Style Master: headings in row 1, "style" in A. */
function isStyleCsvLayout(sheet) {
  return String(sheet?.A1?.v ?? "").trim().toLowerCase() === "style";
}

/** SheetJS, loaded only when an import is started — it's a large library. */
const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
let sheetJsLoading = null;

function loadSheetJs() {
  if (typeof XLSX !== "undefined") return Promise.resolve();
  if (!sheetJsLoading) {
    sheetJsLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SHEETJS_URL;
      script.onload = () => resolve();
      script.onerror = () => {
        sheetJsLoading = null;
        reject(new Error("Couldn't load the Excel reader — check your connection and try again."));
      };
      document.head.appendChild(script);
    });
  }
  return sheetJsLoading;
}

/** Trimmed, with runs of spaces collapsed — report exports pad generously. */
function cleanCell(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Pull clean style records out of the workbook. Returns the records (one per
 * Style # + Color — a later row wins if the file repeats one) and how many
 * rows were skipped.
 */
function extractStyles(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("That file has no sheets.");
  if (!isStyleCsvLayout(sheet)) {
    throw new Error("That isn't the Style Master — expected style, color, status… as the headings in row 1.");
  }
  return extractStylesFromCsv(sheet);
}

/** Style Master heading → the field it fills, and how its value is cleaned. */
const STYLE_MASTER_COLUMNS = [
  { field: "status", heading: "status", clean: cleanCell },
  { field: "availableDate", heading: "availabledate", clean: importMonth },
  { field: "season", heading: "season", clean: cleanCell },
  { field: "description", heading: "descript", clean: cleanCell },
  { field: "category", heading: "category", clean: cleanCell },
  { field: "memo", heading: "memo", clean: cleanImportMemo },
  { field: "receivedQty", heading: "receivedqty", clean: cleanImportQty },
  { field: "n41Id", heading: "id", clean: cleanImportId },
];

/**
 * The Style Master (see the top of this file). Only the fields whose heading
 * is in the file are set — the rest keep what the style has (see diffStyles).
 */
function extractStylesFromCsv(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: "A", defval: "", raw: true, blankrows: true });
  const head = rows.shift() ?? {};
  const colOf = heading => Object.keys(head).find(c => cleanCell(head[c]).toLowerCase() === heading);
  const styleCol = colOf("style") ?? "A";
  const colorCol = colOf("color") ?? "B";
  const columns = STYLE_MASTER_COLUMNS.map(c => ({ ...c, col: colOf(c.heading) })).filter(c => c.col);
  const byKey = new Map();
  let skipped = 0;
  rows.forEach(row => {
    const styleNo = cleanCell(row[styleCol]);
    if (!styleNo || styleNo.toLowerCase() === "style") {
      skipped += 1;
      return;
    }
    const color = cleanCell(row[colorCol]);
    const style = { styleNo, color };
    columns.forEach(c => { style[c.field] = c.clean(row[c.col]); });
    byKey.set(styleKey(styleNo, color), style);
  });
  return { styles: [...byKey.values()], skipped };
}

/** `format`: how a value reads in the change lists. */
const STYLE_FIELDS = [
  { key: "status", label: "Status" },
  { key: "season", label: "Season" },
  { key: "category", label: "Category" },
  { key: "description", label: "Description" },
  { key: "availableDate", label: "Available", format: v => formatMonYY(v) },
  { key: "receivedQty", label: "Rcvd Qty", format: v => (v === "" || v == null ? "" : Number(v).toLocaleString()) },
  { key: "memo", label: "Memo" },
];
const STYLE_FIELD_BY_KEY = new Map(STYLE_FIELDS.map(f => [f.key, f]));
// A record N41 renamed (same id): "P8501 BEIGE/OLIVE" → "P8501ST BEIGE/OLIVE".
STYLE_FIELD_BY_KEY.set("rename", { key: "rename", label: "Renamed" });
// Imports made while Inv Qty came from the Style Master still list it in
// Update history; it's the ATS report's now.
STYLE_FIELD_BY_KEY.set("invQty", { key: "invQty", label: "Inv Qty", format: v => (v === "" || v == null ? "" : Number(v).toLocaleString()) });

function formatStyleField(key, value) {
  const f = STYLE_FIELD_BY_KEY.get(key);
  return f?.format ? f.format(value) : String(value ?? "");
}

/**
 * Sort the file's records against the database: new, changed, unchanged.
 *
 * A new record is a New Style when its Style # isn't in the database in any
 * color yet, and a New Color when the Style # is already there in another
 * color — `kind` says which ("style" / "color"), and a new color carries the
 * colors it joins. Both are decided against the database as it was before
 * this import, so they read the same later in Update history.
 */
function diffStyles(incoming) {
  const existing = new Map(getAllStyles().map(s => [styleKey(s.styleNo, s.color), s]));
  const byId = new Map(getAllStyles().filter(s => s.n41Id).map(s => [s.n41Id, s]));
  const colorsByStyle = new Map();
  getAllStyles().forEach(s => {
    const key = s.styleNo;
    if (!colorsByStyle.has(key)) colorsByStyle.set(key, []);
    colorsByStyle.get(key).push(s.color);
  });
  // Deleted in the app: skipped, so they don't come back — by name or by N41 id.
  const deleted = new Set(getDeletedStyles().map(s => styleKey(s.styleNo, s.color)));
  const deletedIds = new Set(getDeletedStyles().map(s => s.n41Id).filter(Boolean));
  const added = [];
  const changed = [];
  /** [{ from: { styleNo, color }, to: { styleNo, color } }] — done before the save. */
  const renames = [];
  /** Records whose only change is gaining their N41 id: saved, not listed. */
  const linked = [];
  let unchanged = 0;
  let deletedSkipped = 0;
  incoming.forEach(style => {
    const key = styleKey(style.styleNo, style.color);
    if (deleted.has(key) || (style.n41Id && deletedIds.has(style.n41Id))) {
      deletedSkipped += 1;
      return;
    }
    // The same N41 record under another name: renamed in N41.
    const sameId = style.n41Id ? byId.get(style.n41Id) : null;
    const renamedFrom = sameId && styleKey(sameId.styleNo, sameId.color) !== key ? sameId : null;
    const current = renamedFrom ?? existing.get(key);
    // A field the file doesn't carry (an older export without category) keeps
    // what the style has — "" if new.
    const inFile = STYLE_FIELDS.filter(f => f.key in style);
    const filled = { ...style };
    STYLE_FIELDS.forEach(f => { if (!(f.key in filled)) filled[f.key] = current?.[f.key] ?? ""; });
    // Likewise the N41 id, for a file without the id column.
    if (!filled.n41Id) filled.n41Id = current?.n41Id ?? "";
    if (!current) {
      const existingColors = colorsByStyle.get(style.styleNo);
      added.push(existingColors
        ? { ...filled, kind: "color", existingColors: [...existingColors].sort() }
        : { ...filled, kind: "style" });
      return;
    }
    const diffs = inFile
      .filter(f => (current[f.key] ?? "") !== style[f.key])
      .map(f => ({ key: f.key, label: f.label, from: current[f.key] ?? "", to: style[f.key] }));
    if (renamedFrom) {
      renames.push({ from: { styleNo: renamedFrom.styleNo, color: renamedFrom.color }, to: { styleNo: style.styleNo, color: style.color } });
      diffs.unshift({ key: "rename", label: "Renamed", from: `${renamedFrom.styleNo} ${renamedFrom.color}`, to: `${style.styleNo} ${style.color}` });
    }
    if (diffs.length) changed.push({ style: filled, diffs });
    else {
      unchanged += 1;
      if ((current.n41Id ?? "") !== filled.n41Id) linked.push(filled);
    }
  });
  return { added, changed, unchanged, deletedSkipped, renames, linked };
}

// ── Changes view ─────────────────────────────────────────────────────────────
//
// The full list of what an import changes, shared by the import dialog and
// Update history. The count boxes across the top are the tabs:
//
//   updated     a style already in the database whose fields changed — each
//               change side by side, "Status  ACTIVE → SOLDOUT"
//   new styles  a Style # seen for the first time
//   new colors  a new color of a Style # that's already there
//   unchanged   a count only — there's nothing to list
//
// The search box goes in the window's header (`searchSlot`). One row per
// record — click one for the style's detail window. Long lists draw a page
// at a time.

const STYLE_CHANGES_PAGE = 300;

/** New records split by kind. Entries saved without one count as new styles. */
function splitAddedStyles(added) {
  return {
    styles: added.filter(s => s.kind !== "color"),
    colors: added.filter(s => s.kind === "color"),
  };
}

/**
 * `shootActions` adds a Shoot column — the Styles table's "+ Need to Shoot"
 * button and status — and, on the two New tabs, "Add all to Need to Shoot".
 * Update history turns it on; the import preview doesn't, since nothing in
 * it is saved yet.
 */
function createStyleChangesView({ added, changed }, { unchanged = 0, shootActions = false, searchSlot = null } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "style-changes";

  const { styles: newStyles, colors: newColors } = splitAddedStyles(added);
  const TABS = [
    { key: "changed", label: "updated", tone: "changed", rows: changed, empty: "No styles updated." },
    { key: "styles", label: "new styles", tone: "new", rows: newStyles, empty: "No new styles.", noun: "new styles", canAddAll: true },
    { key: "colors", label: "new colors", tone: "new", rows: newColors, empty: "No new colors.", noun: "new colors", canAddAll: true },
  ];

  let tab = (TABS.find(t => t.rows.length) ?? TABS[0]).key;
  let query = "";
  let shown = STYLE_CHANGES_PAGE;

  // The count boxes are the tabs; Unchanged sits at the end as a plain count.
  const tabs = document.createElement("div");
  tabs.className = "style-import-stats";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Changes");

  const search = document.createElement("input");
  search.type = "search";
  search.className = "form-input style-changes-search";
  search.placeholder = "Search style #, color, description";
  search.setAttribute("aria-label", "Search changes");
  if (searchSlot) searchSlot.replaceChildren(search);

  // New Styles / New Colors only: everything on the tab (as searched) in one go.
  const bar = document.createElement("div");
  bar.className = "style-changes-bar";
  const addAll = document.createElement("button");
  addAll.type = "button";
  addAll.className = "btn btn-primary style-changes-add-all";
  addAll.hidden = true;
  bar.append(...(searchSlot ? [] : [search]), addAll);

  const body = document.createElement("div");
  body.className = "style-changes-body";
  wrap.append(tabs, bar, body);

  // A row opens that style's detail window — photos, description, status —
  // the same one a click in the Styles table opens (js/style-images.js).
  const styleRow = style => {
    const tr = document.createElement("tr");
    tr.className = "style-change-row";
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", `View ${style.styleNo} ${style.color}`);
    tr.dataset.styleNo = style.styleNo;
    tr.dataset.color = style.color;
    return tr;
  };
  const openRow = tr => openStyleGallery(tr.dataset.styleNo, tr.dataset.color);
  body.addEventListener("click", e => {
    // The Shoot cell's button does its own thing — then the "Add all" count
    // catches up once it's saved.
    if (e.target.closest(".style-shoot-cell")) {
      if (e.target.closest(".shoot-pick")) setTimeout(() => lastSync && syncAddAll(...lastSync), 1200);
      return;
    }
    const tr = e.target.closest("tr.style-change-row");
    if (tr) openRow(tr);
  });
  body.addEventListener("keydown", e => {
    const tr = e.target.closest?.("tr.style-change-row");
    if (!tr || e.target !== tr || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    openRow(tr);
  });

  /** The Styles table's Shoot cell: status, and "+ Need to Shoot" (js/styles.js). */
  const shootCell = style => {
    const td = document.createElement("td");
    td.className = "style-import-shoot";
    td.appendChild(createStyleShootCell(style));
    return td;
  };
  const shootHead = shootActions ? ["Shoot"] : [];

  /** "Add all to Need to Shoot" for what the tab is showing (after search). */
  let lastSync = null;
  const syncAddAll = (current, rows) => {
    lastSync = [current, rows];
    addAll.hidden = !shootActions || !current.canAddAll || rows.length === 0;
    // With the search up in the header, the row is only there for this button.
    bar.hidden = addAll.hidden && Boolean(searchSlot);
    if (addAll.hidden) return;
    const waiting = rows.filter(s => !needsShoot(s.styleNo, s.color) && !isNoShootStyle(s.styleNo, s.color)).length;
    addAll.disabled = waiting === 0;
    addAll.textContent = waiting === 0
      ? "All on Need to Shoot"
      : `Add all ${waiting.toLocaleString()} to Need to Shoot`;
    addAll.onclick = async () => {
      const toAdd = rows.filter(s => !needsShoot(s.styleNo, s.color) && !isNoShootStyle(s.styleNo, s.color));
      if (!toAdd.length) return;
      if (!confirm(`Add ${toAdd.length.toLocaleString()} ${current.noun}${query ? " (matching the search)" : ""} to Need to Shoot?`)) return;
      addAll.disabled = true;
      try {
        const n = await addToShootList(toAdd.map(({ styleNo, color }) => ({ styleNo, color })), current.key === "colors" ? "newColor" : "newStyle");
        refreshPhotoshootViews();
        showIndicator(`${n.toLocaleString()} added to Need to Shoot`, "success");
      } catch (err) {
        showIndicator(err.message || "Couldn't add to Need to Shoot.", "error");
      }
      render();
    };
  };

  const matches = style => !query ||
    [style.styleNo, style.color, style.status, style.season, style.category, style.description, style.memo]
      .some(v => String(v ?? "").toLowerCase().includes(query));

  const statContent = (el, n, label) => {
    const num = document.createElement("strong");
    num.textContent = n.toLocaleString();
    const text = document.createElement("span");
    text.textContent = label;
    el.append(num, text);
  };

  const renderTabs = () => {
    const unchangedBox = document.createElement("div");
    unchangedBox.className = "style-import-stat";
    statContent(unchangedBox, unchanged, "unchanged");

    tabs.replaceChildren(...TABS.map(t => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "style-import-stat is-tab" + (t.key === tab ? " is-active" : "");
      btn.dataset.tone = t.tone;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", t.key === tab ? "true" : "false");
      statContent(btn, t.rows.length, t.label);
      btn.addEventListener("click", () => {
        if (tab === t.key) return;
        tab = t.key;
        shown = STYLE_CHANGES_PAGE;
        render();
      });
      return btn;
    }), unchangedBox);
  };

  const cell = (text, cls = "") => {
    const td = document.createElement("td");
    if (cls) td.className = cls;
    td.textContent = text || "—";
    return td;
  };

  /** Every change on an updated row, side by side: "Status  ACTIVE → SOLDOUT". */
  const changesCell = diffs => {
    const td = document.createElement("td");
    const list = document.createElement("div");
    list.className = "style-change-list";
    diffs.forEach(d => {
      const item = document.createElement("span");
      item.className = "style-change";
      const label = document.createElement("span");
      label.className = "style-change-label";
      label.textContent = d.label;
      const from = document.createElement("span");
      from.className = "style-change-from";
      from.textContent = formatStyleField(d.key, d.from) || "—";
      const arrow = document.createElement("span");
      arrow.className = "style-change-arrow";
      arrow.textContent = "→";
      arrow.setAttribute("aria-label", "to");
      const to = document.createElement("span");
      to.className = "style-change-to";
      to.textContent = formatStyleField(d.key, d.to) || "—";
      item.append(label, from, arrow, to);
      list.appendChild(item);
    });
    td.appendChild(list);
    return td;
  };

  const headRow = labels => {
    const tr = document.createElement("tr");
    labels.forEach(h => {
      const th = document.createElement("th");
      th.textContent = h;
      tr.appendChild(th);
    });
    return tr;
  };

  const render = () => {
    renderTabs();
    const current = TABS.find(t => t.key === tab);
    const rows = current.rows.filter(r => matches(r.style ?? r));
    syncAddAll(current, rows);

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dash-empty";
      empty.textContent = query ? "No matches." : current.empty;
      body.replaceChildren(empty);
      return;
    }

    const table = document.createElement("table");
    table.className = "style-import-table";
    const page = rows.slice(0, shown);

    if (tab === "changed") {
      table.appendChild(headRow(["Style #", "Color", "Description", "What changed", ...shootHead]));
      page.forEach(({ style, diffs }) => {
        const tr = styleRow(style);
        tr.append(cell(style.styleNo, "is-key style-change-link"), cell(style.color, "is-key"),
          cell(style.description, "style-import-desc"), changesCell(diffs));
        if (shootActions) tr.appendChild(shootCell(style));
        table.appendChild(tr);
      });
    } else {
      const colors = tab === "colors";
      table.appendChild(headRow([
        "Style #", "Color", ...(colors ? ["Already in"] : []), ...STYLE_FIELDS.map(f => f.label), ...shootHead,
      ]));
      page.forEach(style => {
        const tr = styleRow(style);
        tr.append(cell(style.styleNo, "is-key style-change-link"), cell(style.color, "is-key"));
        // A new color: the colors this Style # already has.
        if (colors) tr.appendChild(cell((style.existingColors ?? []).join(", "), "style-import-muted"));
        tr.append(...STYLE_FIELDS.map(f => cell(formatStyleField(f.key, style[f.key]), f.key === "description" ? "style-import-desc" : "")));
        if (shootActions) tr.appendChild(shootCell(style));
        table.appendChild(tr);
      });
    }

    const footer = document.createElement("div");
    footer.className = "style-import-more";
    const left = rows.length - shown;
    if (left > 0) {
      footer.append(`Showing ${shown.toLocaleString()} of ${rows.length.toLocaleString()}. `);
      const more = document.createElement("button");
      more.type = "button";
      more.className = "btn btn-sm";
      more.textContent = `Show ${Math.min(left, STYLE_CHANGES_PAGE).toLocaleString()} more`;
      more.addEventListener("click", () => {
        shown += STYLE_CHANGES_PAGE;
        render();
      });
      const all = document.createElement("button");
      all.type = "button";
      all.className = "btn btn-sm";
      all.textContent = "Show all";
      all.addEventListener("click", () => {
        shown = rows.length;
        render();
      });
      footer.append(more, " ", all);
    } else {
      footer.textContent = `${rows.length.toLocaleString()} ${rows.length === 1 ? "row" : "rows"}`;
    }
    body.replaceChildren(table, footer);
  };

  let searchTimer = 0;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = search.value.trim().toLowerCase();
      shown = STYLE_CHANGES_PAGE;
      render();
    }, 150);
  });

  render();
  return wrap;
}

// ── Import dialog ────────────────────────────────────────────────────────────

/** What the preview is showing and would save on confirm. */
let styleImportPlan = null;

function setStyleImportMessage(text, type = "") {
  const el = document.getElementById("styleImportMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (type ? ` ${type}` : "");
}

function openStyleImport() {
  styleImportPlan = null;
  const input = document.getElementById("styleImportFile");
  if (input) input.value = "";
  setStyleImportHead("", null);
  document.getElementById("styleImportPreview").replaceChildren();
  document.getElementById("styleImportPick").hidden = false;
  document.getElementById("styleImportConfirmBtn").disabled = true;
  document.getElementById("styleImportConfirmBtn").textContent = "Import";
  setStyleImportMessage("");
  document.getElementById("styleImportOverlay")?.classList.add("open");
}

function closeStyleImport() {
  document.getElementById("styleImportOverlay")?.classList.remove("open");
  styleImportPlan = null;
}

async function readStyleFile(file) {
  if (!file) return;
  setStyleImportMessage(`Reading ${file.name}…`);
  document.getElementById("styleImportConfirmBtn").disabled = true;
  try {
    await loadSheetJs();
    // A CSV is read as plain text, so dates and numbers come through as written.
    const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: isCsv });
    const { styles, skipped } = extractStyles(workbook);
    if (styles.length === 0) {
      throw new Error("No styles found in the Style Master — expected style, color, status… in row 1 and styles below.");
    }
    const diff = diffStyles(styles);
    styleImportPlan = { fileName: file.name, total: styles.length, skipped, ...diff };
    renderStyleImportPreview();
    const toList = diff.added.length + diff.changed.length;
    const toSave = toList + diff.linked.length;
    document.getElementById("styleImportConfirmBtn").disabled = toSave === 0;
    document.getElementById("styleImportConfirmBtn").textContent = toList
      ? `Import ${toList.toLocaleString()} ${toList === 1 ? "style" : "styles"}`
      : toSave ? "Save N41 ids" : "Nothing to import";
    setStyleImportMessage(toSave ? "" : "Everything in this file is already up to date.");
  } catch (err) {
    styleImportPlan = null;
    setStyleImportMessage(err.message || "Couldn't read that file.", "error");
  }
}

/**
 * The header's line under the title (the file and its count) and its search
 * box. "" / null clears them — before a file is picked, and on the list of
 * past imports.
 */
function setStyleImportHead(fileText, searchFor, ids = { file: "styleImportHeadFile", search: "styleImportHeadSearch" }) {
  const file = document.getElementById(ids.file);
  if (file) file.textContent = fileText;
  const slot = document.getElementById(ids.search);
  if (slot && !searchFor) slot.replaceChildren();
  return slot;
}

function renderStyleImportPreview() {
  const plan = styleImportPlan;
  const preview = document.getElementById("styleImportPreview");
  if (!plan || !preview) return;

  // The drop zone has done its job; the changes need the room.
  document.getElementById("styleImportPick").hidden = true;

  const searchSlot = setStyleImportHead(
    `${plan.fileName} · ${plan.total.toLocaleString()} styles in the file · ${plan.skipped.toLocaleString()} blank / size rows skipped`
      + (plan.deletedSkipped ? ` · ${plan.deletedSkipped.toLocaleString()} deleted ${plan.deletedSkipped === 1 ? "style" : "styles"} skipped` : "")
      + (plan.renames.length ? ` · ${plan.renames.length.toLocaleString()} renamed in N41` : "")
      + (plan.linked.length ? ` · ${plan.linked.length.toLocaleString()} get their N41 id` : ""),
    plan,
  );
  preview.replaceChildren(createStyleChangesView(plan, { unchanged: plan.unchanged, searchSlot }));
}

async function confirmStyleImport() {
  const plan = styleImportPlan;
  if (!plan) return;
  // Just the record — kind / existingColors are for the preview and history.
  const toSave = [...plan.changed.map(c => c.style), ...plan.added.map(({ kind, existingColors, ...style }) => style), ...plan.linked];
  const btn = document.getElementById("styleImportConfirmBtn");
  btn.disabled = true;
  try {
    // Renames first, so the save below finds each record under its new name.
    for (const [i, r] of plan.renames.entries()) {
      setStyleImportMessage(`Renaming ${i + 1} of ${plan.renames.length}: ${r.from.styleNo} ${r.from.color} → ${r.to.styleNo} ${r.to.color}…`);
      await renameStyleRecord(r.from, r.to);
    }
    // A rename moves Need to Shoot, shoots and more on the server: reload it all.
    if (plan.renames.length) await loadAppData();
    await saveStyles(toSave, (saved, total) => {
      setStyleImportMessage(`Saving ${saved.toLocaleString()} of ${total.toLocaleString()}…`);
    });
  } catch (err) {
    setStyleImportMessage(`${err.message || "Couldn't save."} Styles saved before this point are kept — import the file again to finish.`, "error");
    btn.disabled = false;
    if (typeof applyStyleFilters === "function") applyStyleFilters();
    return;
  }

  // The styles are in; the history entry is a record of it, so a failure
  // here is worth a warning but doesn't undo anything.
  let recorded = true;
  try {
    await saveStyleImportRecord(plan);
  } catch (err) {
    recorded = false;
    console.warn("Style import history not saved:", err);
  }

  closeStyleImport();
  if (typeof applyStyleFilters === "function") applyStyleFilters();
  if (plan.renames.length) {
    refreshPhotoshootViews();
    if (typeof refreshBannerViews === "function") refreshBannerViews();
  }
  const { styles: newStyles, colors: newColors } = splitAddedStyles(plan.added);
  const summary = `Imported: ${plan.changed.length.toLocaleString()} updated` +
    (plan.renames.length ? ` (${plan.renames.length.toLocaleString()} renamed)` : "") +
    `, ${newStyles.length.toLocaleString()} new styles, ${newColors.length.toLocaleString()} new colors` +
    (plan.linked.length ? `, ${plan.linked.length.toLocaleString()} linked to their N41 id` : "");
  if (recorded) {
    showIndicator(summary, "success");
  } else {
    showIndicator(`${summary} — but it couldn't be added to Update history. Add the style_imports table in Supabase (it's in supabase-schema.sql).`, "error");
  }
}

// ── Update history ───────────────────────────────────────────────────────────
//
// Every import that saved anything, newest first. Picking one loads its full
// list of changes into the same Update / New view the import dialog uses.

/** Bumped on every open / pick, so a slow load can't land on the wrong screen. */
let styleHistoryRequest = 0;

function setStyleHistoryBody(...nodes) {
  document.getElementById("styleHistoryBody")?.replaceChildren(...nodes);
}

function styleHistoryNotice(text, tone = "") {
  const el = document.createElement("div");
  el.className = "dash-empty" + (tone ? ` is-${tone}` : "");
  el.textContent = text;
  return el;
}

function describeStyleHistoryError(err) {
  return /style_imports/.test(err?.message ?? "")
    ? "Update history needs the style_imports table — add it in Supabase (SQL Editor; it's in supabase-schema.sql). Imports from then on are recorded."
    : err?.message || "Couldn't load the history.";
}

/** Update history's header line and search slot (see setStyleImportHead). */
const STYLE_HISTORY_HEAD = { file: "styleHistoryHeadFile", search: "styleHistoryHeadSearch" };

async function openStyleHistory() {
  const overlay = document.getElementById("styleHistoryOverlay");
  if (!overlay) return;
  overlay.classList.add("open");
  await renderStyleHistoryList();
}

function closeStyleHistory() {
  styleHistoryRequest += 1;
  document.getElementById("styleHistoryOverlay")?.classList.remove("open");
  setStyleHistoryBody();
}

function formatStyleHistoryTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

async function renderStyleHistoryList() {
  const request = ++styleHistoryRequest;
  document.getElementById("styleHistoryTitle").textContent = "Update history";
  document.getElementById("styleHistoryBackBtn").hidden = true;
  setStyleImportHead("", null, STYLE_HISTORY_HEAD);
  setStyleHistoryBody(styleHistoryNotice("Loading…"));

  let entries;
  try {
    entries = await loadStyleImportHistory();
  } catch (err) {
    if (request === styleHistoryRequest) setStyleHistoryBody(styleHistoryNotice(describeStyleHistoryError(err), "error"));
    return;
  }
  if (request !== styleHistoryRequest) return;

  if (entries.length === 0) {
    setStyleHistoryBody(styleHistoryNotice("No imports recorded yet. Each Excel import that saves anything shows up here."));
    return;
  }

  const table = document.createElement("table");
  table.className = "style-import-table style-history-table";
  const head = document.createElement("tr");
  ["Imported", "File", "Updated", "New", "Unchanged"].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    head.appendChild(th);
  });
  table.appendChild(head);

  entries.forEach(entry => {
    const tr = document.createElement("tr");
    tr.className = "style-history-row";
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", `View the import of ${formatStyleHistoryTime(entry.importedAt)}`);
    const td = (text, cls = "") => {
      const c = document.createElement("td");
      if (cls) c.className = cls;
      c.textContent = text;
      return c;
    };
    tr.append(
      td(formatStyleHistoryTime(entry.importedAt)),
      td(entry.fileName || "—", "style-history-file"),
      td(entry.changedCount.toLocaleString(), "is-num"),
      td(entry.addedCount.toLocaleString(), "is-num"),
      td(entry.unchanged.toLocaleString(), "is-num"),
    );
    const open = () => renderStyleHistoryEntry(entry);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    table.appendChild(tr);
  });
  setStyleHistoryBody(table);
}

async function renderStyleHistoryEntry(entry) {
  const request = ++styleHistoryRequest;
  document.getElementById("styleHistoryTitle").textContent = formatStyleHistoryTime(entry.importedAt);
  document.getElementById("styleHistoryBackBtn").hidden = false;
  setStyleHistoryBody(styleHistoryNotice("Loading changes…"));

  let changes;
  try {
    changes = await loadStyleImportChanges(entry.id);
  } catch (err) {
    if (request === styleHistoryRequest) setStyleHistoryBody(styleHistoryNotice(describeStyleHistoryError(err), "error"));
    return;
  }
  if (request !== styleHistoryRequest) return;

  // Older entries carry only keys and values; the labels come from here.
  const labels = new Map([...STYLE_FIELD_BY_KEY.values()].map(f => [f.key, f.label]));
  changes.changed.forEach(c => c.diffs.forEach(d => { d.label = labels.get(d.key) ?? d.key; }));

  const searchSlot = setStyleImportHead(
    `${entry.fileName || "Excel import"} · ${entry.total.toLocaleString()} styles in the file`,
    entry,
    STYLE_HISTORY_HEAD,
  );
  setStyleHistoryBody(createStyleChangesView(changes, { unchanged: entry.unchanged, shootActions: true, searchSlot }));
}

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * A style's detail window can open over either window here. Escape then
 * closes just that one — this module's handlers run first, so they wait.
 */
function isStyleGalleryOpen() {
  return document.getElementById("styleGalleryOverlay")?.classList.contains("open") ?? false;
}

function initStyleImport() {
  document.getElementById("headerMenuImportStyles")?.addEventListener("click", () => {
    closeHeaderMenu();
    openStyleImport();
  });
  document.getElementById("styleImportCloseBtn")?.addEventListener("click", closeStyleImport);
  document.getElementById("styleImportCancelBtn")?.addEventListener("click", closeStyleImport);
  document.getElementById("styleImportConfirmBtn")?.addEventListener("click", confirmStyleImport);
  const input = document.getElementById("styleImportFile");
  input?.addEventListener("change", () => readStyleFile(input.files?.[0]));

  // Drop the file onto the dialog.
  const drop = document.getElementById("styleImportPick");
  drop?.addEventListener("dragover", e => {
    e.preventDefault();
    drop.classList.add("is-dragover");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
  drop?.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("is-dragover");
    readStyleFile(e.dataTransfer?.files?.[0]);
  });

  const overlay = document.getElementById("styleImportOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closeStyleImport();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay?.classList.contains("open") && !isStyleGalleryOpen()) closeStyleImport();
  });

  // Update history.
  document.getElementById("headerMenuStyleHistory")?.addEventListener("click", () => {
    closeHeaderMenu();
    openStyleHistory();
  });
  document.getElementById("styleHistoryCloseBtn")?.addEventListener("click", closeStyleHistory);
  document.getElementById("styleHistoryDoneBtn")?.addEventListener("click", closeStyleHistory);
  document.getElementById("styleHistoryBackBtn")?.addEventListener("click", renderStyleHistoryList);
  const history = document.getElementById("styleHistoryOverlay");
  history?.addEventListener("click", e => {
    if (e.target === history) closeStyleHistory();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && history?.classList.contains("open") && !isStyleGalleryOpen()) closeStyleHistory();
  });
}
