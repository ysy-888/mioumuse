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
 *   Need to Shoot   the list as it's showing (filters and search applied)
 *   a photoshoot    its details and every style in it
 *   header menu     Export CSV follows the page you're on
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
  td.strong { font-weight: 700; white-space: nowrap; }
  td.nowrap { white-space: nowrap; }
  td.check { width: 34px; text-align: center; font-size: 15px; color: #8b929c; }
  .warn { color: #c81e1e; font-weight: 700; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 9px; background: #eef0f3; font-size: 9.5px; font-weight: 600; white-space: nowrap; }
  .pill.needed { background: #fdf0d5; color: #8a5a00; }
  .pill.scheduled { background: #e1ecfb; color: #1f56a5; }
  .pill.shot { background: #e1f5ee; color: #0f6e56; }
  footer { margin-top: 10px; color: #8b929c; font-size: 9.5px; }
`;

function escapeReportHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Lay out a report and open the print window for it.
 *
 * columns: [{ label, cell(row) → { text, html?, className? } }]
 * rows:    whatever `cell` reads; each needs styleNo / color for its photo
 */
async function printReport({ fileTitle, title, subtitle = "", meta = [], notes = "", columns, rows, photos, footnote = "" }) {
  if (!rows.length) {
    showIndicator("Nothing to export", "error");
    return;
  }
  showIndicator(photos ? "Preparing the report (loading photos)…" : "Preparing the report…");

  // Photos come from the linked image folder, as small thumbnails.
  const thumbs = photos
    ? await Promise.all(rows.map(r => getStyleImageEntries(r.styleNo, r.color).length
        ? getStyleThumbUrl(r.styleNo, r.color).catch(() => "")
        : ""))
    : [];

  const head = (photos ? "<th></th>" : "") + columns.map(c => `<th>${escapeReportHtml(c.label)}</th>`).join("");
  const body = rows.map((row, i) => {
    const photo = photos
      ? `<td class="photo">${thumbs[i] ? `<img src="${thumbs[i]}" alt="">` : '<div class="none"></div>'}</td>`
      : "";
    const cells = columns.map(c => {
      const cell = c.cell(row);
      return `<td class="${cell.className ?? ""}">${cell.html ?? escapeReportHtml(cell.text)}</td>`;
    }).join("");
    return `<tr>${photo}${cells}</tr>`;
  }).join("");

  const generated = `${formatReportDate(todayYmd())} ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeReportHtml(fileTitle)}</title><style>${REPORT_CSS}</style></head><body>
    <header>
      <div><div class="brand">${escapeReportHtml(APP_NAME)}</div><h1>${escapeReportHtml(title)}</h1>${subtitle ? `<div class="sub">${escapeReportHtml(subtitle)}</div>` : ""}</div>
      <div class="generated">Generated ${escapeReportHtml(generated)}<br>${rows.length} ${rows.length === 1 ? "style" : "styles"}</div>
    </header>
    ${meta.length ? `<div class="meta">${meta.map(([k, v]) => `<div><b>${escapeReportHtml(k)}</b><span>${escapeReportHtml(v)}</span></div>`).join("")}</div>` : ""}
    ${notes ? `<div class="notes">${escapeReportHtml(notes)}</div>` : ""}
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
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

/** The shoot status badge's wording, with report dates. */
function reportStatusLabel(status) {
  const shoot = status.shoots[0];
  if (status.tone === "needed" || !shoot) return status.label;
  const date = shoot.date ? formatReportDate(shoot.date) : "No date";
  if (status.tone === "shot") return `Shot · ${date}`;
  return `Scheduled · ${date}${status.shoots.length > 1 ? ` +${status.shoots.length - 1}` : ""}`;
}

/** Photos in reports only when the folder is linked and readable. */
function reportHasPhotos() {
  return typeof styleImageState !== "undefined" && (styleImageState === "ready" || styleImageState === "scanning");
}

// ── Shared style fields ──────────────────────────────────────────────────────

function styleExportFields(styleNo, color) {
  const style = findStyle(styleNo, color);
  return {
    styleNo,
    color,
    description: style?.description ?? "",
    category: style?.category ?? "",
    season: style?.season ?? "",
    n41: style?.status ?? "",
    ihd: style?.ihd ?? "",
  };
}

function shootStatusText(styleNo, color) {
  return describeShootStatus(styleNo, color)?.label ?? "";
}

// ── Need to Shoot ────────────────────────────────────────────────────────────

/** The rows the Need to Shoot table is showing right now. */
function getNeedExportRows() {
  renderNeedTable(); // brings filteredNeedRows up to date
  return filteredNeedRows.map(r => {
    const status = describeShootStatus(r.styleNo, r.color);
    const next = status?.tone === "scheduled" ? status.shoots[0] : null;
    return {
      ...styleExportFields(r.styleNo, r.color),
      status,
      shoot: next,
      ihdLate: next ? isIhdAfterShoot(r.styleNo, r.color, next.date) : false,
      addedAt: r.addedAt,
    };
  });
}

function describeNeedFilters() {
  const parts = [{ all: "All", unscheduled: "Not scheduled", scheduled: "Scheduled" }[needFilter] ?? "All"];
  if (needShowShot) parts.push("including shot");
  const q = (document.getElementById("needSearchInput")?.value ?? "").trim();
  if (q) parts.push(`search "${q}"`);
  if (isColumnFilterActive("needTable", "ihd")) {
    const months = monthFilterOptions(filteredNeedRows.map(r => findStyle(r.styleNo, r.color)?.ihd ?? "")).map(o => o.label);
    parts.push(`IHD: ${months.join(", ")}`);
  }
  return parts.join(" · ");
}

function exportNeedCsv() {
  const rows = getNeedExportRows();
  if (!rows.length) {
    showIndicator("Nothing to export", "error");
    return;
  }
  downloadCsv(`Need to Shoot ${todayYmd()}`,
    ["Style #", "Color", "Description", "Category", "Season", "N41 Status", "IHD", "Shoot Status", "Shoot Date", "Shoot", "Shoot Type", "Model", "IHD After Shoot", "Added"],
    rows.map(r => [
      r.styleNo, r.color, r.description, r.category, r.season, r.n41, r.ihd,
      r.status?.label ?? "",
      r.shoot?.date ?? "",
      r.shoot ? getPhotoshootTitle(r.shoot) : "",
      r.shoot ? getPhotoshootTypeLabel(r.shoot.type) : "",
      r.shoot?.model ?? "",
      r.ihdLate ? "Yes" : "",
      r.addedAt ? r.addedAt.slice(0, 10) : "",
    ]));
  showIndicator(`Exported ${rows.length} ${rows.length === 1 ? "style" : "styles"}`, "success");
}

function exportNeedPdf() {
  // Earliest IHD first, styles with no IHD last; ties keep the list's order.
  const rows = getNeedExportRows().sort((a, b) => (a.ihd || "9999").localeCompare(b.ihd || "9999"));
  const scheduled = rows.filter(r => r.status?.tone === "scheduled").length;
  const late = rows.filter(r => r.ihdLate).length;
  printReport({
    fileTitle: `Need to Shoot ${todayYmd()}`,
    title: "Need to Shoot",
    subtitle: describeNeedFilters(),
    meta: [
      ["Styles", String(rows.length)],
      ["Not scheduled", String(rows.filter(r => r.status?.tone === "needed").length)],
      ["Scheduled", String(scheduled)],
      ["IHD after shoot", String(late)],
    ],
    photos: reportHasPhotos(),
    rows,
    columns: [
      { label: "Style #", cell: r => ({ text: r.styleNo, className: "strong" }) },
      { label: "Color", cell: r => ({ text: r.color, className: "nowrap" }) },
      { label: "Description", cell: r => ({ text: r.description }) },
      { label: "Category", cell: r => ({ text: r.category }) },
      { label: "Season", cell: r => ({ text: r.season }) },
      { label: "IHD", cell: r => ({ html: r.ihd ? `<span class="${r.ihdLate ? "warn" : ""}">${escapeReportHtml(formatReportDate(r.ihd))}</span>` : "", className: "nowrap" }) },
      { label: "Shoot", cell: r => ({ html: r.status ? `<span class="pill ${r.status.tone}">${escapeReportHtml(reportStatusLabel(r.status))}</span>${r.shoot ? `<br>${escapeReportHtml(getPhotoshootTitle(r.shoot))}` : ""}` : "", className: "nowrap" }) },
    ],
    footnote: late ? "Red IHD: the goods arrive in-house after the scheduled shoot date." : "",
  });
}

// ── One photoshoot ───────────────────────────────────────────────────────────

function getShootExportRows(shoot) {
  return shoot.styles.map(s => ({
    ...styleExportFields(s.styleNo, s.color),
    ihdLate: shoot.status === "planned" && isIhdAfterShoot(s.styleNo, s.color, shoot.date),
  }));
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
    ["Shoot", "Shoot Date", "Type", "Model", "Status", "Style #", "Color", "Description", "Category", "Season", "N41 Status", "IHD", "IHD After Shoot"],
    rows.map(r => [
      getPhotoshootTitle(shoot), shoot.date, getPhotoshootTypeLabel(shoot.type), shoot.model,
      shoot.status === "complete" ? "Complete" : "Planned",
      r.styleNo, r.color, r.description, r.category, r.season, r.n41, r.ihd,
      r.ihdLate ? "Yes" : "",
    ]));
  showIndicator(`Exported ${rows.length} ${rows.length === 1 ? "style" : "styles"}`, "success");
}

function exportShootPdf(id) {
  const shoot = getPhotoshootById(id);
  if (!shoot) return;
  const rows = getShootExportRows(shoot);
  const late = rows.filter(r => r.ihdLate).length;
  printReport({
    fileTitle: shootFileBase(shoot),
    title: getPhotoshootTitle(shoot),
    subtitle: `${getPhotoshootTypeLabel(shoot.type)} shoot · ${shoot.date ? formatReportDate(shoot.date) : "No date"}`,
    meta: [
      ["Date", shoot.date ? formatReportDate(shoot.date) : "No date"],
      ["Type", getPhotoshootTypeLabel(shoot.type)],
      ["Model", shoot.model || "—"],
      ["Status", shoot.status === "complete" ? "Complete" : "Planned"],
    ],
    notes: shoot.notes,
    photos: reportHasPhotos(),
    rows,
    columns: [
      { label: "Shot", cell: () => ({ text: "☐", className: "check" }) },
      { label: "Style #", cell: r => ({ text: r.styleNo, className: "strong" }) },
      { label: "Color", cell: r => ({ text: r.color, className: "nowrap" }) },
      { label: "Description", cell: r => ({ text: r.description }) },
      { label: "Category", cell: r => ({ text: r.category }) },
      { label: "Season", cell: r => ({ text: r.season }) },
      { label: "IHD", cell: r => ({ html: r.ihd ? `<span class="${r.ihdLate ? "warn" : ""}">${escapeReportHtml(formatReportDate(r.ihd))}${r.ihdLate ? " — after shoot" : ""}</span>` : "", className: "nowrap" }) },
    ],
    footnote: late ? `${late} ${late === 1 ? "style arrives" : "styles arrive"} in-house after the shoot date.` : "",
  });
}

/** Every shoot and its styles — one row per style. */
function exportShootsListCsv() {
  const shoots = [...getAllPhotoshoots()].sort((a, b) => a.date.localeCompare(b.date));
  if (!shoots.length) {
    showIndicator("Nothing to export", "error");
    return;
  }
  const rows = [];
  shoots.forEach(shoot => {
    const styles = getShootExportRows(shoot);
    (styles.length ? styles : [null]).forEach(r => rows.push([
      getPhotoshootTitle(shoot), shoot.date, getPhotoshootTypeLabel(shoot.type), shoot.model,
      shoot.status === "complete" ? "Complete" : "Planned",
      r?.styleNo ?? "", r?.color ?? "", r?.description ?? "", r?.category ?? "", r?.season ?? "", r?.n41 ?? "", r?.ihd ?? "",
      r?.ihdLate ? "Yes" : "",
    ]));
  });
  downloadCsv(`Photoshoots ${todayYmd()}`,
    ["Shoot", "Shoot Date", "Type", "Model", "Status", "Style #", "Color", "Description", "Category", "Season", "N41 Status", "IHD", "IHD After Shoot"],
    rows);
  showIndicator(`Exported ${shoots.length} ${shoots.length === 1 ? "shoot" : "shoots"}`, "success");
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

function exportBannersCsv() {
  const banners = filteredBanners.length ? filteredBanners : getAllBanners();
  if (!banners.length) {
    showIndicator("Nothing to export", "error");
    return;
  }
  const rows = [];
  banners.forEach(b => {
    (b.styles.length ? b.styles : [null]).forEach(s => {
      const style = s ? findStyle(s.styleNo, s.color) : null;
      rows.push([b.name, getBannerTypeLabel(b.type), b.platforms.map(getPlatformLabel).join(", "), formatBannerSize(b),
        s?.styleNo ?? "", s?.color ?? "", style?.description ?? "", style?.status ?? "", getBannerImageUrl(b)]);
    });
  });
  downloadCsv(`Banners ${todayYmd()}`,
    ["Banner", "Type", "Platforms", "Size", "Style #", "Color", "Description", "N41 Status", "Image URL"], rows);
  showIndicator(`Exported ${banners.length} banners`, "success");
}

/** Header menu → Export CSV: whatever the current page is about. */
function exportCurrentViewCsv() {
  switch (getCurrentAppView()) {
    case "photoshoots":
      if (photoshootSubview === "need") return exportNeedCsv();
      if (paneShootId) return exportShootCsv(paneShootId);
      return exportShootsListCsv();
    case "styles": return exportStylesCsv();
    case "platforms": return exportBannersCsv();
    case "magento": return exportMagentoCsv(); // js/magento.js
    default: return exportScheduleCsv();
  }
}

// ── Menus ────────────────────────────────────────────────────────────────────

/** A small dropdown: a button that opens a list of actions. */
function initExportMenu(buttonId, menuId, actions) {
  const btn = document.getElementById(buttonId);
  const menu = document.getElementById(menuId);
  if (!btn || !menu) return;
  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", e => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  Object.entries(actions).forEach(([id, run]) => {
    document.getElementById(id)?.addEventListener("click", () => {
      close();
      run();
    });
  });
  document.addEventListener("click", e => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") close();
  });
}

function initExports() {
  initExportMenu("needExportBtn", "needExportMenu", {
    needExportCsv: exportNeedCsv,
    needExportPdf: exportNeedPdf,
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
