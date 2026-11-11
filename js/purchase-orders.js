/**
 * POs — N41's PO lines, a month at a time (view "pos").
 *
 * Menu → Import N41 POs reads N41's PO export (po.xls — see parseN41Pos):
 * Status, PO #, ETA, Style, Color. The POs in the file replace the saved
 * ones; every other PO is kept (js/store.js).
 *
 * Each line is worked out as New (the style's first PO), Recut (a colour
 * that was on an earlier PO of the style) or New Color (one that wasn't).
 *
 * How the dates fit together (js/store.js applyPoIhds):
 *   - A style colour's Available month (Style Master) is its tentative IHD.
 *   - A PO's ETA is 1/1 of a year until it's confirmed; confirmed, it should
 *     fall in the Available month. Closed means the PO was received.
 *   - The page files a line under its colour's Available month (its newest
 *     PO, or one still on 1/1); an older PO with a confirmed ETA stays in
 *     that ETA's month.
 *   - Flagged: a confirmed ETA outside the Available month; a Closed PO
 *     whose ETA is still 1/1 or still in the future.
 * A style + colour on a PO takes its IHD from the ETAs: the next one from
 * today, or the latest if all have passed.
 *
 * Each style shows with its POs, and under it the colours on them, with
 * photos and the New Style / New Color / Reshoot picker. Only colours with
 * no photos are suggested: New Style on a new style, New Color otherwise.
 */

let poMonth = "";
let poTypeFilter = "all"; // "all" | "new" | "recut" | "newColor"
let poPhotoFilter = "all"; // "all" | "with" | "without" — needs the image folder
// With "without": also list styles where another colour already has photos.
let poSameStyle = false;
let poSuggestedOnly = false; // just the colours Add suggested would add
let poNeedOnly = false; // just the colours waiting on Need to Shoot (not yet shot)
let poShowCompany = false; // colours with N41 status COMPANY are hidden unless ticked
let poShowDeleted = false; // list the deleted POs (every month) to restore them
let poSearchScope = "all"; // "all" months, or just this "month"

const PO_KIND_LABELS = { new: "New", recut: "Recut", newColor: "New Color" };

// The type pill's icon: New and New Color share the shoot icons (a T-shirt,
// a paint bucket); Recut is a pair of scissors.
const PO_RECUT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/></svg>';

function poKindIcon(kind) {
  if (kind === "recut") return PO_RECUT_ICON;
  return shootReasonIcon(kind === "new" ? "newStyle" : "newColor").replace(/width="15" height="15"/, 'width="11" height="11"');
}

/** Icon(s) and label inside a type pill (the page and the PDF). */
function poKindPillHtml(kind, label) {
  const icons = kind === "mixed" ? poKindIcon("recut") + poKindIcon("newColor") : poKindIcon(kind);
  return `<span class="po-line-icons">${icons}</span><span>${escapeHtml(label)}</span>`;
}

// ── Reading N41's PO export ──────────────────────────────────────────────────

/** An Excel date (a day number) or text like 5/31/2025 → "YYYY-MM-DD"; "" if neither. */
function poExcelDate(value) {
  if (typeof value === "number" && value > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})/);
  if (!m) return "";
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * An ETA typed with a wrong year (4021 for 2021) gets the year that puts it
 * nearest its PO date — the month and day are kept.
 */
function fixPoEta(eta, poDate) {
  if (!eta || !poDate) return eta;
  const etaYear = Number(eta.slice(0, 4));
  const poYear = Number(poDate.slice(0, 4));
  if (Math.abs(etaYear - poYear) <= 3) return eta;
  const poAt = poYear * 12 + Number(poDate.slice(5, 7));
  const month = Number(eta.slice(5, 7));
  const year = [poYear - 1, poYear, poYear + 1]
    .reduce((best, y) => Math.abs(y * 12 + month - poAt) < Math.abs(best * 12 + month - poAt) ? y : best);
  return `${year}${eta.slice(4)}`;
}

/**
 * N41's PO export (po.xls) — the only layout read. Headings in row 1, one
 * row per PO # + Style + Color:
 *
 *   A  dstatus  Open / Closed (Closed: received)
 *   B  pono     PO #
 *   D  eta      ETA — 1/1 of a year until the real date is set
 *   E  style    Style #
 *   F  color    Color
 *   po_date     PO date (found by heading) — orders the POs for New / Recut / New Color
 *   first_rcv_date  received date (found by heading) — the final ETA of a
 *               Closed PO whose ETA was never updated from 1/1
 *
 * Columns are found by heading, the letters above if a heading moves.
 */
