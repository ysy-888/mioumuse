/**
 * Styles → Import Production Sheet: which Style # + Color has its TOP.
 *
 * The production sheet (.xlsx) has a tab per month. Each PO is a block of
 * rows: Style # and PO # in merged cells down the block, one colour per row
 * ("COCOA BEAN\n#CA049" — the code after the line break is dropped), and the
 * TOP 1 comment-in date beside each colour. A date there means that colour
 * has its TOP; a blank means nothing (it never takes a TOP away).
 *
 * Columns are found by their headings (STYLE #, PO#, COLOR, TOP 1 … IN DATE),
 * on every tab and wherever the heading row is, so moved columns still read;
 * H, I, J and Z are the fallback. Merged cells are filled in from their top
 * cell first, and blank rows are skipped.
 *
 * A row matches a style by Style # (with or without a trailing ST, like the
 * POs page) and colour, compared on letters and digits only (DK.OLIVE =
 * DK OLIVE). When the colour doesn't match, the PO # is looked up in the N41
 * POs: a PO line for that style with the same colour settles it. Nothing is
 * saved until Save is pressed; the TOP date and PO go in top_date / top_po
 * (js/store.js saveStyleTops), keeping the latest date when there are several.
 */

let productionPlan = null;

const prodKey = s => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The value of every merged cell copied into the whole range (SheetJS keeps it in the top-left only). */
function fillMergedCells(sheet) {
  (sheet["!merges"] ?? []).forEach(m => {
    const top = sheet[XLSX.utils.encode_cell(m.s)];
    if (!top) return;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!sheet[addr]) sheet[addr] = { ...top };
      }
    }
  });
}

