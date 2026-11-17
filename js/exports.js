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
 * the PO), Available, Shoot (Photoshoot / CG) and Notes. A photoshoot's own
 * report has Sample (TOP / SHOW / PP) after Color in place of Shoot.
 * A set's pieces are boxed together and kept on one page.
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
  /* "Photoshoot" before a shoot's name: the label bold, the name lighter. */
  h1 .title-label { margin-right: 8px; }
  h1 .title-name { font-weight: 500; color: #8b929c; }
  .sub { margin-top: 3px; color: #4b5563; font-size: 11.5px; }
  .generated { color: #8b929c; font-size: 10px; text-align: right; white-space: nowrap; }
  .meta { display: grid; grid-template-columns: repeat(4, auto); justify-content: start; gap: 4px 28px; margin: 0 0 12px; }
  .meta div { display: flex; flex-direction: column; gap: 1px; }
  .meta b { font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #8b929c; }
  .meta span { font-size: 11.5px; font-weight: 600; }
  /* Quantities (a shoot's Styles, Outfits, sample statuses): one shaded box,
     each label over its number; the totals larger, a line before the rest. */
  .meta .meta-qty { flex-direction: row; align-items: flex-end; gap: 14px; padding: 4px 11px; border-radius: 6px; background: #eef0f3; }
  .meta-qty .qty { align-items: center; text-align: center; }
  .meta-qty .qty span { font-variant-numeric: tabular-nums; }
  .meta-qty .qty.total span { font-weight: 700; }
  .meta-qty .qty.total b { color: #4b5563; }
  .meta-qty .qty.total + .qty:not(.total) { padding-left: 14px; border-left: 1px solid #c9ced4; }
  .notes { margin: -4px 0 12px; padding: 8px 10px; background: #f7f7f8; border-radius: 6px; white-space: pre-wrap; }
  /* Borders don't collapse: when printed, collapsed borders of different
     widths meet unevenly (steps, slivers, a group's edge left on the wrong page). */
  table { width: 100%; border-collapse: separate; border-spacing: 0; }
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
  .avail-stack { display: inline-flex; flex-direction: column; align-items: center; }
  .ihd-under { margin-top: 2px; color: #4b5563; font-size: 9px; font-variant-numeric: tabular-nums; }
  .available-pill.is-mismatch { background: #fef3c7; box-shadow: inset 0 0 0 1px #f5c56b; color: #92400e; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 9px; background: #eef0f3; font-size: 9.5px; font-weight: 600; white-space: nowrap; }
  .pill.needed { background: #fdf0d5; color: #8a5a00; }
  .pill.scheduled { background: #e1ecfb; color: #1f56a5; }
  .pill.shot { background: #e1f5ee; color: #0f6e56; }
  footer { margin-top: 10px; color: #8b929c; font-size: 9.5px; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .po-line[data-kind="other"] { background: #eef0f3; color: #4b5563; }
  td.desc { min-width: 150px; }
  td.desc.muted { color: #9aa0a8; }
  th.center, td.center { text-align: center; }
  td.note-col { width: 24%; min-width: 150px; white-space: pre-wrap; overflow-wrap: anywhere; }
  th.note-col { width: 24%; }
  /* Photoshoot / CG. A scheduled Photoshoot carries its date and shoot under it. */
  .method { display: inline-block; padding: 1px 8px; border-radius: 9px; font-size: 9.5px; font-weight: 700; white-space: nowrap; }
  .method.photoshoot { background: #ece6fb; color: #5a3aa8; }
  .method.cg { background: #d9f0f3; color: #0e687a; }
  .method.none { background: none; padding-left: 0; color: #8b929c; font-weight: 500; }
  .method-sub { margin-top: 2px; color: #4b5563; font-size: 9px; white-space: nowrap; }
  /* A style group (a Style # in several colours, or a set): in one grey box, kept on one page. */
  tbody.group { break-inside: avoid; page-break-inside: avoid; }
  tbody.group td { background: #f7f8f9; }
  tbody.group tr:not(:last-child) td { border-bottom-color: #e6e8eb; }
  /* Its edges: 1px all round in a neutral grey, corners rounded. */
  tbody.group td:first-child { border-left: 1px solid #a3a9b1; }
  tbody.group td:last-child { border-right: 1px solid #a3a9b1; }
  tbody.group tr:last-child td { border-bottom: 1px solid #a3a9b1; }
  tbody.group tr:first-child td { border-top: 1px solid #a3a9b1; }
  tbody.group tr:first-child td:first-child { border-top-left-radius: 6px; }
  tbody.group tr:first-child td:last-child { border-top-right-radius: 6px; }
  tbody.group tr:last-child td:first-child { border-bottom-left-radius: 6px; }
  tbody.group tr:last-child td:last-child { border-bottom-right-radius: 6px; }
  /* Before and after each group: a small gap, so each is its own box. */
  tbody.gap td { height: 6px; padding: 0; border: 0; background: none; }
  /* A set's pieces (one colour): a rounded [ in front of their Style #s, tagged SET.
     Every Style # leaves room for it, so they line up. */
  td.style-no { position: relative; padding-left: 16px; }
  tr:is(.set-first, .set-mid, .set-last) td.style-no::before { content: ""; position: absolute; left: 6px; width: 5px; border-left: 1.5px solid #b3b9c2; z-index: 1; }
  tr.set-first td.style-no::before { top: 50%; bottom: -1px; border-top: 1.5px solid #b3b9c2; border-top-left-radius: 5px; }
  tr.set-mid td.style-no::before { top: -1px; bottom: -1px; }
  tr.set-last td.style-no::before { top: -1px; bottom: 50%; border-bottom: 1.5px solid #b3b9c2; border-bottom-left-radius: 5px; }
  .set-tag { display: inline-block; margin-left: 5px; padding: 0 4px; border-radius: 3px; background: #fbe5ee; color: #a3365f; font-size: 7.5px; font-weight: 700; letter-spacing: 0.06em; vertical-align: 1px; }
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
 * groupKey: row → its style group ("" for none) — the Style #, or a set's
 *          pieces, any colour. Rows next to each other with the same key
 *          (two or more) are boxed together and kept on one page.
 * setKey:  row → what set it's in ("" for none). Rows next to each other
 *          with the same key (one colour's pieces) are joined by a bracket
 *          in front of the Style # — the column marked `bracket: true`.
 * extraHtml / extraCss: more pages after the list (a shoot's photo pages).
 */
async function printReport({ fileTitle, title, titleLabel = "", subtitle = "", meta = [], notes = "", columns, rows, photos, footnote = "", noun = "style", metaInHeader = false, landscape = false, groupKey = null, setKey = null, extraHtml = "", extraCss = "" }) {
  if (!rows.length) {
    showIndicator("Nothing to export", "error");
    return;
  }
  showIndicator(photos ? "Preparing the report (loading photos)…" : "Preparing the report…");

  // Photos come from the linked image folder, as small thumbnails.
  const thumbs = photos ? await loadReportThumbs(rows) : [];

  const head = (photos ? "<th></th>" : "") + columns.map(c => `<th class="${c.className ?? ""}">${escapeReportHtml(c.label)}</th>`).join("");
  /** Each row's place among neighbours with the same `keyOf` (two or more of them): "first" | "mid" | "last", or "". */
  const placesBy = keyOf => {
    const keys = rows.map(r => keyOf?.(r) ?? "");
    return keys.map((k, i) => {
      if (!k) return "";
      const before = keys[i - 1] === k;
      const after = keys[i + 1] === k;
      return before && after ? "mid" : after ? "first" : before ? "last" : "";
    });
  };
  const groupPlace = placesBy(groupKey);
  const setPlace = placesBy(setKey);
  const rowHtml = (row, i) => {
    const photo = photos
      ? `<td class="photo">${thumbs[i] ? `<img src="${thumbs[i]}" alt="">` : '<div class="none"></div>'}</td>`
      : "";
    const cells = columns.map(c => {
      const cell = c.cell(row);
      const className = [cell.className, c.bracket ? "style-no" : ""].filter(Boolean).join(" ");
      return `<td class="${className}">${cell.html ?? escapeReportHtml(cell.text)}</td>`;
    }).join("");
    return `<tr${setPlace[i] ? ` class="set-${setPlace[i]}"` : ""}>${photo}${cells}</tr>`;
  };
  // One <tbody> per style group (boxed, kept on one page); the rows between
  // groups share plain ones.
  const runs = [];
  rows.forEach((row, i) => {
    const grouped = Boolean(groupPlace[i]);
    const last = runs[runs.length - 1];
    if (last && (grouped ? groupPlace[i] !== "first" : !last.grouped)) last.html.push(rowHtml(row, i));
    else runs.push({ grouped, html: [rowHtml(row, i)] });
  });
  const columnCount = columns.length + (photos ? 1 : 0);
  const gap = `<tbody class="gap"><tr><td colspan="${columnCount}"></td></tr></tbody>`;
  const body = runs.map((run, r) =>
    (r > 0 && (run.grouped || runs[r - 1].grouped) ? gap : "") +
    `<tbody${run.grouped ? ' class="group"' : ""}>${run.html.join("")}</tbody>`).join("");

  const generated = `${formatReportDate(todayYmd())} ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  // [label, value, { qty, total }]: a run of qty items shares one shaded box,
  // its totals (Styles, Outfits) larger and set off from the rest by a line.
  const metaItem = ([k, v, { qty = false, total = false } = {}]) =>
    `<div${qty ? ` class="qty${total ? " total" : ""}"` : ""}><b>${escapeReportHtml(k)}</b><span>${escapeReportHtml(v)}</span></div>`;
  const metaParts = [];
  meta.forEach(item => {
    const qty = Boolean(item[2]?.qty);
    const last = metaParts[metaParts.length - 1];
    if (qty && last?.qty) last.items.push(item);
    else metaParts.push({ qty, items: [item] });
  });
  const metaHtml = meta.length ? `<div class="meta">${metaParts.map(part => part.qty
    ? `<div class="meta-qty">${part.items.map(metaItem).join("")}</div>`
    : part.items.map(metaItem).join("")).join("")}</div>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeReportHtml(fileTitle)}</title><style>${REPORT_CSS}${landscape ? "@page { size: letter landscape; }" : ""}${extraCss}</style></head><body>
    <header>
      <div><div class="brand">${escapeReportHtml(APP_NAME)}</div><h1>${titleLabel ? `<span class="title-label">${escapeReportHtml(titleLabel)}</span><span class="title-name">${escapeReportHtml(title)}</span>` : escapeReportHtml(title)}</h1>${subtitle ? `<div class="sub">${escapeReportHtml(subtitle)}</div>` : ""}</div>
      ${metaInHeader ? metaHtml : `<div class="generated">Generated ${escapeReportHtml(generated)}<br>${rows.length} ${rows.length === 1 ? noun : `${noun}s`}</div>`}
    </header>
    ${metaInHeader ? "" : metaHtml}
    ${notes ? `<div class="notes">${escapeReportHtml(notes)}</div>` : ""}
    <table><thead><tr>${head}</tr></thead>${body}</table>
    ${footnote ? `<footer>${escapeReportHtml(footnote)}</footer>` : ""}
    ${extraHtml}
  </body></html>`;
  await printHtml(html, fileTitle);
}

/** Write a page into a hidden frame and open the print window for it (Save as PDF). */
async function printHtml(html, fileTitle) {
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
    // TOP / SHOW / PP, "" for none.
    sampleStatus: style?.sampleStatus ?? "",
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

/** A set's key for a report row (one colour's pieces) — rows with the same one get the bracket. */
function reportSetKey(r) {
  return styleSetKey(r.styleNo, r.color);
}

/** A report row's style group — boxed with its neighbours, as in the app (js/store.js styleFamilyKey). */
function reportGroupKey(r) {
  return styleFamilyKey(r.styleNo);
}

/** On Need to Shoot a group also stays within its Available month. */
function reportNeedGroupKey(r) {
  return `${/^\d{4}-\d{2}/.exec(r.availableDate ?? "")?.[0] ?? ""}\u0000${styleFamilyKey(r.styleNo)}`;
}

/**
 * The columns the style reports pick from: Style #, Color, Sample,
 * Description, Type, Available, Shoot, Notes. `rows` is the report's rows (a
 * set's SET tag only shows when another of its pieces is in the report).
 */
function reportStyleColumns(rows) {
  const setCounts = new Map();
  rows.forEach(r => {
    const key = reportSetKey(r);
    if (key) setCounts.set(key, (setCounts.get(key) ?? 0) + 1);
  });
  const inSet = r => (setCounts.get(reportSetKey(r)) ?? 0) > 1;
  return {
    styleNo: {
      label: "Style #",
      bracket: true,
      cell: r => ({ html: escapeReportHtml(r.styleNo) + (inSet(r) ? '<span class="set-tag">SET</span>' : ""), className: "strong" }),
    },
    color: { label: "Color", cell: r => ({ text: r.color, className: "nowrap" }) },
    sample: { label: "Sample", className: "center", cell: r => ({ text: getSampleStatusLabel(r.sampleStatus) || "–", className: "nowrap center" }) },
    description: { label: "Description", cell: r => ({ text: r.description, className: "desc" }) },
    type: { label: "Type", cell: r => ({ html: shootTypePillHtml(r.type) || "–", className: "nowrap" }) },
    available: { label: "Available", cell: r => ({ html: reportAvailableHtml(r), className: "nowrap" }) },
    // The same, with the IHD (when there is one) under the pill.
    availableIhd: {
      label: "Available",
      cell: r => {
        const ihd = r.style ? ihdSortValue(r.style) : "";
        // The pill and the date centred on each other.
        return { html: `<span class="avail-stack">${reportAvailableHtml(r)}${ihd ? `<span class="ihd-under">${escapeReportHtml(formatReportDate(ihd))}</span>` : ""}</span>`, className: "nowrap" };
      },
    },
    shoot: { label: "Shoot", cell: r => ({ html: reportMethodHtml(r) }) },
    notes: { label: "Notes", className: "note-col", cell: r => ({ text: r.notes, className: "note-col" }) },
  };
}

/** A row's Available month as the pill (amber when it disagrees with the PO), "–" without one. */
function reportAvailableHtml(r) {
  return r.availableDate
    ? `<span class="available-pill${r.style?.availMismatch ? " is-mismatch" : ""}">${escapeReportHtml(formatAvailableMonth(r.availableDate))}</span>`
    : "–";
}

/**
 * Photoshoot or CG as a pill. A scheduled one carries its shoot's date and
 * name underneath, a finished one says Shot / Done (CG) and when.
 */
function reportMethodHtml(r) {
  const pill = (key, text) => `<span class="method ${key}">${escapeReportHtml(text)}</span>`;
  const sub = text => `<div class="method-sub">${escapeReportHtml(text)}</div>`;
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
    groupKey: reportNeedGroupKey,
    setKey: reportSetKey,
    columns: [cols.styleNo, cols.color, cols.description, cols.type, cols.available, cols.shoot, cols.notes],
  });
}

// ── One photoshoot ───────────────────────────────────────────────────────────

/** A shoot's styles in its order — each set's pieces together, as its pane shows them. */
function getShootExportRows(shoot) {
  return getShootBlocks(shoot).flat(2).map(s => styleExportFields(s.styleNo, s.color));
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

/** The orders a shoot's PDF can print in, besides the shoot's own (the ⋮ menu). */
const SHOOT_PDF_ORDERS = {
  available: "By Available",
  sample: "By Sample",
  style: "By Style",
};

/** The Style # for sorting by it: letters, then the number as a number (T999 before T1000). */
function compareStyleNos(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * A shoot's styles in a PDF order — whole outfits moved (a set's pieces in
 * one colour stay together), ties kept in the shoot's order:
 *   available — as the Available heading sorts: Available, then IHD
 *   sample    — TOP, SHOW, PP, then none (a set by its pieces' highest status)
 *   style     — sets first, then the rest, each by Style # and colour
 */
function shootStylesInOrder(shoot, order) {
  if (order === "available") return sortedShootStyles(shoot, 1);
  const outfits = groupBySet(getShootBlocks(shoot).flat(2));
  if (order !== "sample" && order !== "style") return outfits.flat();
  const rank = [...SAMPLE_STATUS_KEYS, ""];
  const sampleRank = outfit => Math.min(...outfit.map(s => rank.indexOf(findStyle(s.styleNo, s.color)?.sampleStatus ?? "")));
  const lowestNo = outfit => outfit.map(s => s.styleNo).sort(compareStyleNos)[0];
  const isSet = outfit => Boolean(styleSetKey(outfit[0].styleNo, outfit[0].color));
  const compare = order === "sample"
    ? (a, b) => sampleRank(a) - sampleRank(b)
    : (a, b) => (isSet(b) - isSet(a)) || compareStyleNos(lowestNo(a), lowestNo(b)) ||
      String(a[0].color).localeCompare(String(b[0].color));
  return outfits
    .map((outfit, i) => ({ outfit, i }))
    .sort((a, b) => compare(a.outfit, b.outfit) || a.i - b.i)
    .flatMap(x => x.outfit);
}

/**
 * A shoot's PDF report — in its own order, or one of SHOOT_PDF_ORDERS — then
 * its photo pages: every style's sample photo, big, in the list's order
 * (shootPhotoPagesHtml). Without the sample photo folder, just the list.
 */
async function exportShootPdf(id, order = "") {
  const shoot = getPhotoshootById(id);
  if (!shoot) return;
  const orderLabel = SHOOT_PDF_ORDERS[order] ?? "";
  const rows = orderLabel
    ? shootStylesInOrder(shoot, order).map(s => styleExportFields(s.styleNo, s.color))
    : getShootExportRows(shoot);
  const cols = reportStyleColumns(rows);

  let extraHtml = "";
  let urls = null;
  let missing = [];
  if (rows.length && isSamplePhotoReadable()) {
    const cards = rows.map(r => ({ styleNo: r.styleNo, color: r.color, entry: sampleSetPhotoEntry(r.styleNo, r.color) }));
    urls = await loadPhotocardImages(cards, getSamplePhotoFile, "report");
    extraHtml = shootPhotoPagesHtml(shoot, rows, urls);
    missing = rows.filter(r => !urls.get(styleImageKey(r.styleNo, r.color))).map(r => `${r.styleNo} ${r.color}`);
  }

  await printReport({
    fileTitle: orderLabel ? `${shootFileBase(shoot)} ${orderLabel}` : shootFileBase(shoot),
    titleLabel: "Photoshoot",
    title: getPhotoshootTitle(shoot),
    subtitle: orderLabel ? `Sorted ${orderLabel.replace(/^By /, "by ")}` : "",
    meta: [
      ["Date", shoot.date ? formatReportDate(shoot.date) : "No date"],
      ["Type", getPhotoshootTypeLabel(shoot.type)],
      ["Model", shoot.model || "—"],
      ["Status", shoot.status === "complete" ? "Complete" : "Planned"],
      // On one shaded box: Styles, Outfits (a set's pieces in one colour
      // count as one), then how many are TOP / SHOW / PP / None.
      ["Styles", String(rows.length), { qty: true, total: true }],
      ["Outfits", String(countShootOutfits(shoot.styles)), { qty: true, total: true }],
      ...countSampleStatuses(rows).map(s => [s.label, String(s.count), { qty: true }]),
    ],
    metaInHeader: true,
    landscape: true,
    notes: shoot.notes,
    photos: reportHasPhotos(),
    rows,
    groupKey: reportGroupKey,
    setKey: reportSetKey,
    columns: [
      { label: "Shot", cell: () => ({ text: "☐", className: "check" }) },
      { label: "#", cell: r => ({ text: String(rows.indexOf(r) + 1), className: "nowrap" }) },
      cols.styleNo, cols.color, cols.availableIhd, cols.sample,
      // The description in light gray here.
      { ...cols.description, cell: r => ({ ...cols.description.cell(r), className: "desc muted" }) },
      cols.type, cols.notes,
    ],
    extraHtml,
    extraCss: extraHtml ? SHOOT_PHOTO_PAGE_CSS : "",
  });
  if (!rows.length) return;
  if (!urls) showIndicator("Link the sample photo folder to add the photo pages", "error");
  else if (missing.length) showIndicator(`No sample photo for ${missing.join(", ")}`, "error");
  if (urls) setTimeout(() => urls.forEach(url => url && URL.revokeObjectURL(url)), 60 * 1000);
}

// ── A shoot's photo pages ────────────────────────────────────────────────────
//
// After the list: each style's sample photo (js/sample-photos.js), big, in
// the list's order and numbered as it is. Landscape, eight to a page in four
// columns of two, read down each column. A set's pieces are one column, top
// over bottom, in one outline with one SET pill; the rest fill the columns
// in turn. A set never splits across columns or pages.

/** The sample photo a style's card shows, or null. */
function sampleSetPhotoEntry(styleNo, color) {
  return getSamplePhotoEntries(styleNo, color)[0] ?? null;
}

const SHOOT_PHOTO_COLS = 4;
const SHOOT_PHOTO_ROWS = 2;

/** The pages' HTML. `urls`: styleImageKey → photo URL ("" when there's none). */
function shootPhotoPagesHtml(shoot, rows, urls) {
  const perPage = SHOOT_PHOTO_COLS * SHOOT_PHOTO_ROWS;
  // The list's outfits, in order: a set (its pieces next to each other, two
  // or more of them) or one style, each with its number in the list.
  const items = [];
  rows.forEach((r, i) => {
    const entry = { row: r, no: i + 1 };
    const key = reportSetKey(r);
    const last = items[items.length - 1];
    if (key && last?.setKey === key) last.pieces.push(entry);
    else items.push({ setKey: key, pieces: [entry] });
  });

  // A set stands as it's worn: top (or jacket) over bottom (or skirt), each
  // keeping its number from the list.
  const pieceRank = ({ row }) => PHOTOCARD_PIECE_ORDER.indexOf(photocardPieceName(row.styleNo, row.color));
  items.forEach(item => item.pieces.sort((a, b) => pieceRank(a) - pieceRank(b) || a.no - b.no));

  // Placed column by column: a set starts at the top of a column.
  const pages = [];
  let page = null;
  let slot = perPage;
  items.forEach(item => {
    const isSet = item.pieces.length > 1;
    if (isSet && slot % SHOOT_PHOTO_ROWS) slot++;
    const need = isSet ? Math.min(item.pieces.length, perPage) : 1;
    if (slot + need > perPage) {
      page = [];
      pages.push(page);
      slot = 0;
    }
    page.push({ ...item, isSet, slot });
    slot += isSet ? Math.ceil(need / SHOOT_PHOTO_ROWS) * SHOOT_PHOTO_ROWS : 1;
  });

  const card = ({ row: r, no }) => {
    const url = urls.get(styleImageKey(r.styleNo, r.color));
    const sample = getSampleStatusLabel(r.sampleStatus);
    return `<div class="sp-card">
      <div class="sp-photo">${url ? `<img src="${url}" alt="">` : `<div class="sp-missing">No sample photo</div>`}</div>
      <div class="sp-label">
        <div class="sp-line"><span class="sp-no">#${no}</span><span class="sp-style">${escapeReportHtml(r.styleNo)}</span><span class="sp-sample${sample ? "" : " is-none"}">${escapeReportHtml(sample || "No sample")}</span></div>
        <div class="sp-color">${escapeReportHtml(r.color)}</div>
      </div>
    </div>`;
  };
  const title = `${escapeReportHtml(getPhotoshootTitle(shoot))}${shoot.date ? ` · ${escapeReportHtml(formatReportDate(shoot.date))}` : ""}`;
  return pages.map((items, p) => `<section class="sp-page">
      <div class="sp-head"><span><b>Photoshoot</b> ${title}</span><span>Photos ${p + 1} / ${pages.length}</span></div>
      <div class="sp-grid">${items.map(item => {
        const col = Math.floor(item.slot / SHOOT_PHOTO_ROWS) + 1;
        const row = (item.slot % SHOOT_PHOTO_ROWS) + 1;
        if (!item.isSet) return `<div class="sp-cell" style="grid-column:${col};grid-row:${row}">${card(item.pieces[0])}</div>`;
        const span = Math.ceil(Math.min(item.pieces.length, SHOOT_PHOTO_COLS * SHOOT_PHOTO_ROWS) / SHOOT_PHOTO_ROWS);
        return `<div class="sp-cell sp-set" style="grid-column:${col} / span ${span};grid-row:1 / span ${SHOOT_PHOTO_ROWS};grid-template-columns:repeat(${span}, 1fr)">
          <span class="sp-set-pill">SET</span>${item.pieces.map(card).join("")}</div>`;
      }).join("")}</div>
    </section>`).join("");
}

/** Letter landscape with 0.5in margins: a 10in × 7.5in page to fill. */
const SHOOT_PHOTO_PAGE_CSS = `
  .sp-page { break-before: page; page-break-before: always; height: 7.45in; display: flex; flex-direction: column; }
  .sp-head { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 5px; margin-bottom: 14px; border-bottom: 1.5px solid #1a1a18; font-size: 10px; color: #8b929c; }
  .sp-head b { color: #1a1a18; margin-right: 4px; }
  .sp-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(${SHOOT_PHOTO_COLS}, 1fr); grid-template-rows: repeat(${SHOOT_PHOTO_ROWS}, 1fr); gap: 0.16in 0.16in; }
  .sp-cell { min-width: 0; min-height: 0; display: flex; }
  /* A set: its pieces top over bottom, in one magenta outline, one SET pill on it. */
  .sp-set { position: relative; display: grid; grid-auto-flow: column; grid-template-rows: repeat(${SHOOT_PHOTO_ROWS}, 1fr); gap: 0.16in 0.16in; outline: 1.5px solid #e6a1bf; outline-offset: 0.05in; border-radius: 2px; }
  .sp-set-pill { position: absolute; z-index: 1; top: -0.05in; left: 50%; transform: translate(-50%, -50%); padding: 1px 8px; border-radius: 9px; background: #fbe5ee; box-shadow: 0 0 0 2px #fff; color: #a3365f; font-size: 8.5px; font-weight: 700; letter-spacing: 0.08em; }
  .sp-card { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; border: 1px solid #d9dde2; border-radius: 5px; overflow: hidden; background: #fff; }
  .sp-photo { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: #fafafa; }
  .sp-photo img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .sp-missing { color: #9aa0a8; font-size: 10px; }
  .sp-label { flex: 0 0 auto; padding: 5px 8px 6px; border-top: 1px solid #e5e7eb; }
  .sp-line { display: flex; align-items: center; gap: 6px; }
  .sp-no { color: #8b929c; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .sp-style { font-size: 12px; font-weight: 700; letter-spacing: 0.02em; }
  .sp-sample { margin-left: auto; padding: 1px 6px; border-radius: 5px; background: #eef0f3; color: #4b5563; font-size: 9px; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }
  .sp-sample.is-none { background: none; color: #9aa0a8; font-weight: 500; }
  .sp-color { margin-top: 1px; color: #6b7280; font-size: 9.5px; letter-spacing: 0.06em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

// ── Photocards ───────────────────────────────────────────────────────────────
//
// Cards for a shoot's sets, to print and cut: 3.5" × 5", four to a portrait
// letter page. The front is the piece's photo #4; the back is the logo with
// the set's pieces under it ("TOP: T6469ST", "BOTTOM: P6468ST"). Each piece
// gets two cards. Pages go front, back, front, back… — printed double-sided
// (flip on long edge), each back lands behind its own front.

const PHOTOCARD_PHOTO_NUM = 4;
const PHOTOCARD_COPIES = 2;
/** Piece names, in the order they're listed on the back. */
const PHOTOCARD_PIECE_ORDER = ["TOP", "JACKET", "VEST", "DRESS", "BOTTOM", "SKIRT"];

/** What a set piece is called on a card, from its category ("WOVEN TROUSERS" → BOTTOM). */
function photocardPieceName(styleNo, color) {
  const style = findStyle(styleNo, color);
  const text = `${style?.category ?? ""} ${style?.description ?? ""}`.toUpperCase();
  const category = String(style?.category ?? "").toUpperCase();
  const test = s => /\b(SKIRT|SKORT)/.test(s) ? "SKIRT"
    : /\b(TROUSER|PANT|SHORT|JEAN|LEGGING|JOGGER|BOTTOM)/.test(s) ? "BOTTOM"
    : /\b(JACKET|BLAZER|COAT)/.test(s) ? "JACKET"
    : /\bVEST/.test(s) ? "VEST"
    : /\bDRESS/.test(s) ? "DRESS"
    : /\b(TOP|BLOUSE|SHIRT|PULL ?OVER|SWEATER|CARDIGAN|TEE|CAMI|TANK)/.test(s) ? "TOP"
    : "";
  // The category says it best; the description when there's none.
  return test(category) || test(text) || "TOP";
}

/** A piece's photo #4 (or, with no file numbered 4, its fourth photo), or null. */
function photocardPhotoEntry(styleNo, color) {
  const entries = getStyleImageEntries(styleNo, color);
  return entries.find(e => e.num === PHOTOCARD_PHOTO_NUM) ?? entries[PHOTOCARD_PHOTO_NUM - 1] ?? null;
}

/**
 * A photo, sized for a card at 300 dpi, as a JPEG object URL ("" if it can't
 * be read). `readFile` is the folder it's in: model photos, or sample photos.
 */
async function loadPhotocardImage(entry, readFile = getStyleImageFile) {
  if (!entry) return "";
  try {
    const file = await readFile(entry);
    const bitmap = await createImageBitmap(file);
    // Just big enough to fit inside 1050 × 1500 px (3.5" × 5" at 300 dpi); never enlarged.
    const scale = Math.min(1, 1050 / bitmap.width, 1500 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.9));
    return blob ? URL.createObjectURL(blob) : "";
  } catch {
    return "";
  }
}

/**
 * The shoot's set pieces as cards: [{ styleNo, color, name, entry, back: [{ name, styleNo }] }],
 * set by set in shoot order, pieces in PHOTOCARD_PIECE_ORDER, each `copies`
 * times. `entryOf(styleNo, color)` picks the photo (model photo #4, or the sample).
 */
function buildPhotocards(shoot, { copies = PHOTOCARD_COPIES, entryOf = photocardPhotoEntry } = {}) {
  const cards = [];
  groupBySet(shoot.styles ?? []).forEach(block => {
    if (!styleSetKey(block[0].styleNo, block[0].color)) return; // not a set
    const color = block[0].color;
    const byOrder = (a, b) => PHOTOCARD_PIECE_ORDER.indexOf(a.name) - PHOTOCARD_PIECE_ORDER.indexOf(b.name) || a.styleNo.localeCompare(b.styleNo);
    // The back lists the whole set in this colour, even a piece not in the shoot.
    const back = withSetMates([block[0]])
      .map(s => ({ name: photocardPieceName(s.styleNo, s.color), styleNo: s.styleNo }))
      .sort(byOrder);
    block
      .map(s => ({ ...s, name: photocardPieceName(s.styleNo, s.color) }))
      .sort(byOrder)
      .forEach(piece => {
        const entry = entryOf(piece.styleNo, piece.color);
        for (let c = 0; c < copies; c++) cards.push({ styleNo: piece.styleNo, color, name: piece.name, entry, back });
      });
  });
  return cards;
}

/** Each card's photo, loaded once (4 at a time): styleImageKey → object URL ("" if unreadable). */
async function loadPhotocardImages(cards, readFile, what) {
  const urls = new Map();
  const todo = [...new Set(cards.filter(c => c.entry).map(c => styleImageKey(c.styleNo, c.color)))];
  const entryOf = new Map(cards.map(c => [styleImageKey(c.styleNo, c.color), c.entry]));
  showIndicator(`Preparing the ${what} (loading photos)…`);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const key = todo[next++];
      urls.set(key, await loadPhotocardImage(entryOf.get(key), readFile));
      done++;
      if (todo.length > 4) showIndicator(`Loading photos ${done} / ${todo.length}…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
  return urls;
}

const PHOTOCARD_CSS = `
  @page { size: letter portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 8.5in; }
  body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1a1a18; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { position: relative; width: 8.5in; height: 11in; overflow: hidden; break-after: page; page-break-after: always; }
  .sheet:last-child { break-after: auto; page-break-after: auto; }
  /* Cards sit edge to edge, 2 × 2, centred: one cut between them. */
  .card { position: absolute; width: 3.5in; height: 5in; overflow: hidden; }
  .card.c0 { left: 0.75in; } .card.c1 { left: 4.25in; }
  .card.r0 { top: 0.5in; } .card.r1 { top: 5.5in; }
  /* The whole photo, never cropped: a model photo (2:3) is a little narrower
     than the card (3.5 × 5), so it fills the height with thin white strips
     at the sides. */
  .card img.photo { display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; }
  .card .missing { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; background: #f3f4f6; color: #6b7280; font-size: 11pt; text-align: center; }
  .card .missing b { color: #1a1a18; font-size: 14pt; }
  .card.back { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0.3in; }
  .card.back img.logo { width: 2.3in; height: auto; margin-bottom: 0.32in; }
  .card.back .pieces { font-size: 13pt; line-height: 1.6; letter-spacing: 0.04em; }
  .card.back .pieces b { font-weight: 700; }
  .card.back .color { margin-top: 0.14in; font-size: 9.5pt; letter-spacing: 0.08em; color: #6b7280; }
  /* Crop marks in the margins, on the cut lines. */
  .mark { position: absolute; background: #9ca3af; }
  .mark.v { width: 0.5pt; height: 0.3in; }
  .mark.h { height: 0.5pt; width: 0.45in; }
`;

/** Crop marks for one sheet: at each cut line, in the margins. */
function photocardCropMarks() {
  const xs = [0.75, 4.25, 7.75];
  const ys = [0.5, 5.5, 10.5];
  const v = xs.flatMap(x => [0.1, 10.6].map(y => `<div class="mark v" style="left:${x}in;top:${y}in"></div>`));
  const h = ys.flatMap(y => [0.2, 7.85].map(x => `<div class="mark h" style="left:${x}in;top:${y}in"></div>`));
  return v.concat(h).join("");
}

async function exportShootPhotocards(id) {
  const shoot = getPhotoshootById(id);
  if (!shoot) return;
  if (styleImageState !== "ready" && styleImageState !== "scanning") {
    showIndicator("Link the model photo folder to print photocards", "error");
    return;
  }
  const cards = buildPhotocards(shoot);
  if (!cards.length) {
    showIndicator("No sets in this shoot", "error");
    return;
  }

  // Each piece's photo once, though it's on two cards.
  const urls = await loadPhotocardImages(cards, getStyleImageFile, "photocards");

  const logo = new URL("logo.svg", location.href).href;
  const place = (i, mirrored) => `c${mirrored ? 1 - (i % 2) : i % 2} r${Math.floor(i / 2)}`;
  const front = (card, i) => {
    const url = urls.get(styleImageKey(card.styleNo, card.color));
    return `<div class="card ${place(i, false)}">${url
      ? `<img class="photo" src="${url}" alt="">`
      : `<div class="missing"><b>${escapeReportHtml(card.styleNo)}</b>${escapeReportHtml(card.color)}<span>No photo #${PHOTOCARD_PHOTO_NUM}</span></div>`}</div>`;
  };
  // Backs are mirrored left to right, so after a long-edge flip each one is behind its front.
  const back = (card, i) => `<div class="card back ${place(i, true)}">
      <img class="logo" src="${logo}" alt="${escapeReportHtml(APP_NAME)}">
      <div class="pieces">${card.back.map(p => `<div><b>${escapeReportHtml(p.name)}:</b> ${escapeReportHtml(p.styleNo)}</div>`).join("")}</div>
      <div class="color">${escapeReportHtml(card.color)}</div>
    </div>`;
  const sheets = [];
  for (let p = 0; p < cards.length; p += 4) {
    const page = cards.slice(p, p + 4);
    sheets.push(`<div class="sheet">${photocardCropMarks()}${page.map(front).join("")}</div>`);
    sheets.push(`<div class="sheet">${photocardCropMarks()}${page.map(back).join("")}</div>`);
  }
  const fileTitle = `${shootFileBase(shoot)} Photocards`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeReportHtml(fileTitle)}</title><style>${PHOTOCARD_CSS}</style></head><body>${sheets.join("")}</body></html>`;

  const missing = new Set(cards.filter(c => !urls.get(styleImageKey(c.styleNo, c.color))).map(c => `${c.styleNo} ${c.color}`));
  await printHtml(html, fileTitle);
  if (missing.size) showIndicator(`No photo #${PHOTOCARD_PHOTO_NUM} for ${[...missing].join(", ")}`, "error");
  setTimeout(() => urls.forEach(url => url && URL.revokeObjectURL(url)), 60 * 1000);
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
        label: "PO #",
        cell: r => ({
          html: r.pos.map(po => po.statuses.size === 1 && po.statuses.has("Closed") ? `<s>${escapeReportHtml(po.poNo)}</s>` : escapeReportHtml(po.poNo)).join("<br>"),
          className: "nowrap",
        }),
      },
      cols.type, cols.availableIhd,
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
  // PDF report (the shoot's order), or By Available / By Sample / By Style.
  document.querySelectorAll("[data-shoot-pdf-order]").forEach(btn => btn.addEventListener("click", () => {
    closeShootPaneMenu();
    if (paneShootId) exportShootPdf(paneShootId, btn.dataset.shootPdfOrder);
  }));
  document.getElementById("shootMenuPhotocards")?.addEventListener("click", () => {
    closeShootPaneMenu();
    if (paneShootId) exportShootPhotocards(paneShootId);
  });
}