function parseN41Pos(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: "A", raw: true, defval: "", blankrows: false });
  const head = rows.shift() ?? {};
  const find = (label, fallback) => Object.keys(head).find(k => String(head[k]).trim().toLowerCase() === label) ?? fallback;
  const cols = {
    status: find("dstatus", "A"), po: find("pono", "B"), eta: find("eta", "D"),
    style: find("style", "E"), color: find("color", "F"), poDate: find("po_date", ""),
    received: find("first_rcv_date", ""),
  };
  if (String(head[cols.po] ?? "").trim().toLowerCase() !== "pono") {
    throw new Error("That isn't N41's PO export — expected dstatus, pono, vendor, eta, style, color… as the headings in row 1.");
  }
  const seen = new Set();
  const lines = [];
  rows.forEach(r => {
    const cell = col => String(r[col] ?? "").trim();
    const rawPo = r[cols.po];
    const poNo = typeof rawPo === "number" ? String(Math.round(rawPo)) : cell(cols.po);
    const styleNo = cell(cols.style).toUpperCase();
    const color = cell(cols.color).toUpperCase().replace(/\s+/g, " ");
    if (!/^\d+$/.test(poNo) || !styleNo || !color) return;
    const key = `${poNo}|${styleNo}|${color}`;
    if (seen.has(key)) return;
    seen.add(key);
    const poDate = cols.poDate ? poExcelDate(r[cols.poDate]) : "";
    const status = cell(cols.status);
    lines.push({
      poNo, styleNo, color, poDate,
      eta: fixPoEta(poExcelDate(r[cols.eta]), poDate),
      status: /^closed$/i.test(status) ? "Closed" : /^open$/i.test(status) ? "Open" : status,
      received: cols.received ? poExcelDate(r[cols.received]) : "",
    });
  });
  return lines;
}

async function importN41Pos(file) {
  if (!file) return;
  try {
    showIndicator("Reading the N41 PO export…");
    await loadSheetJs();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const lines = parseN41Pos(workbook);
    if (!lines.length) throw new Error("No PO # / Style / Color columns with PO lines were found.");
    const pos = new Set(lines.map(l => l.poNo)).size;
    await mergePoLines(lines, (n, total) => showIndicator(`Saving POs… ${Math.round((n / total) * 100)}%`));
    if (!poMonth) poMonth = defaultPoMonth();
    refreshPoDependentViews();
    showIndicator(`N41 POs imported — ${pos.toLocaleString()} POs, ${lines.length.toLocaleString()} style colours`, "success");
  } catch (err) {
    showIndicator(`N41 POs: ${err.message || "couldn't read the file."}`, "error");
  }
}

/** The Styles database's colours for a PO's style: as written, or without a trailing ST. */
function getPoStyleColors(styleNo) {
  const colors = getStyleColors(styleNo);
  if (colors.length || !/ST$/.test(styleNo)) return colors;
  return getStyleColors(styleNo.slice(0, -2));
}

/**
 * IHDs come from the ETAs, worked out in memory (applyPoIhds, js/store.js).
 * An ETA that has passed stops counting the next day, so they're worked out
 * again when a new day starts.
 */
let poIhdsCheckedOn = "";

function refreshPoIhds() {
  if (poIhdsCheckedOn === todayYmd()) return;
  const first = !poIhdsCheckedOn;
  poIhdsCheckedOn = todayYmd();
  if (first || !getAllPoLines().length) return; // just loaded: already worked out
  applyPoIhds();
  refreshPoDependentViews();
}

/** IHDs show on Styles, Need to Shoot and the shoot pane as well as here. */
function refreshPoDependentViews() {
  if (getCurrentAppView() === "pos") renderPoView();
  if (getCurrentAppView() === "styles" && typeof applyStyleFilters === "function") applyStyleFilters({ keepShown: true });
  refreshPhotoshootViews();
  if (typeof refreshStylePane === "function") refreshStylePane();
}

// ── The page ─────────────────────────────────────────────────────────────────

function getPoMonths() {
  return [...new Set(getAllPoLines().map(l => l.month).filter(Boolean))].sort();
}

/** This month if it's there, else the nearest one after it, else the last — archived ones only if that's all there is. */
function defaultPoMonth() {
  const all = getPoMonths();
  const archived = getPoMonthPhotoStats().archived;
  const live = all.filter(m => !archived.has(m));
  const months = live.length ? live : all;
  const now = todayYmd().slice(0, 7);
  return months.find(m => m >= now) ?? months[months.length - 1] ?? "";
}

function formatPoMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

// ── Month list ───────────────────────────────────────────────────────────────
//
// Down the left of the page, oldest first, in a folder per year that opens
// and closes. Each month's count is its styles with a colour still without
// model photos (COMPANY, CANCEL and INACTIVE colours, and Style #s with a
// company name after a hyphen, don't need them — poColorSkipsPhotos). A month where
// every colour has them is archived on its own: it moves to the Archived
// group at the bottom (folded away unless open, with year folders of its
// own) and comes back if a colour loses its photos or a new one is added.
// Without the image folder linked, photos aren't known: the count is all of
// the month's styles and nothing is archived.

let poShowArchived = false;
/** Open year folders, as "live:2026" / "archived:2026". */
const poOpenYears = new Set();
/** The month whose year was last opened for it — a newly shown month opens its year once. */
let poYearOpenedFor = "";