/** The heading row's columns, or null when this row isn't one. */
function findProductionColumns(row) {
  const heads = Object.entries(row).map(([col, v]) => [col, String(v ?? "").toUpperCase().replace(/\s+/g, "")]);
  const find = re => heads.find(([, h]) => re.test(h))?.[0];
  const style = find(/^STYLE(#|NO\.?|NUMBER)?$/);
  const po = find(/^P\.?O\.?(#|NO\.?|NUMBER)?$/);
  const color = find(/^COLOU?RS?$/);
  if (!style || !po || !color) return null;
  const top = find(/^TOP1.*IN/) ?? find(/^TOP1/) ?? find(/^TOP/);
  return { style, po, color, top: top ?? "Z" };
}

/** A date in the TOP column → "YYYY-MM-DD"; "" when blank or not a date. */
function productionDate(value) {
  if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0, 10);
  return poExcelDate(value); // js/purchase-orders.js: day numbers and m/d/yyyy
}

/**
 * Every colour row: { sheet, rowNo, styleNo, poNo, color, topDate, topText }.
 * topText is what was in the TOP cell when it isn't a date (shown, not saved).
 */
function parseProductionSheet(workbook) {
  const out = [];
  workbook.SheetNames.forEach(name => {
    const sheet = workbook.Sheets[name];
    fillMergedCells(sheet);
    const rows = XLSX.utils.sheet_to_json(sheet, { header: "A", raw: true, defval: "", blankrows: true });
    let cols = null;
    rows.forEach((r, i) => {
      const heading = findProductionColumns(r);
      if (heading) { cols = heading; return; }
      const c = cols ?? { style: "H", po: "I", color: "J", top: "Z" };
      const styleNo = String(r[c.style] ?? "").toUpperCase().replace(/\s+/g, "");
      const rawPo = r[c.po];
      const poNo = typeof rawPo === "number" ? String(Math.round(rawPo)) : String(rawPo ?? "").trim();
      const color = String(r[c.color] ?? "").split(/\r?\n/)[0].replace(/#\S*/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
      if (!styleNo || !color || !/\d/.test(styleNo)) return; // blank rows, totals, notes
      const rawTop = r[c.top];
      const topDate = productionDate(rawTop);
      const topText = topDate ? "" : String(rawTop ?? "").trim();
      out.push({ sheet: name, rowNo: i + 1, styleNo, poNo, color, topDate, topText });
    });
  });
  return out;
}

/** How alike two strings are, 0–1 (edit distance over the longer length). */
function prodSimilarity(a, b) {
  if (!a || !b) return 0;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - d[b.length] / Math.max(a.length, b.length);
}

/**
 * The style record a sheet row is about, and how it was matched — or why not.
 * A reorder's Style # carries a suffix (J7534-RE3, J7071ST-RE4): without it
 * is the style.
 */
function matchProductionRow(row) {
  const styleNo = getPoStyleColors(row.styleNo).length ? row.styleNo : row.styleNo.replace(/-.*$/, "");
  const colours = getPoStyleColors(styleNo); // js/purchase-orders.js: also without a trailing ST
  if (!colours.length) return { why: "Style # isn't in the Styles database" };
  const want = prodKey(row.color);
  const exact = colours.find(s => prodKey(s.color) === want);
  if (exact) return { style: exact, how: "colour" };
  // The N41 POs: this PO's lines for the style — the same colour, or one
  // spelled almost the same (CREAM/BACL → CREAM/BLACK).
  const base = styleNo.replace(/ST$/, "");
  const lines = getAllPoLines().filter(l => l.poNo === row.poNo && l.styleNo.replace(/ST$/, "") === base);
  const best = lines
    .map(l => ({ l, score: prodSimilarity(prodKey(l.color), want) }))
    .sort((a, b) => b.score - a.score)[0];
  const viaPo = best && best.score >= 0.75 ? best.l : null;
  const style = viaPo && colours.find(s => prodKey(s.color) === prodKey(viaPo.color));
  if (style) return { style, how: best.score === 1 ? "PO" : "PO (close spelling)" };
  return {
    why: lines.length
      ? `Colour isn't on the style; PO ${row.poNo} has ${[...new Set(lines.map(l => l.color))].join(", ")}`
      : "Colour isn't one of the style's colours",
  };
}

/** What saving would do: the colours that get TOP, and the dated rows that matched nothing. */
function planProductionImport(rows) {
  const dated = rows.filter(r => r.topDate);
  const byStyle = new Map();
  const unmatched = [];
  dated.forEach(row => {
    const m = matchProductionRow(row);
    if (!m.style) { unmatched.push({ ...row, why: m.why }); return; }
    const key = styleKey(m.style.styleNo, m.style.color);
    const prev = byStyle.get(key);
    if (!prev || row.topDate > prev.topDate) byStyle.set(key, { style: m.style, topDate: row.topDate, topPo: row.poNo, sheet: row.sheet, how: m.how });
  });
  const changes = [], unchanged = [];
  byStyle.forEach(t => {
    const had = t.style.topDate;
    if (had && had >= t.topDate) unchanged.push(t);
    else changes.push({ ...t, had });
  });
  const sort = (a, b) => a.style.styleNo.localeCompare(b.style.styleNo) || a.style.color.localeCompare(b.style.color);
  return {
    rows: rows.length, dated: dated.length,
    notDates: rows.filter(r => !r.topDate && r.topText),
    changes: changes.sort(sort), unchanged: unchanged.sort(sort), unmatched,
  };
}

// ── The dialog ───────────────────────────────────────────────────────────────

function setProductionMessage(text, tone = "") {
  const el = document.getElementById("productionImportMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (tone ? ` ${tone}` : "");
}

function openProductionImport() {
  productionPlan = null;
  const input = document.getElementById("productionImportFile");
  if (input) input.value = "";
  document.getElementById("productionImportPick").hidden = false;
  document.getElementById("productionImportPreview").replaceChildren();
  document.getElementById("productionImportFileName").textContent = "";
  const btn = document.getElementById("productionImportConfirmBtn");
  btn.disabled = true;
  btn.textContent = "Save";
  setProductionMessage("");
  document.getElementById("productionImportOverlay")?.classList.add("open");
}

function closeProductionImport() {
  document.getElementById("productionImportOverlay")?.classList.remove("open");
  productionPlan = null;
}

async function readProductionFile(file) {
  if (!file) return;
  setProductionMessage(`Reading ${file.name}…`);
  try {
    await loadSheetJs(); // js/style-import.js
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = parseProductionSheet(workbook);
    if (!rows.length) throw new Error("No Style # / PO# / COLOR columns with rows were found.");
    productionPlan = planProductionImport(rows);
    document.getElementById("productionImportFileName").textContent = file.name;
    document.getElementById("productionImportPick").hidden = true;
    renderProductionPreview();
  } catch (err) {
    productionPlan = null;
    setProductionMessage(err.message || "Couldn't read the file.", "error");
  }
}

function productionTable(headings, rows) {
  const table = document.createElement("table");
  table.className = "production-import-table";
  table.innerHTML = `<thead><tr>${headings.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`;
  const body = document.createElement("tbody");
  rows.forEach(cells => {
    const tr = document.createElement("tr");
    cells.forEach(c => {
      const td = document.createElement("td");
      if (c instanceof Node) td.appendChild(c); else td.textContent = c ?? "";
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  table.appendChild(body);
  return table;
}

function productionSection(title, hint, table) {
  const sec = document.createElement("section");
  sec.className = "production-import-section";
  const h = document.createElement("h4");
  h.textContent = title;
  sec.appendChild(h);
  if (hint) {
    const p = document.createElement("p");
    p.className = "form-hint";
    p.textContent = hint;
    sec.appendChild(p);
  }
  if (table) sec.appendChild(table);
  return sec;
}

function renderProductionPreview() {
  const p = productionPlan;
  const wrap = document.getElementById("productionImportPreview");
  const parts = [];
  const summary = document.createElement("p");
  summary.className = "production-import-summary";
  summary.textContent = `${p.rows.toLocaleString()} colour rows read, ${p.dated.toLocaleString()} with a TOP date. `
    + `${p.changes.length} colour${p.changes.length === 1 ? "" : "s"} to mark TOP, ${p.unchanged.length} already marked`
    + (p.unmatched.length ? `, ${p.unmatched.length} dated row${p.unmatched.length === 1 ? "" : "s"} not matched.` : ".");
  parts.push(summary);
  const date = d => (d ? formatMdy(d) : "");
  if (p.changes.length) {
    parts.push(productionSection("Will be marked TOP", "", productionTable(
      ["Style #", "Color", "TOP date", "PO #", "Tab", "Matched by"],
      p.changes.map(t => [t.style.styleNo, t.style.color, date(t.topDate) + (t.had ? ` (was ${date(t.had)})` : ""), t.topPo, t.sheet, t.how === "colour" ? "Style # + colour" : t.how === "PO" ? "PO # (N41 POs)" : "PO # — colour spelled differently"]),
    )));
  }
  if (p.unmatched.length) {
    parts.push(productionSection("Not matched — not saved", "These rows have a TOP date but no Style # + Color in the Styles database to put it on.", productionTable(
      ["Tab", "Row", "Style #", "PO #", "Color", "TOP date", "Why"],
      p.unmatched.map(r => [r.sheet, r.rowNo, r.styleNo, r.poNo, r.color, date(r.topDate), r.why]),
    )));
  }
  if (p.notDates.length) {
    parts.push(productionSection("Not a date — skipped", "Something other than a date is in the TOP column for these.", productionTable(
      ["Tab", "Row", "Style #", "Color", "TOP cell"],
      p.notDates.map(r => [r.sheet, r.rowNo, r.styleNo, r.color, r.topText]),
    )));
  }
  if (p.unchanged.length) {
    const det = document.createElement("details");
    det.className = "production-import-section";
    det.innerHTML = `<summary>Already marked TOP (${p.unchanged.length})</summary>`;
    det.appendChild(productionTable(["Style #", "Color", "TOP date", "PO #"],
      p.unchanged.map(t => [t.style.styleNo, t.style.color, date(t.style.topDate), t.style.topPo])));
    parts.push(det);
  }
  wrap.replaceChildren(...parts);
  const btn = document.getElementById("productionImportConfirmBtn");
  btn.disabled = !p.changes.length;
  btn.textContent = p.changes.length ? `Save TOP for ${p.changes.length} colour${p.changes.length === 1 ? "" : "s"}` : "Nothing to save";
  setProductionMessage("Nothing is saved until you press Save.");
}

async function confirmProductionImport() {
  if (!productionPlan?.changes.length) return;
  const btn = document.getElementById("productionImportConfirmBtn");
  btn.disabled = true;
  try {
    const tops = productionPlan.changes.map(t => ({ styleNo: t.style.styleNo, color: t.style.color, topDate: t.topDate, topPo: t.topPo }));
    await saveStyleTops(tops, (n, total) => setProductionMessage(`Saving… ${n} of ${total}`));
    showIndicator(`TOP saved for ${tops.length} colour${tops.length === 1 ? "" : "s"}`, "success");
    closeProductionImport();
    refreshPoDependentViews(); // js/purchase-orders.js: Styles, POs, shoots and the pane
    if (getCurrentAppView() === "needToShoot" && typeof renderNeedTable === "function") renderNeedTable();
  } catch (err) {
    btn.disabled = false;
    setProductionMessage(err.message || "Couldn't save.", "error");
  }
}

function initProductionImport() {
  document.getElementById("headerMenuImportProduction")?.addEventListener("click", () => {
    closeHeaderMenu();
    openProductionImport();
  });
  document.getElementById("productionImportCloseBtn")?.addEventListener("click", closeProductionImport);
  document.getElementById("productionImportCancelBtn")?.addEventListener("click", closeProductionImport);
  document.getElementById("productionImportConfirmBtn")?.addEventListener("click", confirmProductionImport);
  const input = document.getElementById("productionImportFile");
  input?.addEventListener("change", () => readProductionFile(input.files?.[0]));
  const drop = document.getElementById("productionImportPick");
  drop?.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("is-dragover"); });
  drop?.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
  drop?.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("is-dragover");
    readProductionFile(e.dataTransfer?.files?.[0]);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.getElementById("productionImportOverlay")?.classList.contains("open")) closeProductionImport();
  });
}
