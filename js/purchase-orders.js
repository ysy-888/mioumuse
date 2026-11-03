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
 * picker. The suggestion: a new style (S) is New Style; a recut's colour
 * with no photos is New Color.
 */

let poMonth = "";
let poTypeFilter = "all"; // "all" | "new" | "recut"

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

/** Store In: an Excel date number, or text like 11/16/2026 (11/16 takes the tab's year). */
function poCellDate(value, tabYear) {
  if (typeof value === "number" && value > 20000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000).toISOString().slice(0, 10);
  }
  const m = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return "";
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : tabYear;
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
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
        storeIn: poCellDate(r.I, Number(tab[2])),
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
 */
function poIhdsByStyle(lines) {
  const today = todayYmd();
  const dates = new Map();
  lines.forEach(line => {
    const colors = getPoStyleColors(line.styleNo);
    if (!line.storeIn || !colors.length) return;
    const key = colors[0].styleNo;
    if (!dates.has(key)) dates.set(key, []);
    dates.get(key).push(line.storeIn);
  });
  const ihds = new Map();
  dates.forEach((list, styleNo) => {
    list.sort();
    ihds.set(styleNo, list.find(d => d >= today) ?? list[list.length - 1]);
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

/** This month if it's there, else the nearest one after it, else the last. */
function defaultPoMonth() {
  const months = getPoMonths();
  const now = todayYmd().slice(0, 7);
  return months.find(m => m >= now) ?? months[months.length - 1] ?? "";
}

function formatPoMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

/** New Style for a new style; New Color for a recut's colour with no photos. */
function suggestPoReason(group, style) {
  if (group.lines.some(l => l.dept === "S")) return "newStyle";
  return styleImageState === "ready" && !hasStyleImages(style.styleNo, style.color) ? "newColor" : "";
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
  return [...groups.values()].filter(g => {
    const isNew = g.lines.some(l => l.dept === "S");
    if (poTypeFilter === "new" && !isNew) return false;
    if (poTypeFilter === "recut" && isNew) return false;
    if (!q) return true;
    const text = [g.styleNo, ...g.lines.map(l => `${l.poStyle} ${l.poNo}`),
      ...g.colors.map(s => `${s.color} ${s.description} ${s.status}`)].join(" ").toLowerCase();
    return text.includes(q);
  });
}

function createPoGroupRow(group, colCount) {
  const tr = document.createElement("tr");
  tr.className = "po-group-row";
  const td = document.createElement("td");
  td.colSpan = colCount;
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

  group.lines.forEach(line => {
    const chip = document.createElement("span");
    chip.className = "po-line";
    chip.dataset.dept = line.dept;
    const kind = line.dept === "S" ? "New" : `RE${line.recut}`;
    chip.innerHTML = `<b>${escapeHtml(kind)}</b> PO ${buildSearchHighlightedHtml(line.poNo || EMPTY_DISPLAY, getActiveSearchQuery())} · Store In ${escapeHtml(line.storeIn ? formatMdy(line.storeIn) : EMPTY_DISPLAY)}`;
    chip.title = `${line.poStyle} · row ${line.rowNo}`;
    head.appendChild(chip);
  });

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

function createPoColorRow(group, style, cols) {
  const tr = document.createElement("tr");
  tr.className = "clickable-row po-color-row";
  tr.dataset.styleNo = style.styleNo;
  tr.dataset.color = style.color;
  const photos = getStyleImageEntries(style.styleNo, style.color).length;
  cols.forEach(col => {
    const td = document.createElement("td");
    td.dataset.col = col;
    if (col === "image") td.appendChild(createStyleThumb(style.styleNo, style.color));
    else if (col === "color") mountSearchHighlightedText(td, style.color);
    else if (col === "status") td.appendChild(createStyleStatusPill(style.status));
    else if (col === "photos") setDisplayText(td, styleImageState === "ready" ? String(photos) : EMPTY_DISPLAY);
    else if (col === "ihd") setDisplayText(td, style.ihd ? formatMdy(style.ihd) : EMPTY_DISPLAY);
    else if (col === "shoot") td.appendChild(createStyleShootCell(style, { suggested: suggestPoReason(group, style) }));
    tr.appendChild(td);
  });
  return tr;
}

function renderPoView() {
  const select = document.getElementById("poMonthSelect");
  const months = getPoMonths();
  if (!months.includes(poMonth)) poMonth = defaultPoMonth();
  if (select) {
    select.replaceChildren(...months.map(m => new Option(formatPoMonth(m), m)));
    select.value = poMonth;
    select.disabled = !months.length;
  }
  document.querySelectorAll("#poTypeFilters .filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === poTypeFilter);
  });

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
  groups.forEach(group => {
    rows.push(createPoGroupRow(group, cols.length));
    group.colors.forEach(style => rows.push(createPoColorRow(group, style, cols)));
  });
  tbody.replaceChildren(...rows);
}

/** Put every suggested colour of the month (as filtered) on Need to Shoot. */
async function addPoSuggested() {
  const byReason = new Map();
  buildPoGroups().forEach(group => group.colors.forEach(style => {
    if (isNoShootStyle(style.styleNo, style.color)) return;
    const entry = getShootListEntry(style.styleNo, style.color);
    if (entry && !entry.shotShootId) return; // already waiting
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
  });
  document.getElementById("poMonthSelect")?.addEventListener("change", e => {
    poMonth = e.target.value;
    renderPoView();
  });
  document.querySelectorAll("#poTypeFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      poTypeFilter = btn.dataset.type;
      renderPoView();
    });
  });
  document.getElementById("poSearchInput")?.addEventListener("input", renderPoView);
  document.getElementById("poAddSuggestedBtn")?.addEventListener("click", addPoSuggested);
  document.getElementById("poTableBody")?.addEventListener("click", e => {
    const tr = e.target.closest("tr.po-color-row");
    if (!tr || e.target.closest(".shoot-picker, button, a, input")) return;
    openStyleGallery(tr.dataset.styleNo, tr.dataset.color);
  });
}