const PO_FOLDER_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const PO_FOLDER_OPEN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 7v10a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L21.5 12a1 1 0 0 0-1-1.3H7.3a2 2 0 0 0-1.9 1.4L3 19"/></svg>';

/**
 * Per month: `styles` (every Style #), `missing` (Style #s with a colour
 * still needing model photos), `missingColors`, and the `archived` months —
 * every colour photographed. Worked out from the PO lines and the Styles
 * database each time the list draws.
 */
function getPoMonthPhotoStats() {
  const known = arePhotosKnown();
  const byMonth = new Map();
  // Style # → colour → its Styles record, so each line is one lookup.
  const colorMaps = new Map();
  const dbColor = (styleNo, color) => {
    if (!colorMaps.has(styleNo)) colorMaps.set(styleNo, new Map(getPoStyleColors(styleNo).map(s => [s.color.trim().toUpperCase(), s])));
    return colorMaps.get(styleNo).get(color);
  };
  getAllPoLines().forEach(l => {
    if (!l.month) return;
    if (!byMonth.has(l.month)) byMonth.set(l.month, { styles: new Set(), missing: new Set(), missingColors: new Set() });
    const m = byMonth.get(l.month);
    m.styles.add(l.styleNo);
    const style = dbColor(l.styleNo, l.color);
    // Not in the Styles database: its photos can't be checked, so it doesn't hold the month open.
    if (!known || !style || poColorSkipsPhotos(style) || hasCompanySuffix(l.styleNo)) return;
    if (!hasStyleImages(style.styleNo, style.color)) {
      m.missing.add(l.styleNo);
      m.missingColors.add(`${l.styleNo}\u0000${l.color}`);
    }
  });
  const archived = new Set();
  if (known) byMonth.forEach((m, month) => { if (!m.missing.size) archived.add(month); });
  return { byMonth, archived, known };
}

function createPoMonthItem(month, stats, archived, known) {
  const item = document.createElement("div");
  item.className = "po-month" + (month === poMonth ? " is-active" : "") + (archived ? " is-archived" : "");

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "po-month-pick";
  pick.setAttribute("aria-current", String(month === poMonth));
  const name = document.createElement("span");
  name.className = "po-month-name";
  // The year is on the folder it sits in.
  name.textContent = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleString(undefined, { month: "long" });
  name.title = formatPoMonth(month);
  const count = document.createElement("span");
  count.className = "po-month-count";
  const total = stats?.styles.size ?? 0;
  if (!known) {
    count.textContent = total.toLocaleString();
    count.title = `${total.toLocaleString()} ${total === 1 ? "style" : "styles"} — link the image folder (Styles → menu ⋮) to count the ones without model photos`;
  } else if (archived) {
    count.textContent = "✓";
    count.title = "Every colour has model photos (COMPANY, CANCEL, INACTIVE and company styles skipped) — archived";
  } else {
    const n = stats.missing.size;
    const colors = stats.missingColors.size;
    count.textContent = n.toLocaleString();
    count.title = `${n.toLocaleString()} of ${total.toLocaleString()} ${total === 1 ? "style" : "styles"} without model photos (${colors.toLocaleString()} ${colors === 1 ? "colour" : "colours"}; COMPANY, CANCEL, INACTIVE and company styles skipped)`;
  }
  pick.append(name, count);
  pick.addEventListener("click", () => {
    poMonth = month;
    renderPoView();
  });

  item.append(pick);
  return item;
}

function renderPoMonthList() {
  const list = document.getElementById("poMonthList");
  if (!list) return;
  const { byMonth, archived: archivedSet, known } = getPoMonthPhotoStats();
  const months = getPoMonths();
  if (!months.length) {
    const empty = document.createElement("div");
    empty.className = "po-months-empty";
    empty.textContent = "No months yet";
    list.replaceChildren(empty);
    return;
  }
  const live = months.filter(m => !archivedSet.has(m));
  const archived = months.filter(m => archivedSet.has(m));
  // A month newly showing: open its year (and Archived, if it's there) once,
  // so it can be seen. Closing it again afterwards sticks.
  if (poMonth && poMonth !== poYearOpenedFor) {
    poYearOpenedFor = poMonth;
    poOpenYears.add(`${archivedSet.has(poMonth) ? "archived" : "live"}:${poMonth.slice(0, 4)}`);
    if (archivedSet.has(poMonth)) poShowArchived = true;
  }

  const yearFolders = (list, section) => {
    const byYear = new Map();
    list.forEach(m => {
      const y = m.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(m);
    });
    const out = [];
    byYear.forEach((ms, year) => {
      const key = `${section}:${year}`;
      const open = poOpenYears.has(key);
      const head = document.createElement("button");
      head.type = "button";
      head.className = "po-year" + (ms.includes(poMonth) ? " has-active" : "");
      head.setAttribute("aria-expanded", String(open));
      head.innerHTML = `<span class="po-year-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>${open ? PO_FOLDER_OPEN_ICON : PO_FOLDER_ICON}`;
      const label = document.createElement("span");
      label.className = "po-year-name";
      label.textContent = year;
      head.append(label);
      head.addEventListener("click", () => {
        if (poOpenYears.has(key)) poOpenYears.delete(key); else poOpenYears.add(key);
        renderPoMonthList();
      });
      out.push(head);
      if (open) out.push(...ms.map(m => createPoMonthItem(m, byMonth.get(m), section === "archived", known)));
    });
    return out;
  };

  const nodes = yearFolders(live, "live");
  if (archived.length) {
    const head = document.createElement("button");
    head.type = "button";
    head.className = "po-months-archived-toggle";
    head.setAttribute("aria-expanded", String(poShowArchived));
    head.textContent = `${poShowArchived ? "▾" : "▸"} Archived (${archived.length})`;
    head.addEventListener("click", () => {
      poShowArchived = !poShowArchived;
      renderPoMonthList();
    });
    nodes.push(head);
    if (poShowArchived) nodes.push(...yearFolders(archived, "archived"));
  }
  list.replaceChildren(...nodes);
  list.querySelector(".po-month.is-active")?.scrollIntoView({ block: "nearest" });
}

