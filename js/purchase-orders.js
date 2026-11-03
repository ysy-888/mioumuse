/**
 * POs — the cost sheet's style lines, a month at a time (view "pos").
 *
 * Menu → Link Cost Sheet keeps a handle to the workbook, which is read again
 * whenever it changes (one tab per month, "11.2026"; header row with STYLE #,
 * P.O#, dept, STORE IN). The S (new) and SR (recut) lines replace the saved
 * ones, then each style's IHD is set from Store In: the next one from today,
 * or the latest if all have passed.
 *
 * Each style shows with its PO lines, and under it every colour in the
 * Styles database with photos and the New Style / New Color / Reshoot
 * picker. Only colours with no photos are suggested: New Style on a new PO
 * (S), New Color on a recut (SR).
 */

let poMonth = "";
let poTypeFilter = "all"; // "all" | "new" | "recut"
let poPhotoFilter = "all"; // "all" | "with" | "without" — needs the image folder
let poSuggestedOnly = false; // just the colours Add suggested would add
let poNeedOnly = false; // just the colours waiting on Need to Shoot (not yet shot)

// ── Reading the cost sheet ───────────────────────────────────────────────────

const PO_MONTH_TAB = /^(\d{1,2})\.(\d{4})$/;

/** T6941-RE4 → T6941; J5937(B) → J5937; J4047-FABRIK → J4047. */
function poBaseStyle(poStyle) {
  return poStyle.split(/[-(]/)[0].trim().toUpperCase();
}

/** RE4 → 4; RE alone → 1; none → 0. */
function poRecutNumber(poStyle) {
  const m = poStyle.slice(poBaseStyle(poStyle).length).match(/RE(\d*)/i);
  return m ? Number(m[1] || 1) : 0;
}

/**
 * Store In: an Excel date number, or text like 11/16/2026. Only its month
 * and day are trusted: a date typed without a year gets the year it was
 * typed in, so 1/4 on the 1.2027 tab can hold 2026. The year is the one
 * that puts the date nearest the tab's month (1/5 on 12.2025 is 2026).
 */
function poCellDate(value, tabYear, tabMonth) {
  let month, day;
  if (typeof value === "number" && value > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    month = d.getUTCMonth() + 1;
    day = d.getUTCDate();
  } else {
    const m = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
    if (!m) return "";
    month = Number(m[1]);
    day = Number(m[2]);
  }
  const tabAt = tabYear * 12 + tabMonth;
  const year = [tabYear - 1, tabYear, tabYear + 1]
    .reduce((best, y) => Math.abs(y * 12 + month - tabAt) < Math.abs(best * 12 + month - tabAt) ? y : best);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Every S / SR line of every month tab. */
function parseCostSheet(workbook) {
  const lines = [];
  workbook.SheetNames.forEach(name => {
    const tab = name.trim().match(PO_MONTH_TAB);
    if (!tab) return;
    const month = `${tab[2]}-${tab[1].padStart(2, "0")}`;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: "A", raw: true, defval: "", blankrows: true });
    const headerAt = rows.findIndex(r => /^STYLE\s*#/i.test(String(r.D).trim()));
    if (headerAt < 0) return;
    rows.slice(headerAt + 1).forEach((r, i) => {
      const poStyle = String(r.D).trim().toUpperCase();
      const dept = String(r.G).trim().toUpperCase();
      if (!poStyle || (dept !== "S" && dept !== "SR")) return;
      lines.push({
        month,
        rowNo: headerAt + i + 2, // the sheet's own row number
        poStyle,
        styleNo: poBaseStyle(poStyle),
        recut: dept === "SR" ? Math.max(1, poRecutNumber(poStyle)) : 0,
        poNo: String(r.E).trim(),
        dept,
        storeIn: poCellDate(r.I, Number(tab[2]), Number(tab[1])),
      });
    });
  });
  return lines;
}

/** The Styles database's colours for a PO's style: as written, or without a trailing ST. */
function getPoStyleColors(styleNo) {
  const colors = getStyleColors(styleNo);
  if (colors.length || !/ST$/.test(styleNo)) return colors;
  return getStyleColors(styleNo.slice(0, -2));
}

/**
 * The IHD each style should have: its next Store In from today, or the
 * latest one if they've all passed. Keyed by the database's Style #.
 *
 * Archived months don't count. A style whose POs are all in archived months
 * has its IHD cleared — but only if it's still one of those Store Ins, so a
 * date typed in by hand is left alone.
 */
function poIhdsByStyle(lines) {
  const today = todayYmd();
  const archived = getPoArchivedMonths();
  const dates = new Map();
  const archivedDates = new Map();
  lines.forEach(line => {
    const colors = getPoStyleColors(line.styleNo);
    if (!line.storeIn || !colors.length) return;
    const key = colors[0].styleNo;
    const into = archived.has(line.month) ? archivedDates : dates;
    if (!into.has(key)) into.set(key, []);
    into.get(key).push(line.storeIn);
  });
  const ihds = new Map();
  dates.forEach((list, styleNo) => {
    list.sort();
    ihds.set(styleNo, list.find(d => d >= today) ?? list[list.length - 1]);
  });
  archivedDates.forEach((list, styleNo) => {
    if (dates.has(styleNo)) return;
    if (getStyleColors(styleNo).some(s => list.includes(s.ihd))) ihds.set(styleNo, "");
  });
  return ihds;
}

/** Set IHDs from the PO lines; returns how many styles changed. */
async function applyPoIhds(lines, onProgress) {
  const changes = [...poIhdsByStyle(lines)]
    .filter(([styleNo, ihd]) => getStyleColors(styleNo).some(s => s.ihd !== ihd));
  let done = 0;
  const queue = [...changes];
  const worker = async () => {
    while (queue.length) {
      const [styleNo, ihd] = queue.shift();
      await setStyleNoIhd(styleNo, ihd);
      onProgress?.(++done, changes.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return changes.length;
}

/**
 * The day IHDs were last checked against the saved PO lines. A Store In
 * that has passed stops counting the next day, even if the sheet hasn't
 * changed, so the check runs when the app opens and when a new day starts.
 */
let poIhdsCheckedOn = "";

async function refreshPoIhds() {
  if (!getAllPoLines().length || poIhdsCheckedOn === todayYmd()) return;
  poIhdsCheckedOn = todayYmd();
  try {
    const changed = await applyPoIhds(getAllPoLines());
    if (!changed) return;
    refreshPoDependentViews();
    showIndicator(`IHD updated from the cost sheet for ${changed.toLocaleString()} ${changed === 1 ? "style" : "styles"} (a Store In passed)`, "success");
  } catch (err) {
    poIhdsCheckedOn = "";
    showIndicator(`Couldn't update IHDs: ${err.message || "save failed"}`, "error");
  }
}

/** Archive a month (or bring it back), then re-work the IHDs it affects. */
async function setPoMonthArchivedAndApply(month, archived) {
  try {
    await setPoMonthArchived(month, archived);
    const changed = await applyPoIhds(getAllPoLines());
    refreshPoDependentViews();
    showIndicator(`${formatPoMonth(month)} ${archived ? "archived" : "brought back"} — ${changed.toLocaleString()} ${changed === 1 ? "IHD" : "IHDs"} changed`, "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't archive the month.", "error");
    renderPoView();
  }
}

/** Read the workbook, replace the PO lines and set IHDs. Returns false on failure. */
async function importCostSheet(file) {
  if (!file) return false;
  try {
    showIndicator("Reading the cost sheet…");
    await loadSheetJs();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const lines = parseCostSheet(workbook);
    if (!lines.length) throw new Error("No month tabs (like 11.2026) with a STYLE # header were found.");
    showIndicator("Saving PO lines…");
    await replacePoLines(lines);
    const changed = await applyPoIhds(lines, (n, total) => showIndicator(`Updating IHDs… ${n} / ${total}`));
    if (!poMonth) poMonth = defaultPoMonth();
    refreshPoDependentViews();
    showIndicator(`Cost sheet updated — ${lines.length.toLocaleString()} PO lines, ${changed.toLocaleString()} IHDs changed`, "success");
    return true;
  } catch (err) {
    showIndicator(`Cost sheet: ${err.message || "couldn't read it."}`, "error");
    return false;
  }
}

/** IHDs show on Styles, Need to Shoot and the shoot pane as well as here. */
function refreshPoDependentViews() {
  if (getCurrentAppView() === "pos") renderPoView();
  if (getCurrentAppView() === "styles" && typeof applyStyleFilters === "function") applyStyleFilters({ keepShown: true });
  refreshPhotoshootViews();
}

// ── The linked cost sheet ────────────────────────────────────────────────────
//
// Like the image folder: Chrome and Edge let the page keep a handle to a file
// the user picked once (File System Access API, kept in IndexedDB). Each
// time the app opens — and when you come back to its tab — the file is
// checked, and read again only if it has changed since this browser last
// read it. Other browsers fall back to picking the file each time.

const COST_SHEET_RECHECK_MS = 60 * 1000;

/** "unsupported" | "none" | "needs-permission" | "ready" | "reading". */
let costSheetState = typeof window.showOpenFilePicker === "function" ? "none" : "unsupported";
let costSheetHandle = null;
let costSheetCheckedAt = 0;
let costSheetReadAt = "";

/** Read the file if it changed since last time (or always, with `force`). */
async function syncCostSheet({ force = false } = {}) {
  if (!costSheetHandle || costSheetState === "reading") return;
  costSheetCheckedAt = Date.now();
  let file;
  try {
    file = await costSheetHandle.getFile();
  } catch (err) {
    // Gone, renamed, or the drive isn't reachable. Excel having it open is fine.
    if ((await costSheetHandle.queryPermission({ mode: "read" })) !== "granted") costSheetState = "needs-permission";
    renderCostSheetStatus();
    if (force) showIndicator(`Couldn't open the cost sheet: ${err.message}`, "error");
    return;
  }
  const seen = await idbGet("costSheetSeen");
  const signature = `${file.lastModified}|${file.size}`;
  if (!force && seen?.signature === signature) {
    costSheetReadAt = seen.readAt ?? "";
    renderCostSheetStatus();
    return;
  }
  costSheetState = "reading";
  renderCostSheetStatus();
  const ok = await importCostSheet(file);
  costSheetState = "ready";
  if (ok) {
    costSheetReadAt = new Date().toISOString();
    await idbSet("costSheetSeen", { signature, readAt: costSheetReadAt });
  }
  renderCostSheetStatus();
}

async function linkCostSheet() {
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({
      id: "cost-sheet",
      types: [{ description: "Cost sheet", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx", ".xlsm"] } }],
    });
  } catch {
    return; // picker closed
  }
  costSheetHandle = handle;
  costSheetState = "ready";
  await idbSet("costSheet", handle);
  await idbSet("costSheetSeen", undefined);
  await syncCostSheet({ force: true });
}

/** After a browser restart: ask for read access again (needs a click). */
async function reconnectCostSheet() {
  if (!costSheetHandle) return;
  if ((await costSheetHandle.requestPermission({ mode: "read" })) !== "granted") return;
  costSheetState = "ready";
  await syncCostSheet();
}

async function unlinkCostSheet() {
  costSheetHandle = null;
  costSheetState = "none";
  costSheetReadAt = "";
  await idbSet("costSheet", undefined);
  await idbSet("costSheetSeen", undefined);
  renderCostSheetStatus();
}

/** On app load: pick the linked file back up and check it. */
async function restoreCostSheet() {
  if (costSheetState === "unsupported") return renderCostSheetStatus();
  const handle = await idbGet("costSheet");
  if (!handle) return renderCostSheetStatus();
  costSheetHandle = handle;
  costSheetReadAt = (await idbGet("costSheetSeen"))?.readAt ?? "";
  if ((await handle.queryPermission({ mode: "read" })) === "granted") {
    costSheetState = "ready";
    await syncCostSheet();
  } else {
    costSheetState = "needs-permission";
    renderCostSheetStatus();
  }
}

function getCostSheetMenuState() {
  switch (costSheetState) {
    case "unsupported": return { label: "Import Cost Sheet", canUnlink: false };
    case "none": return { label: "Link Cost Sheet", canUnlink: false };
    case "needs-permission": return { label: "Reconnect Cost Sheet", canUnlink: true };
    case "ready": return { label: "Update from Cost Sheet", canUnlink: true };
    default: return { label: "", canUnlink: false }; // mid-read
  }
}

function runCostSheetMenuAction() {
  if (costSheetState === "unsupported") {
    const input = document.getElementById("poImportFile");
    if (!input) return;
    input.value = "";
    input.click();
  } else if (costSheetState === "none") linkCostSheet();
  else if (costSheetState === "needs-permission") reconnectCostSheet();
  else if (costSheetState === "ready") syncCostSheet({ force: true });
}

/** The POs toolbar's line: which file, when it was read, or Reconnect. */
function renderCostSheetStatus() {
  const wrap = document.getElementById("poCostSheetStatus");
  if (!wrap) return;
  const text = (t, title = "", warn = false) => {
    const s = document.createElement("span");
    s.className = "style-image-text" + (warn ? " is-warning" : "");
    s.textContent = t;
    if (title) s.title = title;
    return s;
  };
  const name = costSheetHandle?.name ?? "";
  if (costSheetState === "needs-permission") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = "Reconnect";
    btn.addEventListener("click", reconnectCostSheet);
    wrap.replaceChildren(text("Cost sheet disconnected", `${name} — reconnect to keep POs and IHDs up to date.`, true), btn);
  } else if (costSheetState === "reading") {
    wrap.replaceChildren(text("Reading the cost sheet…"));
  } else if (costSheetState === "ready") {
    const when = costSheetReadAt ? new Date(costSheetReadAt).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    wrap.replaceChildren(text(when ? `Cost sheet read ${when}` : "Cost sheet linked", `${name}\nRe-read automatically when it changes.`));
  } else {
    wrap.replaceChildren();
  }
}

// ── The page ─────────────────────────────────────────────────────────────────

function getPoMonths() {
  return [...new Set(getAllPoLines().map(l => l.month))].sort();
}

/** This month if it's there, else the nearest one after it, else the last — archived ones only if that's all there is. */
function defaultPoMonth() {
  const all = getPoMonths();
  const live = all.filter(m => !getPoArchivedMonths().has(m));
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
// Down the left of the page, oldest first, each with its style count, in a
// folder per year that opens and closes. The box icon on a month archives
// it: it moves to the Archived group at the bottom (folded away unless open,
// with year folders of its own), and its Store Ins stop setting IHDs.

let poShowArchived = false;
/** Open year folders, as "live:2026" / "archived:2026". */
const poOpenYears = new Set();
/** The month whose year was last opened for it — a newly shown month opens its year once. */
let poYearOpenedFor = "";

const PO_FOLDER_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const PO_FOLDER_OPEN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 7v10a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L21.5 12a1 1 0 0 0-1-1.3H7.3a2 2 0 0 0-1.9 1.4L3 19"/></svg>';

const PO_ARCHIVE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>';
const PO_UNARCHIVE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';

function createPoMonthItem(month, styleCount, archived) {
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
  count.textContent = styleCount.toLocaleString();
  count.title = `${styleCount.toLocaleString()} ${styleCount === 1 ? "style" : "styles"}`;
  pick.append(name, count);
  pick.addEventListener("click", () => {
    poMonth = month;
    renderPoView();
  });

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "po-month-archive";
  toggle.innerHTML = archived ? PO_UNARCHIVE_ICON : PO_ARCHIVE_ICON;
  const label = archived
    ? `Bring back ${formatPoMonth(month)}: its Store Ins set IHDs again`
    : `Archive ${formatPoMonth(month)}: its Store Ins stop setting IHDs`;
  toggle.title = label;
  toggle.setAttribute("aria-label", label);
  toggle.addEventListener("click", () => {
    if (!archived && !confirm(`Archive ${formatPoMonth(month)}?\n\nIts Store Ins stop setting IHDs. A style with POs only in archived months has its IHD cleared. You can bring the month back from Archived.`)) return;
    setPoMonthArchivedAndApply(month, !archived);
  });

  item.append(pick, toggle);
  return item;
}

function renderPoMonthList() {
  const list = document.getElementById("poMonthList");
  if (!list) return;
  const styleCounts = new Map();
  getAllPoLines().forEach(l => {
    if (!styleCounts.has(l.month)) styleCounts.set(l.month, new Set());
    styleCounts.get(l.month).add(l.styleNo);
  });
  const months = getPoMonths();
  if (!months.length) {
    const empty = document.createElement("div");
    empty.className = "po-months-empty";
    empty.textContent = "No months yet";
    list.replaceChildren(empty);
    return;
  }
  const archivedSet = getPoArchivedMonths();
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
      if (open) out.push(...ms.map(m => createPoMonthItem(m, styleCounts.get(m)?.size ?? 0, section === "archived")));
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
 * Only a colour with no photos is suggested: New Style on a new PO, New Color
 * on a recut. Not one that's already waiting, never shot, or CANCEL or INACTIVE in N41. Photos are only
 * known with the image folder linked, so without it nothing is suggested.
 */
function suggestPoReason(group, style) {
  if (!arePhotosKnown() || hasStyleImages(style.styleNo, style.color)) return "";
  if (isNoShootStyle(style.styleNo, style.color)) return "";
  if (["CANCEL", "INACTIVE"].includes(String(style.status ?? "").trim().toUpperCase())) return "";
  const entry = getShootListEntry(style.styleNo, style.color);
  if (entry && !entry.shotShootId) return "";
  return group.lines.some(l => l.dept === "S") ? "newStyle" : "newColor";
}

/** The month's lines, one group per style, in sheet order. */
function buildPoGroups() {
  const q = (document.getElementById("poSearchInput")?.value ?? "").trim().toLowerCase();
  setActiveSearchQuery(q);
  const groups = new Map();
  getAllPoLines().filter(l => l.month === poMonth).forEach(line => {
    if (!groups.has(line.styleNo)) groups.set(line.styleNo, { styleNo: line.styleNo, lines: [], colors: getPoStyleColors(line.styleNo) });
    groups.get(line.styleNo).lines.push(line);
  });
  // Photos: keep the colours that match; a style with none left goes.
  const photos = arePhotosKnown() ? poPhotoFilter : "all";
  const suggestedOnly = poSuggestedOnly && arePhotosKnown();
  groups.forEach(g => {
    if (photos !== "all") g.colors = g.colors.filter(s => hasStyleImages(s.styleNo, s.color) === (photos === "with"));
    if (suggestedOnly) g.colors = g.colors.filter(s => suggestPoReason(g, s));
    if (poNeedOnly) g.colors = g.colors.filter(s => { const e = getShootListEntry(s.styleNo, s.color); return e && !e.shotShootId; });
  });
  return [...groups.values()].filter(g => {
    if ((photos !== "all" || suggestedOnly || poNeedOnly) && !g.colors.length) return false;
    const isNew = g.lines.some(l => l.dept === "S");
    if (poTypeFilter === "new" && !isNew) return false;
    if (poTypeFilter === "recut" && isNew) return false;
    if (!q) return true;
    const text = [g.styleNo, ...g.lines.map(l => `${l.poStyle} ${l.poNo}`),
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
  const desc = group.colors[0]?.description;
  if (desc) {
    const d = document.createElement("span");
    d.className = "po-group-desc";
    d.textContent = desc;
    head.appendChild(d);
  }
  if (!group.colors.length) {
    const none = document.createElement("span");
    none.className = "po-group-missing";
    none.textContent = "Not in the Styles database";
    head.appendChild(none);
  }
  td.appendChild(head);
  tr.appendChild(td);
  return tr;
}

/** One PO line: New or RE#, and the PO number. Store In is in the tooltip. */
function createPoLineChip(line) {
  const chip = document.createElement("span");
  chip.className = "po-line";
  chip.dataset.dept = line.dept;
  const kind = line.dept === "S" ? "New" : `RE${line.recut}`;
  chip.innerHTML = `<b>${escapeHtml(kind)}</b> PO ${buildSearchHighlightedHtml(line.poNo || EMPTY_DISPLAY, getActiveSearchQuery())}`;
  chip.title = `${line.poStyle} · Store In ${line.storeIn ? formatMdy(line.storeIn) : EMPTY_DISPLAY} · row ${line.rowNo}`;
  return chip;
}

/** All of a style's PO lines, stacked, for the one PO cell beside its colours. */
function createPoLinesCell(group, rowSpan) {
  const td = document.createElement("td");
  td.dataset.col = "po";
  td.rowSpan = rowSpan;
  const list = document.createElement("div");
  list.className = "po-lines";
  list.append(...group.lines.map(createPoLineChip));
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
    else if (col === "ihd") setDisplayText(td, style.ihd ? formatMdy(style.ihd) : EMPTY_DISPLAY);
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
  const groups = poMonth ? buildPoGroups() : [];
  const counter = document.getElementById("poRowCounter");
  if (counter) counter.textContent = groups.length === 1 ? "1 style" : `${groups.length.toLocaleString()} styles`;

  if (!groups.length) {
    const msg = !months.length
      ? (poLinesTableReady ? "No PO data yet — use Import Cost Sheet in the menu (⋮)." : "Create the po_lines table in Supabase (supabase-schema.sql), then use Import Cost Sheet in the menu (⋮).")
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
  const groups = new Map();
  getAllPoLines().filter(l => l.month === poMonth).forEach(line => {
    if (!groups.has(line.styleNo)) groups.set(line.styleNo, { styleNo: line.styleNo, lines: [], colors: getPoStyleColors(line.styleNo) });
    groups.get(line.styleNo).lines.push(line);
  });
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
  document.getElementById("headerMenuCostSheet")?.addEventListener("click", () => {
    closeHeaderMenu();
    runCostSheetMenuAction();
  });
  document.getElementById("headerMenuCostSheetUnlink")?.addEventListener("click", () => {
    closeHeaderMenu();
    unlinkCostSheet();
  });
  document.getElementById("poImportFile")?.addEventListener("change", e => importCostSheet(e.target.files?.[0]));
  // Coming back to the app's tab: check the file again (at most once a minute).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && costSheetState === "ready"
      && Date.now() - costSheetCheckedAt > COST_SHEET_RECHECK_MS) syncCostSheet();
    // A new day: Store Ins that passed yesterday stop counting.
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
  document.getElementById("poSearchInput")?.addEventListener("input", renderPoView);
  document.getElementById("poSuggestedBtn")?.addEventListener("click", () => {
    poSuggestedOnly = !poSuggestedOnly;
    if (poSuggestedOnly) poNeedOnly = false; // suggestions are never already waiting
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
