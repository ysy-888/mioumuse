/**
 * Exports — CSV downloads and printable (Save as PDF) reports.
 *
 * CSV: a UTF-8 file with a byte-order mark and Windows line endings, so
 * Excel opens accents and line breaks correctly.
 *
 * PDF: the report is laid out as its own page in a hidden frame and handed
 * to the browser's print window, where "Save as PDF" writes the file. Style
 * photos are included when the image folder is linked.
 *
 * What's exported:
 *   Need to Shoot   CSV or PDF: the list as it's showing (filters and search applied)
 *   a photoshoot    CSV or PDF: its details and every style in it, in order
 *   Platforms       PDF: the banners showing, with their images
 *   POs             PDF: the month's colours as showing, with their POs
 *   header menu     Export CSV / PDF follow the page you're on
 *
 * The three style reports (Need to Shoot, a photoshoot, POs) are landscape
 * and share their columns: photo, Style #, Color, Description, Type (from
 * the PO), Available, Shoot (Photoshoot / CG) and Notes. A set's pieces are
 * boxed together and kept on one page.
 */

// ── CSV ──────────────────────────────────────────────────────────────────────

function csvValue(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** `rows` are arrays in header order. */
function downloadCsv(fileBase, header, rows) {
  const lines = [header, ...rows].map(row => row.map(csvValue).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `${safeFileName(fileBase)}.csv`);
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File names can't hold \ / : * ? " < > | — keep the rest. */
function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

// ── Printable report ─────────────────────────────────────────────────────────

const REPORT_CSS = `
  @page { size: letter portrait; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1a1a18; font-size: 10.5px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 10px; border-bottom: 2px solid #1a1a18; margin-bottom: 10px; }
  .brand { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: #8b929c; }
  h1 { margin: 2px 0 0; font-size: 20px; letter-spacing: -0.01em; }
  .sub { margin-top: 3px; color: #4b5563; font-size: 11.5px; }
  .generated { color: #8b929c; font-size: 10px; text-align: right; white-space: nowrap; }
  .meta { display: grid; grid-template-columns: repeat(4, auto); justify-content: start; gap: 4px 28px; margin: 0 0 12px; }
  .meta div { display: flex; flex-direction: column; gap: 1px; }
  .meta b { font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #8b929c; }
  .meta span { font-size: 11.5px; font-weight: 600; }
  .notes { margin: -4px 0 12px; padding: 8px 10px; background: #f7f7f8; border-radius: 6px; white-space: pre-wrap; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #4b5563; background: #eef1f4; padding: 6px; border-bottom: 1px solid #cbd0d6; }
  td { padding: 5px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  td.photo { width: 54px; padding: 3px 6px; }
  td.photo img { display: block; width: 46px; height: 46px; object-fit: cover; border-radius: 4px; border: 1px solid #e5e7eb; }
  td.photo .none { width: 46px; height: 46px; border: 1px dashed #d4d9df; border-radius: 4px; }
  td.banner { width: 190px; padding: 4px 6px; }
  td.banner img { display: block; width: 178px; max-height: 90px; object-fit: contain; border-radius: 4px; border: 1px solid #e5e7eb; }
  td.strong { font-weight: 700; white-space: nowrap; }
  td.nowrap { white-space: nowrap; }
  td.check { width: 34px; text-align: center; font-size: 15px; color: #8b929c; }
  .warn { color: #c81e1e; font-weight: 700; }
  .sub-note { color: #8b929c; font-size: 9px; }
  /* A scheduled shoot on the POs report: the app's purple Studio pill, two lines. */
  .pill.scheduled.two-line { background: #ece6fb; color: #5a3aa8; border-radius: 6px; padding: 2px 8px; line-height: 1.25; text-align: center; }
  .pill.two-line span { font-weight: 500; }
  .po-line { display: inline-flex; align-items: center; gap: 4px; width: 80px; padding: 1px 7px; border-radius: 9px; background: #d3efe2; color: #0b6648; font-size: 9.5px; font-weight: 600; white-space: nowrap; }
  .po-line-icons { display: inline-flex; gap: 2px; }
  .po-line-icons svg { display: block; width: 10px; height: 10px; }
  .po-line[data-kind="newColor"] { background: #d4edf2; color: #0e687a; }
  .po-line[data-kind="recut"] { background: #dce6f7; color: #2b559a; }
  .available-pill { display: inline-block; padding: 1px 6px; border-radius: 5px; background: #f1f3f5; box-shadow: inset 0 0 0 1px #e3e6ea; color: #4b5563; font-size: 9.5px; font-weight: 600; letter-spacing: 0.04em; white-space: nowrap; }
  .available-pill.is-mismatch { background: #fef3c7; box-shadow: inset 0 0 0 1px #f5c56b; color: #92400e; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 9px; background: #eef0f3; font-size: 9.5px; font-weight: 600; white-space: nowrap; }
  .pill.needed { background: #fdf0d5; color: #8a5a00; }
  .pill.scheduled { background: #e1ecfb; color: #1f56a5; }
  .pill.shot { background: #e1f5ee; color: #0f6e56; }
  footer { margin-top: 10px; color: #8b929c; font-size: 9.5px; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .po-line[data-kind="other"] { background: #eef0f3; color: #4b5563; }
  td.desc { min-width: 150px; }
  td.note-col { width: 24%; min-width: 150px; white-space: pre-wrap; overflow-wrap: anywhere; }
  th.note-col { width: 24%; }
  /* Photoshoot / CG. A scheduled Photoshoot carries its date and shoot under it. */
  .method { display: inline-block; padding: 1px 8px; border-radius: 9px; font-size: 9.5px; font-weight: 700; white-space: nowrap; }
  .method.photoshoot { background: #ece6fb; color: #5a3aa8; }
  .method.cg { background: #d9f0f3; color: #0e687a; }
  .method.none { background: none; padding-left: 0; color: #8b929c; font-weight: 500; }
  .method-sub { margin-top: 2px; color: #4b5563; font-size: 9px; white-space: nowrap; }
  /* A set: its pieces in one box, kept on one page, tagged SET. */
  tbody.set { break-inside: avoid; page-break-inside: avoid; }
  tbody.set td { background: #f5f9fe; }
  tbody.set td:first-child { box-shadow: inset 3px 0 0 #8fb0dc; }
  tbody.set tr:not(:last-child) td { border-bottom-color: #e2eaf6; }
  tbody.set tr:last-child td { border-bottom: 1px solid #b8cce9; }
  tbody.set tr:first-child td { border-top: 1px solid #b8cce9; }
  .set-tag { display: inline-block; margin-left: 5px; padding: 0 4px; border-radius: 3px; background: #e1ebf8; color: #2f5f9e; font-size: 7.5px; font-weight: 700; letter-spacing: 0.06em; vertical-align: 1px; }
  header .meta { margin: 0; justify-content: end; grid-template-columns: none; grid-auto-flow: column; }
`;

function escapeReportHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Each row's thumbnail ("" when it has no photo). Every one means reading a
 * full-size photo from the image folder and shrinking it, so a long list
 * (Need to Shoot) takes a while: a few at a time, with a running count.
 * Thumbnails already made for the tables are reused.
 */
async function loadReportThumbs(rows) {
  const thumbs = new Array(rows.length).fill("");
  const hasModel = r => getStyleImageEntries(r.styleNo, r.color).length > 0;
  // No model photos yet: the sample photo stands in.
  const todo = rows.map((r, i) => i).filter(i => hasModel(rows[i]) || hasSamplePhoto(rows[i].styleNo, rows[i].color));
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const i = todo[next++];
      thumbs[i] = await (hasModel(rows[i]) ? getStyleThumbUrl : getSampleThumbUrl)(rows[i].styleNo, rows[i].color).catch(() => "");
      done++;
      if (todo.length > 12 && (done % 5 === 0 || done === todo.length)) {
        showIndicator(`Loading photos ${done} / ${todo.length}…`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  return thumbs;
}

/**
 * Lay out a report and open the print window for it.
 *
 * columns: [{ label, cell(row) → { text, html?, className? } }]
 * rows:    whatever `cell` reads; each needs styleNo / color for its photo
 * noun:    what a row is, for the count at the top
 * landscape: lay the page sideways (the style reports, which have more columns)
 * metaInHeader: the meta fields sit on the right of the header, in place of
 *          the "Generated" date and row count (shoot and Need to Shoot)
 * setKey:  row → what set it's in ("" for none). Rows next to each other
 *          with the same key are boxed together and kept on one page.
 */
async function printReport({ fileTitle, title, subtitle = "", meta = [], notes = "", columns, rows, photos, footnote = "", noun = "style", metaInHeader = false, landscape = false, setKey = null }) {
  if (!rows.length) {
    showIndicator("Nothing to export", "error");
    return;
  }
  showIndicator(photos ? "Preparing the report (loading photos)…" : "Preparing the report…");

  // Photos come from the linked image folder, as small thumbnails.
  const thumbs = photos ? await loadReportThumbs(rows) : [];

  const head = (photos ? "<th></th>" : "") + columns.map(c => `<th class="${c.className ?? ""}">${escapeReportHtml(c.label)}</th>`).join("");
  const rowHtml = (row, i) => {
    const photo = photos
      ? `<td class="photo">${thumbs[i] ? `<img src="${thumbs[i]}" alt="">` : '<div class="none"></div>'}</td>`
      : "";
    const cells = columns.map(c => {
      const cell = c.cell(row);
      return `<td class="${cell.className ?? ""}">${cell.html ?? escapeReportHtml(cell.text)}</td>`;
    }).join("");
    return `<tr>${photo}${cells}</tr>`;
  };
  // One <tbody> per run of rows: a set's pieces share one (boxed, unbroken).
  const runs = [];
  rows.forEach((row, i) => {
    const key = setKey?.(row) ?? "";
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.html.push(rowHtml(row, i));
    else runs.push({ key, html: [rowHtml(row, i)] });
  });
  const body = runs.map(run => `<tbody${run.key && run.html.length > 1 ? ' class="set"' : ""}>${run.html.join("")}</tbody>`).join("");

  const generated = `${formatReportDate(todayYmd())} ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  const metaHtml = meta.length ? `<div class="meta">${meta.map(([k, v]) => `<div><b>${escapeReportHtml(k)}</b><span>${escapeReportHtml(v)}</span></div>`).join("")}</div>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeReportHtml(fileTitle)}</title><style>${REPORT_CSS}${landscape ? "@page { size: letter landscape; }" : ""}</style></head><body>
    <header>
      <div><div class="brand">${escapeReportHtml(APP_NAME)}</div><h1>${escapeReportHtml(title)}</h1>${subtitle ? `<div class="sub">${escapeReportHtml(subtitle)}</div>` : ""}</div>
      ${metaInHeader ? metaHtml : `<div class="generated">Generated ${escapeReportHtml(generated)}<br>${rows.length} ${rows.length === 1 ? noun : `${noun}s`}</div>`}
    </header>
    ${metaInHeader ? "" : metaHtml}
    ${notes ? `<div class="notes">${escapeReportHtml(notes)}</div>` : ""}
    <table><thead><tr>${head}</tr></thead>${body}</table>
    ${footnote ? `<footer>${escapeReportHtml(footnote)}</footer>` : ""}
  </body></html>`;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();

  // Every photo has to be in before the page is printed.
  await Promise.all([...doc.images].map(img => img.complete ? null : new Promise(res => { img.onload = img.onerror = res; })));

  // Chrome names the saved PDF after the page title.
  const pageTitle = document.title;
  document.title = fileTitle;
  const cleanUp = () => {
    document.title = pageTitle;
    setTimeout(() => frame.remove(), 100);
  };
  frame.contentWindow.addEventListener("afterprint", cleanUp, { once: true });
  clearIndicator();
  frame.contentWindow.focus();
  frame.contentWindow.print();
  // Fallback for browsers that don't fire afterprint from a frame.
  setTimeout(() => {
    if (!frame.isConnected) return;
    if (document.title === fileTitle) document.title = pageTitle;
    frame.remove();
  }, 60 * 1000);
}

/** "2026-10-28" → "10/28/26", the date format reports print in. */
function formatReportDate(value) {
  const m = /^\d{2}(\d{2})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/** Photos in reports only when the folder is linked and readable. */
function reportHasPhotos() {
  return styleImageState === "ready" || styleImageState === "scanning" || samplePhotoState === "ready" || samplePhotoState === "scanning";
}

// ── Shared style fields ──────────────────────────────────────────────────────

function styleExportFields(styleNo, color) {
  const style = findStyle(styleNo, color);
  const status = describeShootStatus(styleNo, color);
  return {
    styleNo,
    color,
    style,
    description: style?.description ?? "",
    category: style?.category ?? "",
    season: style?.season ?? "",
    n41: style?.status ?? "",
    ihd: style?.ihd ?? "",
    availableDate: style?.availableDate ?? "",
    notes: style?.notes ?? "",
    // From its PO, not chosen (js/store.js getShootType).
    type: getShootType(styleNo, color),
    // Photoshoot / CG — "" until it's decided.
    method: getShootMethod(styleNo, color),
    status,
    // The planned shoot it's in (the soonest).
    shoot: status?.tone === "scheduled" ? status.shoots[0] : null,
  };
}

function shootStatusText(styleNo, color) {
  return describeShootStatus(styleNo, color)?.label ?? "";
}

/** A set's key for a report row — rows with the same one are boxed together. */
function reportSetKey(r) {
  return styleSetKey(r.styleNo, r.color);
}

/**
 * The columns every style report has, in order: Style #, Color, Description,
 * Type, Available, Shoot, Notes. `rows` is the report's rows (a set's SET tag
 * only shows when another of its pieces is in the report); `shoot` is the
 * photoshoot the report is of, when it is one.
 */
function reportStyleColumns(rows, { shoot = null } = {}) {
  const setCounts = new Map();
  rows.forEach(r => {
    const key = reportSetKey(r);
    if (key) setCounts.set(key, (setCounts.get(key) ?? 0) + 1);
  });
  const inSet = r => (setCounts.get(reportSetKey(r)) ?? 0) > 1;
  return {
    styleNo: {
      label: "Style #",
      cell: r => ({ html: escapeReportHtml(r.styleNo) + (inSet(r) ? '<span class="set-tag">SET</span>' : ""), className: "strong" }),
    },
    color: { label: "Color", cell: r => ({ text: r.color, className: "nowrap" }) },
    description: { label: "Description", cell: r => ({ text: r.description, className: "desc" }) },
    type: { label: "Type", cell: r => ({ html: shootTypePillHtml(r.type) || "–", className: "nowrap" }) },
    available: {
      label: "Available",
      cell: r => ({
        html: r.availableDate
          ? `<span class="available-pill${r.style?.availMismatch ? " is-mismatch" : ""}">${escapeReportHtml(formatMonYY(r.availableDate))}</span>`
          : "–",
        className: "nowrap",
      }),
    },
    shoot: { label: "Shoot", cell: r => ({ html: reportMethodHtml(r, shoot) }) },
    notes: { label: "Notes", className: "note-col", cell: r => ({ text: r.notes, className: "note-col" }) },
  };
}

/**
 * Photoshoot or CG as a pill. In a shoot's own report it's just Photoshoot;
 * elsewhere a scheduled one carries its shoot's date and name underneath, a
 * finished one says Shot / Done (CG) and when.
 */
function reportMethodHtml(r, ownShoot = null) {
  const pill = (key, text) => `<span class="method ${key}">${escapeReportHtml(text)}</span>`;
  const sub = text => `<div class="method-sub">${escapeReportHtml(text)}</div>`;
  if (ownShoot) return pill("photoshoot", "Photoshoot");
  const status = r.status;
  if (status?.tone === "shot") return pill(status.shoots.length ? "photoshoot" : "cg", status.shoots.length ? "Photoshoot" : "CG") + sub(status.label);
  if (r.method === "cg") return pill("cg", "CG");
  if (r.method === "photoshoot") {
    if (!r.shoot) return pill("photoshoot", "Photoshoot") + sub("Not scheduled");
    const more = status.shoots.length > 1 ? ` +${status.shoots.length - 1}` : "";
    return pill("photoshoot", "Photoshoot") + sub(`${r.shoot.date ? formatReportDate(r.shoot.date) : "No date"} · ${getPhotoshootTitle(r.shoot)}${more}`);
  }
  return status ? pill("none", "To decide") : "";
}

/** The same as words, for a CSV. */
function methodExportText(r) {
  if (r.status?.tone === "shot") return r.status.label;
  return getShootMethodLabel(r.method) || (r.status ? "To decide" : "");
}

// ── Need to Shoot ────────────────────────────────────────────────────────────

/** The rows the Need to Shoot table is showing right now, sets together. */
function getNeedExportRows() {
  renderNeedTable(); // brings filteredNeedRows up to date
  return filteredNeedRows.map(r => ({ ...styleExportFields(r.styleNo, r.color), addedAt: r.addedAt }));
}

function exportNeedCsv() {
  const rows = getNeedExportRows();
  if (!rows.length) {
    showIndicator("Nothing to export", "error");
    return;
  }
  downloadCsv(`Need to Shoot ${todayYmd()}`,
    ["Style #", "Color", "Description", "Type", "Available", "Shoot", "Shoot Date", "Photoshoot", "Notes", "Category", "Season", "N41 Status", "IHD", "Added"],
    rows.map(r => [
      r.styleNo, r.color, r.description, getShootReasonLabel(r.type), formatMonYY(r.availableDate),
      methodExportText(r),
      r.shoot?.date ?? "",
      r.shoot ? getPhotoshootTitle(r.shoot) : "",
      r.notes, r.category, r.season, r.n41, r.ihd,
      r.addedAt ? r.addedAt.slice(0, 10) : "",
    ]));
  showIndicator(`Exported ${rows.length} ${rows.length === 1 ? "style" : "styles"}`, "success");
}

/** Need to Shoot as a printable list, laid out like a shoot's report. */
function exportNeedPdf() {
  const rows = getNeedExportRows();
  const count = test => String(rows.filter(test).length);
  const cols = reportStyleColumns(rows);
  printReport({
    fileTitle: `Need to Shoot ${todayYmd()}`,
    title: "Need to Shoot",
    meta: [
      ["Styles", String(rows.length)],
      ["Photoshoot", count(r => r.method === "photoshoot")],
      ["CG", count(r => r.method === "cg")],
      ["To decide", count(r => !r.method)],
    ],
    metaInHeader: true,
    landscape: true,
    photos: reportHasPhotos(),
    rows,
    setKey: reportSetKey,
    columns: [cols.styleNo, cols.color, cols.description, cols.type, cols.available, cols.shoot, cols.notes],
  });
}

// ── One photoshoot ───────────────────────────────────────────────────────────

/** A shoot's styles in its order — each set's pieces together, as its pane shows them. */
function getShootExportRows(shoot) {
  return getShootBlocks(shoot).flat().map(s => styleExportFields(s.styleNo, s.color));
}

function shootFileBase(shoot) {
  return `Photoshoot ${shoot.date || "undated"} ${getPhotoshootTitle(shoot)}`;
}

function exportShootCsv(id) {
  const shoot = getPhotoshootById(id);
  if (!shoot) return;
  const rows = getShootExportRows(shoot);
  if (!rows.length) {
    showIndicator("This shoot has no styles yet", "error");
    return;
  }
  downloadCsv(shootFileBase(shoot),
    ["Shoot", "Shoot Date", "Shoot Type", "Model", "Status", "#", "Style #", "Color", "Description", "Type", "Available", "Notes", "Category", "Season", "N41 Status", "IHD"],
    rows.map((r, i) => [
      getPhotoshootTitle(shoot), shoot.date, getPhotoshootTypeLabel(shoot.type), shoot.model,
      shoot.status === "complete" ? "Complete" : "Planned",
      i + 1, r.styleNo, r.color, r.description, getShootReasonLabel(r.type), formatMonYY(r.availableDate), r.notes,
      r.category, r.season, r.n41, r.ihd,
    ]));
  showIndicator(`Exported ${rows.length} ${rows.length === 1 ? "style" : "styles"}`, "success");
}

function exportShootPdf(id) {
  const shoot = getPhotoshootById(id);
  if (!shoot) return;
  const rows = getShootExportRows(shoot);
  const cols = reportStyleColumns(rows, { shoot });
  printReport({
    fileTitle: shootFileBase(shoot),
    title: getPhotoshootTitle(shoot),
    meta: [
      ["Date", shoot.date ? formatReportDate(shoot.date) : "No date"],
      ["Type", getPhotoshootTypeLabel(shoot.type)],
      ["Model", shoot.model || "—"],
      ["Status", shoot.status === "complete" ? "Complete" : "Planned"],
      ["Styles", String(rows.length)],
    ],
    metaInHeader: true,
    landscape: true,
    notes: shoot.notes,
    photos: reportHasPhotos(),
    rows,
    setKey: reportSetKey,
    columns: [
      { label: "Shot", cell: () => ({ text: "☐", className: "check" }) },
      { label: "#", cell: r => ({ text: String(rows.indexOf(r) + 1), className: "nowrap" }) },
      cols.styleNo, cols.color, cols.description, cols.type, cols.available, cols.shoot, cols.notes,
    ],
  });
}

// ── POs ──────────────────────────────────────────────────────────────────────

/**
 * The POs page as it's showing — the month picked (or every month when
 * searching them all, or the deleted POs), filters and search applied —
 * one row per colour with the PO(s) it's on.
 */
function exportPoPdf() {
  const groups = poMonth || isPoSearchingAll() || poShowDeleted ? buildPoGroups() : [];
  const rows = [];
  groups.forEach(g => {
    const posOf = color => g.pos.filter(po => po.colors.includes(color.trim().toUpperCase()));
    g.colors.forEach(s => rows.push({ group: g, style: s, styleNo: s.styleNo, color: s.color, pos: posOf(s.color) }));
    // On a PO but not in the style database.
    g.missingColors.forEach(c => rows.push({ group: g, style: null, styleNo: g.styleNo, color: c, pos: posOf(c) }));
  });
  const scope = poShowDeleted ? "Deleted POs" : isPoSearchingAll() ? "All months" : formatPoMonth(poMonth);
  const poCount = new Set(groups.flatMap(g => g.pos.map(po => po.poNo))).size;
  // The shared columns read a row's own fields; the Type here is the colour's
  // kind on the POs showing (as on the page), not just its newest PO's.
  rows.forEach(r => {
    Object.assign(r, styleExportFields(r.styleNo, r.color));
    r.type = PO_KIND_SHOOT_TYPE[poColorKind(r.group, { color: r.color })] ?? "";
  });
  const cols = reportStyleColumns(rows);
  printReport({
    fileTitle: `POs ${poShowDeleted ? "deleted" : isPoSearchingAll() ? "all months" : poMonth} ${todayYmd()}`,
    title: "POs",
    subtitle: scope,
    meta: [
      ["Styles", String(groups.length)],
      ["Colors", String(rows.length)],
      ["POs", String(poCount)],
    ],
    metaInHeader: true,
    landscape: true,
    photos: reportHasPhotos(),
    rows,
    noun: "color",
    columns: [
      cols.styleNo, cols.color, cols.description,
      {
        label: "PO # · ETA",
        cell: r => ({
          html: r.pos.map(po => `${escapeReportHtml(po.poNo)} · ${!po.eta || isPlaceholderDate(po.eta) ? "–" : escapeReportHtml(formatReportDate(po.eta))}${po.statuses.size ? ` <span class="sub-note">${escapeReportHtml(po.statuses.size > 1 ? "Part closed" : [...po.statuses][0])}</span>` : ""}`).join("<br>"),
          className: "nowrap",
        }),
      },
      cols.type, cols.available,
      { label: "N41", cell: r => ({ text: r.n41, className: "nowrap" }) },
      cols.shoot, cols.notes,
    ],
  });
}

// ── Styles and banners (for the header menu) ─────────────────────────────────

function exportStylesCsv() {
  const rows = filteredStyles.length ? filteredStyles : getAllStyles();
  if (!rows.length) {
    showIndicator("Nothing to export", "error");
    return;
  }
  downloadCsv(`Styles ${todayYmd()}`,
    ["Style #", "Color", "Description", "Category", "Season", "N41 Status", "IHD", "Shoot Status"],
    rows.map(s => [s.styleNo, s.color, s.description, s.category, s.season, s.status, s.ihd, shootStatusText(s.styleNo, s.color)]));
  showIndicator(`Exported ${rows.length.toLocaleString()} styles`, "success");
}

/** Platforms: the banners showing, each with its image, name and styles. */
function exportBannersPdf() {
  const banners = filteredBanners.length ? filteredBanners : getAllBanners();
  printReport({
    fileTitle: `Banners ${todayYmd()}`,
    title: "Banners",
    meta: [
      ["Banners", String(banners.length)],
      ...PLATFORMS.map(p => [p.label, String(banners.filter(b => b.platforms.includes(p.key)).length)]),
    ],
    rows: banners,
    noun: "banner",
    columns: [
      {
        label: "Image",
        cell: b => {
          const url = getBannerImageUrl(b);
          return { html: url ? `<img src="${escapeReportHtml(url)}" alt="">` : "", className: "banner" };
        },
      },
      { label: "Banner", cell: b => ({ text: b.name, className: "strong" }) },
      { label: "Type", cell: b => ({ text: getBannerTypeLabel(b.type), className: "nowrap" }) },
      { label: "Platforms", cell: b => ({ text: b.platforms.map(getPlatformLabel).join(", ") }) },
      { label: "Size", cell: b => ({ text: formatBannerSize(b), className: "nowrap" }) },
      { label: "Styles", cell: b => ({ text: b.styles.map(s => [s.styleNo, s.color].filter(Boolean).join(" ")).join(", ") }) },
    ],
  });
}

/** Header menu → Export CSV: the records on the page you're on. */
function exportCurrentViewCsv() {
  switch (getCurrentAppView()) {
    case "campaigns": return exportScheduleCsv(ITEM_TYPE_CAMPAIGN);
    case "tradeShows": return exportScheduleCsv(ITEM_TYPE_TRADE_SHOW);
    case "needToShoot": return exportNeedCsv();
    case "styles": return exportStylesCsv();
    case "magento": return exportMagentoCsv(); // js/magento.js
  }
}

function initExports() {
  document.getElementById("headerMenuExportPdf")?.addEventListener("click", () => {
    closeHeaderMenu();
    const view = getCurrentAppView();
    if (view === "needToShoot") exportNeedPdf();
    else if (view === "pos") exportPoPdf();
    else exportBannersPdf();
  });
  document.getElementById("shootMenuExportCsv")?.addEventListener("click", () => {
    closeShootPaneMenu();
    if (paneShootId) exportShootCsv(paneShootId);
  });
  document.getElementById("shootMenuExportPdf")?.addEventListener("click", () => {
    closeShootPaneMenu();
    if (paneShootId) exportShootPdf(paneShootId);
  });
}