/**
 * Only a colour with no photos is suggested: New Style on the style's first
 * PO, New Color otherwise. Not one that's already waiting, never shot, or
 * CANCEL or INACTIVE in N41. Photos are only known with the image folder
 * linked, so without it nothing is suggested.
 */
function suggestPoReason(group, style) {
  if (!arePhotosKnown() || hasStyleImages(style.styleNo, style.color)) return "";
  if (isNoShootStyle(style.styleNo, style.color)) return "";
  if (poColorSkipsPhotos(style)) return "";
  const entry = getShootListEntry(style.styleNo, style.color);
  if (entry && !entry.shotShootId) return "";
  return poColorKind(group, style) === "new" ? "newStyle" : "newColor";
}

function isCompanyStyle(style) {
  return String(style.status ?? "").trim().toUpperCase() === "COMPANY";
}

/**
 * A Style # made for another company: a name after a hyphen
 * (MMP469-VESTIQUE, T5276-PINK BLUSH). A single letter or number after it
 * (MMT1290-1, MMDC1082-A) is a variant of our own style, not a company.
 */
function hasCompanySuffix(styleNo) {
  return /-.*[A-Z]{2}/i.test(String(styleNo ?? ""));
}

/**
 * Colours that are never photographed: N41 status COMPANY, CANCEL
 * (CANCELLED…) or INACTIVE, or a Style # with a company name after it.
 */
function poColorSkipsPhotos(style) {
  const status = String(style.status ?? "").trim().toUpperCase();
  return status === "COMPANY" || status.startsWith("CANCEL") || status === "INACTIVE" || hasCompanySuffix(style.styleNo);
}

/** A colour's kind in the month: from its first PO line in it. */
function poColorKind(group, style) {
  return group.kindByColor.get(style.color.trim().toUpperCase()) ?? "";
}

/**
 * The month's lines, one group per style, each with its POs (oldest first)
 * and the colours on them: the database's colours that are on one of the
 * POs (`missingColors` are on a PO but not in the database). `kindByColor`
 * is each colour's New / Recut / New Color in the month.
 */
function getPoMonthGroups() {
  return getPoGroups(getAllPoLines().filter(l => l.month === poMonth));
}

/** The same, for any set of lines — every month's, for a search across them all. */
function getPoGroups(lines) {
  const groups = new Map();
  [...lines].sort(comparePoLines).forEach(line => {
    if (!groups.has(line.styleNo)) groups.set(line.styleNo, { styleNo: line.styleNo, lines: [] });
    groups.get(line.styleNo).lines.push(line);
  });
  groups.forEach(g => {
    // One entry per PO, with its colours and kinds.
    const pos = new Map();
    g.kindByColor = new Map();
    g.lines.forEach(l => {
      if (!pos.has(l.poNo)) pos.set(l.poNo, { poNo: l.poNo, poDate: l.poDate, eta: l.etaFinal ?? l.eta, etaN41: l.eta, fromReceived: Boolean(l.etaFromReceived), colors: [], kinds: new Set(), statuses: new Set(), flagged: [] });
      const po = pos.get(l.poNo);
      po.colors.push(l.color);
      if (l.status) po.statuses.add(l.status);
      if (l.flags?.length) po.flagged.push(l);
      po.kinds.add(l.kind);
      if (!g.kindByColor.has(l.color)) g.kindByColor.set(l.color, l.kind);
    });
    g.pos = [...pos.values()];
    const all = getPoStyleColors(g.styleNo);
    const onPo = new Set(g.kindByColor.keys());
    g.colors = all.filter(s => onPo.has(s.color.trim().toUpperCase()));
    const known = new Set(all.map(s => s.color.trim().toUpperCase()));
    g.missingColors = [...onPo].filter(c => !known.has(c));
  });
  return groups;
}

/** Searching every month (the default) rather than just the one picked. */
function isPoSearchingAll() {
  return poSearchScope === "all" && Boolean((document.getElementById("poSearchInput")?.value ?? "").trim());
}

function buildPoGroups() {
  const q = (document.getElementById("poSearchInput")?.value ?? "").trim().toLowerCase();
  setActiveSearchQuery(q);
  const groups = poShowDeleted ? getPoGroups(getDeletedPoLines())
    : isPoSearchingAll() ? getPoGroups(getAllPoLines()) : getPoMonthGroups();
  // Photos: keep the colours that match; a style with none left goes.
  const photos = arePhotosKnown() ? poPhotoFilter : "all";
  const suggestedOnly = poSuggestedOnly && arePhotosKnown();
  groups.forEach(g => {
    // COMPANY colours, unless asked for. A style whose colours were all COMPANY goes.
    // A PO with only COMPANY colours goes with them.
    if (!poShowCompany && g.colors.length) {
      const company = new Set(g.colors.filter(isCompanyStyle).map(s => s.color.trim().toUpperCase()));
      g.colors = g.colors.filter(s => !isCompanyStyle(s));
      g.pos = g.pos.filter(po => po.colors.some(c => !company.has(c)));
      if (!g.colors.length) g.allCompany = true;
    }
    if (poTypeFilter !== "all") {
      g.colors = g.colors.filter(s => poColorKind(g, s) === poTypeFilter);
      g.pos = g.pos.filter(po => po.kinds.has(poTypeFilter));
    }
    // No photos: every colour without a model photo. Show same style keeps the
    // photographed colours too, for the styles that have one without.
    if (photos === "without" && poSameStyle) {
      if (!g.colors.some(s => !hasStyleImages(s.styleNo, s.color))) g.colors = [];
    } else if (photos !== "all") g.colors = g.colors.filter(s => hasStyleImages(s.styleNo, s.color) === (photos === "with"));
    if (suggestedOnly) g.colors = g.colors.filter(s => suggestPoReason(g, s));
    if (poNeedOnly) g.colors = g.colors.filter(s => { const e = getShootListEntry(s.styleNo, s.color); return e && !e.shotShootId; });
  });
  return [...groups.values()].filter(g => {
    if ((photos !== "all" || suggestedOnly || poNeedOnly) && !g.colors.length) return false;
    if (!g.pos.length || g.allCompany) return false;
    if (!q) return true;
    const text = [g.styleNo, ...g.pos.map(po => po.poNo),
      ...g.colors.map(s => `${s.color} ${s.description} ${s.status}`)].join(" ").toLowerCase();
    return text.includes(q);
  });
}

/**
 * A style's row: Style # and description across the whole table. Its PO
 * lines sit in one PO cell beside its colours (createPoLinesCell).
 */
function createPoGroupRow(group, cols) {
  const tr = document.createElement("tr");
  tr.className = "po-group-row";
  const td = document.createElement("td");
  td.colSpan = cols.length;
  const head = document.createElement("div");
  head.className = "po-group-head";
  const title = document.createElement("span");
  title.className = "po-group-style";
  mountSearchHighlightedText(title, group.styleNo);
  head.appendChild(title);
  const desc = getPoStyleColors(group.styleNo)[0]?.description;
  if (desc) {
    const d = document.createElement("span");
    d.className = "po-group-desc";
    d.textContent = desc;
    head.appendChild(d);
  }
  if (!getPoStyleColors(group.styleNo).length) {
    const none = document.createElement("span");
    none.className = "po-group-missing";
    none.textContent = "Not in the Styles database";
    head.appendChild(none);
  } else if (group.missingColors.length) {
    const none = document.createElement("span");
    none.className = "po-group-missing";
    none.textContent = `On the PO, not in the Styles database: ${group.missingColors.join(", ")}`;
    head.appendChild(none);
  }
  td.appendChild(head);
  tr.appendChild(td);
  return tr;
}

/**
 * One PO: its kind (New, Recut, New Color — or Recut + New Color when it
 * has both) and number. PO date, ETA and colours are in the tooltip.
 * `po`: { poNo, poDate, eta, colors, kinds } (getPoMonthGroups), or a line.
 */
function createPoLineChip(po) {
  const kinds = po.kinds ? [...po.kinds] : [po.kind];
  const kind = kinds.includes("new") ? "new" : kinds.length > 1 ? "mixed" : kinds[0];
  // Short enough to fit the pill; the tooltip says it in full.
  const label = kind === "mixed" ? "Recut + NC" : PO_KIND_LABELS[kind] ?? "";
  const chip = document.createElement("span");
  chip.className = "po-line";
  chip.dataset.kind = kind;
  chip.innerHTML = poKindPillHtml(kind, label);
  chip.title = `PO ${po.poNo} · ${kind === "mixed" ? "Recut + New Color" : label} · PO date ${po.poDate ? formatMdy(po.poDate) : EMPTY_DISPLAY} · ETA ${formatIhd(po.eta)}`;
  if (po.colors) chip.title += `\nColours: ${po.colors.join(", ")}`;
  return chip;
}

const PO_FLAG_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5z"/></svg>';

/** What each flag says (the rules are in js/store.js applyPoIhds). */
const PO_FLAG_TEXT = {
  notUpdated: po => po.fromReceived
    ? `Closed (received ${formatMdy(po.eta)}), but N41's ETA was never updated — still ${formatMdy(po.etaN41) || "blank"}. The received date is used as the ETA`
    : `Closed (received), but N41's ETA was never updated — still ${formatMdy(po.etaN41) || "blank"}`,
  closedFuture: po => `Closed (received), but the ETA ${formatMdy(po.eta)} hasn't come yet`,
};

/** A small amber flag by the ETA — hover for why, and which colours. */
function createPoEtaFlag(po) {
  const flag = document.createElement("span");
  flag.className = "po-eta-flag";
  flag.innerHTML = PO_FLAG_ICON;
  flag.title = Object.keys(PO_FLAG_TEXT).map(key => {
    const ls = po.flagged.filter(l => l.flags.includes(key));
    return ls.length ? `${PO_FLAG_TEXT[key](po, ls)}: ${ls.map(l => l.color).join(", ")}` : "";
  }).filter(Boolean).join("\n");
  flag.setAttribute("aria-label", flag.title);
  return flag;
}

/** Open / Closed, from N41's PO export (Partly closed when its colours differ). */
function createPoStatus(po) {
  const statuses = [...po.statuses];
  if (!statuses.length) return null;
  const text = statuses.length > 1 ? "Part closed" : statuses[0];
  const tag = document.createElement("span");
  tag.className = "po-status";
  tag.dataset.status = text.toLowerCase().replace(/\s+/g, "-");
  tag.textContent = text;
  tag.title = statuses.length > 1 ? "Some colours on this PO are closed (received), some open" : text === "Closed" ? "Closed — received" : `${text} — not received yet`;
  return tag;
}

const PO_TRASH_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';
const PO_RESTORE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';

/** Delete a flagged PO # + Style # from the POs page, or restore a deleted one (js/store.js). */
async function togglePoDeleted(po, styleNo, deleted) {
  const what = `PO # ${po.poNo} for ${styleNo}`;
  if (deleted && !confirm(`Delete ${what}?\n\nIt's hidden from the POs page and Need to Shoot's dates, and stays hidden when N41's POs are imported again. Restore it from "Show deleted POs".`)) return;
  try {
    await setPosDeleted([{ poNo: po.poNo, styleNo }], deleted);
    refreshPoDependentViews();
    showIndicator(`${what} ${deleted ? "deleted" : "restored"}`, "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't save.", "error");
  }
}

function createPoEntryAction(po, styleNo) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "po-entry-action" + (poShowDeleted ? " is-restore" : "");
  btn.innerHTML = poShowDeleted ? PO_RESTORE_ICON : PO_TRASH_ICON;
  btn.title = poShowDeleted ? `Restore PO # ${po.poNo}` : `Delete PO # ${po.poNo} for ${styleNo}`;
  btn.setAttribute("aria-label", btn.title);
  btn.addEventListener("click", e => {
    e.stopPropagation();
    togglePoDeleted(po, styleNo, !poShowDeleted);
  });
  return btn;
}

/**
 * One PO in the PO cell: its number, its IHD (the ETA), its status and kind
 * pill — and, on a flagged one, a delete button (restore, when showing deleted).
 */
function createPoEntry(po, styleNo) {
  const row = document.createElement("div");
  row.className = "po-entry";
  const no = document.createElement("span");
  no.className = "po-entry-no";
  no.append("PO # ");
  const num = document.createElement("span");
  mountSearchHighlightedText(num, po.poNo || EMPTY_DISPLAY);
  no.appendChild(num);
  const eta = document.createElement("span");
  eta.className = "po-entry-eta";
  eta.textContent = formatIhd(po.eta);
  eta.title = po.fromReceived ? "Received date (N41's ETA was never updated from 1/1)" : "IHD (the PO's ETA)";
  eta.classList.toggle("is-past", Boolean(po.eta) && po.eta < todayYmd());
  if (po.flagged?.length && !poShowDeleted) eta.appendChild(createPoEtaFlag(po));
  // An empty slot when there's no status, so the kind pills line up.
  const status = (po.statuses && createPoStatus(po)) || Object.assign(document.createElement("span"), { className: "po-status" });
  row.append(no, eta, status, createPoLineChip(po));
  if (styleNo && (poShowDeleted || po.flagged?.length)) row.appendChild(createPoEntryAction(po, styleNo));
  return row;
}

/** All of a style's POs, stacked, for the one PO cell beside its colours. */
function createPoLinesCell(group, rowSpan) {
  const td = document.createElement("td");
  td.dataset.col = "po";
  td.rowSpan = rowSpan;
  const list = document.createElement("div");
  list.className = "po-lines";
  list.append(...group.pos.map(po => createPoEntry(po, group.styleNo)));
  td.appendChild(list);
  return td;
}

/** A style with no colours in the Styles database: its POs, and nothing else. */
function createPoLinesOnlyRow(group, cols) {
  const tr = document.createElement("tr");
  tr.className = "po-line-row";
  tr.appendChild(createPoLinesCell(group, 1));
  const rest = document.createElement("td");
  rest.colSpan = cols.length - 1;
  tr.appendChild(rest);
  return tr;
}

/** `first`: the style's first colour row, which carries the PO cell for all of them. */
function createPoColorRow(group, style, cols, first) {
  const tr = document.createElement("tr");
  tr.className = "clickable-row po-color-row";
  tr.dataset.styleNo = style.styleNo;
  tr.dataset.color = style.color;
  cols.forEach(col => {
    if (col === "po") {
      if (first) tr.appendChild(createPoLinesCell(group, group.colors.length));
      return;
    }
    const td = document.createElement("td");
    td.dataset.col = col;
    if (col === "image") td.appendChild(createStyleThumb(style.styleNo, style.color));
    else if (col === "color") mountSearchHighlightedText(td, style.color);
    else if (col === "status") td.appendChild(createStyleStatusPill(style.status));
    else if (col === "available") { const pill = createAvailablePill(style.availableDate, style); if (pill) td.appendChild(pill); else setDisplayText(td, EMPTY_DISPLAY); }
    else if (col === "ihd") setDisplayText(td, formatIhd(style.ihd));
    else if (col === "shoot") td.appendChild(createStyleShootCell(style, { suggested: suggestPoReason(group, style) }));
    else if (col === "notes") td.appendChild(createStyleNotesInput(style, { onSaved: refreshStylePaneSummary }));
    tr.appendChild(td);
  });
  return tr;
}

function renderPoView() {
  const months = getPoMonths();
  if (!months.includes(poMonth)) poMonth = defaultPoMonth();
  renderPoMonthList();
  document.querySelectorAll("#poTypeFilters .filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === poTypeFilter);
  });
  // Photo counts come from the linked image folder; without it there's nothing to filter on.
  const photosKnown = arePhotosKnown();
  document.querySelectorAll("#poPhotoFilters .filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.photos === (photosKnown ? poPhotoFilter : "all"));
    btn.disabled = !photosKnown && btn.dataset.photos !== "all";
    btn.title = btn.getAttribute("aria-label") + (btn.disabled ? " — link the image folder (Styles → menu ⋮) to filter by photos" : "");
  });
  const sameStyle = document.getElementById("poSameStyleCheck");
  if (sameStyle) sameStyle.hidden = !(photosKnown && poPhotoFilter === "without");
  const sameStyleBox = document.getElementById("poSameStyle");
  if (sameStyleBox) sameStyleBox.checked = poSameStyle;
  const suggested = document.getElementById("poSuggestedBtn");
  if (suggested) {
    suggested.classList.toggle("active", photosKnown && poSuggestedOnly);
    suggested.disabled = !photosKnown;
    suggested.title = photosKnown ? "Show only the colours Add suggested would add" : "Suggestions need the image folder linked (Styles → menu ⋮)";
  }
  document.getElementById("poNeedBtn")?.classList.toggle("active", poNeedOnly);
  const add = document.getElementById("poAddSuggestedBtn");
  // Adding is the next step after checking the list, so it shows with Suggested.
  if (add) add.hidden = !(photosKnown && poSuggestedOnly);
  renderPoNotice();

  const tbody = document.getElementById("poTableBody");
  if (!tbody) return;
  const cols = [...document.querySelectorAll("#poTable thead th[data-col]")].map(th => th.dataset.col);
  const groups = poMonth || isPoSearchingAll() || poShowDeleted ? buildPoGroups() : [];
  const counter = document.getElementById("poRowCounter");
  if (counter) {
    counter.textContent = (groups.length === 1 ? "1 style" : `${groups.length.toLocaleString()} styles`)
      + (poShowDeleted ? " · deleted" : isPoSearchingAll() ? " · all months" : "");
  }

  if (!groups.length) {
    const msg = poShowDeleted ? "No deleted POs." : !months.length
      ? (poLinesTableReady ? "No PO data yet — use Import N41 POs in the menu (⋮)." : "Create the n41_po_lines table in Supabase (supabase-schema.sql), then use Import N41 POs in the menu (⋮).")
      : "No styles match the current filters.";
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(msg)}</td></tr>`;
    return;
  }
  const rows = [];
  groups.forEach((group, i) => {
    // A gap before each style after the first, so its colours read as its own.
    if (i) {
      const gap = document.createElement("tr");
      gap.className = "po-gap-row";
      gap.innerHTML = `<td colspan="${cols.length}"></td>`;
      rows.push(gap);
    }
    rows.push(createPoGroupRow(group, cols));
    if (group.colors.length) group.colors.forEach((style, n) => rows.push(createPoColorRow(group, style, cols, n === 0)));
    else rows.push(createPoLinesOnlyRow(group, cols));
  });
  tbody.replaceChildren(...rows);
  syncStylePaneRows();
}

/**
 * The month's colours with no photos that aren't on Need to Shoot — the
 * suggestions, counted across the whole month whatever the filters.
 */
function countPoUnshot() {
  const groups = getPoMonthGroups();
  let colors = 0;
  let styles = 0;
  groups.forEach(group => {
    const n = group.colors.filter(s => suggestPoReason(group, s)).length;
    colors += n;
    if (n) styles += 1;
  });
  return { colors, styles };
}

/** The line under the POs toolbar: how many still need adding, and Show them. */
function renderPoNotice() {
  const notice = document.getElementById("poNotice");
  if (!notice) return;
  const { colors, styles } = poMonth && arePhotosKnown() ? countPoUnshot() : { colors: 0, styles: 0 };
  notice.hidden = !colors;
  if (!colors) return;
  const text = document.createElement("span");
  text.textContent = `${colors.toLocaleString()} ${colors === 1 ? "color" : "colors"} (${styles.toLocaleString()} ${styles === 1 ? "style" : "styles"}) in ${formatPoMonth(poMonth)} ${colors === 1 ? "has" : "have"} no photos and ${colors === 1 ? "isn't" : "aren't"} on Need to Shoot.`;
  notice.replaceChildren(text);
  if (!poSuggestedOnly) {
    const show = document.createElement("button");
    show.type = "button";
    show.className = "btn";
    show.textContent = "Show them";
    show.addEventListener("click", () => {
      // Every one of them: clear the filters that could hide some.
      poSuggestedOnly = true;
      poNeedOnly = false;
      poTypeFilter = "all";
      poPhotoFilter = "all";
      const search = document.getElementById("poSearchInput");
      if (search) search.value = "";
      syncHeaderSearch();
      renderPoView();
    });
    notice.appendChild(show);
  }
}

/** Put every suggested colour of the month (as filtered) on Need to Shoot. */
async function addPoSuggested() {
  const byReason = new Map();
  buildPoGroups().forEach(group => group.colors.forEach(style => {
    const reason = suggestPoReason(group, style);
    if (!reason) return;
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason).push({ styleNo: style.styleNo, color: style.color });
  }));
  const total = [...byReason.values()].reduce((n, list) => n + list.length, 0);
  if (!total) {
    showIndicator("Nothing suggested that isn't already on Need to Shoot.", "success");
    return;
  }
  const summary = [...byReason].map(([reason, list]) => `${getShootReasonLabel(reason)}: ${list.length}`).join("\n");
  if (!confirm(`Add ${total} colours to Need to Shoot?\n\n${summary}`)) return;
  try {
    for (const [reason, list] of byReason) await addToShootList(list, reason);
    showIndicator(`${total} colours added to Need to Shoot`, "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't save.", "error");
  }
  renderPoView();
  refreshPhotoshootViews();
}

function initPurchaseOrders() {
  document.getElementById("headerMenuImportPoColors")?.addEventListener("click", () => {
    closeHeaderMenu();
    const input = document.getElementById("poN41File");
    if (!input) return;
    input.value = "";
    input.click();
  });
  document.getElementById("poN41File")?.addEventListener("change", e => importN41Pos(e.target.files?.[0]));
  // A new day: ETAs that passed yesterday stop counting.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshPoIhds();
  });
  document.querySelectorAll("#poTypeFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      poTypeFilter = btn.dataset.type;
      renderPoView();
    });
  });
  document.querySelectorAll("#poPhotoFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      poPhotoFilter = btn.dataset.photos;
      renderPoView();
    });
  });
  document.getElementById("poSameStyle")?.addEventListener("change", e => {
    poSameStyle = e.target.checked;
    renderPoView();
  });
  let searchTimer = 0;
  document.getElementById("poSearchInput")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderPoView, 150);
  });
  document.getElementById("poSearchScope")?.addEventListener("change", e => {
    poSearchScope = e.target.value;
    renderPoView();
  });
  document.getElementById("poSuggestedBtn")?.addEventListener("click", () => {
    poSuggestedOnly = !poSuggestedOnly;
    if (poSuggestedOnly) poNeedOnly = false; // suggestions are never already waiting
    renderPoView();
  });
  document.getElementById("poShowCompany")?.addEventListener("change", e => {
    poShowCompany = e.target.checked;
    renderPoView();
  });
  document.getElementById("poShowDeleted")?.addEventListener("change", e => {
    poShowDeleted = e.target.checked;
    renderPoView();
  });
  document.getElementById("poNeedBtn")?.addEventListener("click", () => {
    poNeedOnly = !poNeedOnly;
    if (poNeedOnly) poSuggestedOnly = false;
    renderPoView();
  });
  document.getElementById("poAddSuggestedBtn")?.addEventListener("click", addPoSuggested);
  document.getElementById("poTableBody")?.addEventListener("click", e => {
    const tr = e.target.closest("tr.po-color-row");
    if (!tr || e.target.closest(".shoot-picker, button, a, input")) return;
    openStylePane(tr.dataset.styleNo, tr.dataset.color);
  });
}
