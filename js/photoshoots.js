/**
 * Photoshoots — the shoots themselves, and the Need to Shoot list. Two pages
 * (views "photoshoots" and "needToShoot") sharing one toolbar.
 *
 *   Need to Shoot   every style flagged for pictures and not yet done. Its
 *                   type (New Style / New Color / Recut) comes from its PO;
 *                   the one choice here is Photoshoot or CG. Photoshoot puts
 *                   it in the next studio shoot; CG keeps it out of shoots.
 *   Shoots          each shoot: date, studio / editorial, model, styles.
 *                   Clicking one opens its side pane; marking it complete
 *                   records its styles as shot, and they leave the list.
 *
 * A set's pieces (js/store.js groupBySet) stay together in both: next to each
 * other on Need to Shoot, and moved as one when a shoot is reordered.
 *
 * The shared status badge (createShootStatusBadge) also shows in the Styles
 * table's Shoot column.
 */

let needFilter = "all";         // "all" | "undecided" | "photoshoot" | "cg"
let needReasonFilter = "all";   // "all" | a type (SHOOT_REASONS key)
let shootFilter = "planned";    // "planned" | "complete" | "all"
let needSelectedKeys = new Set();
let filteredNeedRows = [];
let needPage = 1;
let needPageSize = TABLE_PAGE_SIZE_DEFAULT; // read once the page loads (initPhotoshoots)
/** The filters the page was last drawn with — a change starts back at page 1. */
let needPagedFor = "";
let paneShootId = null;

// ── Status badge ─────────────────────────────────────────────────────────────

function formatShootDate(ymdValue) {
  return ymdValue ? formatTaskDate(ymdValue) : "No date";
}

/** M/D (11/20), for the Photoshoots list and a shoot's header. */
function formatShootDateMd(ymdValue) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(ymdValue ?? "");
  return m ? `${Number(m[1])}/${Number(m[2])}` : "No date";
}

/** MM/DD, for the small date pill in a Shoot cell. */
function formatShootDateShort(ymdValue) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(ymdValue ?? "");
  return m ? `${m[1]}/${m[2]}` : "No date";
}

/**
 * Where a style stands: To shoot / Scheduled · date / Shot · date — or
 * nothing at all when it isn't on the list.
 */
function describeShootStatus(styleNo, color) {
  const entry = getShootListEntry(styleNo, color);
  if (!entry) return null;
  if (entry.shotShootId === CG_SHOOT_ID) {
    // Marked complete by hand: made in Photoshop or with AI.
    const date = formatLongDate(entry.shotAt.slice(0, 10));
    return { tone: "shot", label: `Done (CG) · ${date}`, short: `CG ${formatShootDateShort(entry.shotAt)}`, shoots: [] };
  }
  if (entry.shotShootId) {
    const shoot = getPhotoshootById(entry.shotShootId);
    const date = shoot ? formatShootDate(shoot.date) : formatLongDate(entry.shotAt.slice(0, 10));
    const shortDate = formatShootDateShort(shoot ? shoot.date : entry.shotAt);
    return { tone: "shot", label: `Shot · ${date}`, short: `Shot ${shortDate}`, shoots: shoot ? [shoot] : [] };
  }
  const planned = getPlannedShootsFor(styleNo, color);
  if (planned.length) {
    const next = planned[0];
    return {
      tone: "scheduled",
      label: `Scheduled · ${formatShootDate(next.date)}${planned.length > 1 ? ` +${planned.length - 1}` : ""}`,
      short: `${formatShootDateShort(next.date)}${planned.length > 1 ? ` +${planned.length - 1}` : ""}`,
      shoots: planned,
    };
  }
  const method = getShootMethod(styleNo, color);
  return { tone: "needed", label: method === "cg" ? "CG" : method === "photoshoot" ? "Photoshoot · not scheduled" : "To decide", shoots: [] };
}

const SHOOT_REASON_ICON_PATHS = {
  newStyle: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  newColor: '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>',
  recut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/>',
  reshoot: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
};

/** New Style = a T-shirt, New Color = a paint bucket, Recut = scissors, Reshoot = a camera. */
function shootReasonIcon(key) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">${SHOOT_REASON_ICON_PATHS[key] ?? ""}</svg>`;
}

/** The colours of the POs page's pill (crm.css .po-line) for each type. */
const SHOOT_TYPE_PILL_KIND = { newStyle: "new", newColor: "newColor", recut: "recut" };

/**
 * A type as the POs page's pill — icon and label. "" when there's no type.
 * The same markup goes into the PDF reports (js/exports.js).
 */
function shootTypePillHtml(type) {
  const label = getShootReasonLabel(type);
  if (!label) return "";
  return `<span class="po-line" data-kind="${SHOOT_TYPE_PILL_KIND[type] ?? "other"}"><span class="po-line-icons">${shootReasonIcon(type)}</span><span>${escapeHtml(label)}</span></span>`;
}

/** A style's type pill (from its PO, New Style → New Color once another colour has model photos — js/store.js getShootType), or a dash. */
function createShootTypePill(styleNo, color) {
  const type = getShootType(styleNo, color);
  const wrap = document.createElement("span");
  wrap.className = "shoot-type-cell";
  if (!type) {
    setDisplayText(wrap, EMPTY_DISPLAY);
    wrap.title = "Not on a PO";
    return wrap;
  }
  wrap.innerHTML = shootTypePillHtml(type);
  const sibling = type !== getPoShootType(styleNo, color) ? getPhotographedSibling(styleNo, color) : null;
  wrap.title = sibling ? `New Color — its PO says New Style, but ${sibling.color} already has model photos`
    : PO_KIND_SHOOT_TYPE[getStylePoKind(styleNo, color)] ? `${getShootReasonLabel(type)} — from its PO` : getShootReasonLabel(type);
  return wrap;
}

const SHOOT_ADD_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

/** "MMT1290 BLACK", or "MMT1290 BLACK + 1 set piece" when its set went with it. */
function describeShootPick(styleNo, color, count) {
  return `${styleNo} ${color}${count > 1 ? ` + ${count - 1} set ${count === 2 ? "piece" : "pieces"}` : ""}`;
}

/** What to say after a Photoshoot / CG choice (setShootMethod's result). */
function shootMethodMessage(what, method, result) {
  if (method === "cg") return `${what}: CG — kept out of photoshoots`;
  if (!method) return `${what}: back to undecided`;
  if (result.shoot) return `${what} added to ${getPhotoshootTitle(result.shoot)} (${formatShootDate(result.shoot.date)})`;
  return getNextStudioShoot() ? `${what}: Photoshoot` : `${what}: Photoshoot — no studio shoot is planned, so it joins the next one you create`;
}

/**
 * The Shoot buttons. A style that isn't waiting gets one button, to put it
 * on Need to Shoot (`suggested`: filled in pale, on the POs page). One that
 * is waiting gets the choice: Photoshoot or CG. The lit one is what was
 * picked — click it again to undo, the other to switch. A set's waiting
 * pieces follow. `onDone` redraws after a change.
 */
function createShootPicker(styleNo, color, onDone, { suggested = false, menu = true } = {}) {
  const entry = getShootListEntry(styleNo, color);
  const waiting = Boolean(entry && !entry.shotShootId);
  const style = { styleNo, color };
  const wrap = document.createElement("span");
  wrap.className = "shoot-picker";
  const run = async work => {
    wrap.querySelectorAll("button").forEach(b => { b.disabled = true; });
    try {
      const message = await work();
      if (message) showIndicator(message, "success");
    } catch (err) {
      showIndicator(err.message || "Couldn't save.", "error");
    }
    onDone();
  };

  if (!waiting) {
    // Nothing to decide yet: faded until its row is hovered (crm.css).
    wrap.classList.add("is-unpicked");
    const type = PO_KIND_SHOOT_TYPE[getStylePoKind(styleNo, color)] ? getShootReasonLabel(getShootType(styleNo, color)) : "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "shoot-pick shoot-pick-add" + (suggested ? " is-suggested" : "");
    btn.innerHTML = `${SHOOT_ADD_ICON}<span>Need to Shoot</span>`;
    btn.title = `${entry ? "Done before — put it back on Need to Shoot" : "Add to Need to Shoot"}${type ? ` (${type})` : ""}${suggested ? " — suggested: no model photos" : ""}`;
    btn.setAttribute("aria-label", `${btn.title}: ${styleNo} ${color}`);
    btn.addEventListener("click", () => run(async () => {
      await addToShootList([style]);
      return `${styleNo} ${color} added to Need to Shoot`;
    }));
    wrap.appendChild(btn);
  } else {
    const method = getShootMethod(styleNo, color);
    if (!method) {
      wrap.classList.add("is-waiting");
      wrap.title = "On Need to Shoot — Photoshoot or CG?";
    }
    SHOOT_METHODS.forEach(({ key, label }) => {
      const on = method === key;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shoot-pick shoot-pick-method";
      btn.dataset.method = key;
      btn.textContent = label;
      btn.setAttribute("aria-pressed", String(on));
      const next = getNextStudioShoot();
      btn.title = on ? `${label} — click again to undo`
        : key === "cg" ? "CG: retouched instead of shot — kept out of photoshoots"
        : next ? `Photoshoot: goes into the next studio shoot — ${getPhotoshootTitle(next)}, ${formatShootDate(next.date)}`
        : "Photoshoot: no studio shoot is planned yet — it joins the next one you create";
      btn.setAttribute("aria-label", `${label}: ${styleNo} ${color}`);
      btn.addEventListener("click", () => {
        const value = on ? "" : key;
        // Leaving Photoshoot takes it out of the shoot it's in (and its place in the order).
        const planned = value !== "photoshoot" ? getPlannedShootsFor(styleNo, color) : [];
        if (planned.length && !confirm(`${styleNo} ${color} is in ${getPhotoshootTitle(planned[0])} (${formatShootDate(planned[0].date)}). Take it out${value === "cg" ? " and go with CG" : ""}?`)) return;
        run(async () => {
          const result = await setShootMethod([style], value);
          return shootMethodMessage(describeShootPick(styleNo, color, result.count), value, result);
        });
      });
      wrap.appendChild(btn);
    });
  }
  if (menu) wrap.appendChild(createShootMenuButton(styleNo, color, onDone));
  return wrap;
}

// ── Shoot cell menu ──────────────────────────────────────────────────────────
//
// The ⋮ after the Shoot buttons: Add to Photoshoot (a particular planned one,
// or a new one), Mark as Complete — for pictures made in Photoshop or with
// AI, logged as CG today on the Complete page — and, for a waiting style,
// Remove from Need to Shoot.

function closeShootMenu() {
  document.getElementById("shootMenu")?.remove();
}

function createShootMenuButton(styleNo, color, onDone) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "shoot-menu-btn";
  btn.title = "More: add to a particular photoshoot, mark as complete, or remove";
  btn.setAttribute("aria-label", `More for ${styleNo} ${color}`);
  btn.setAttribute("aria-haspopup", "menu");
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
  btn.addEventListener("click", e => {
    e.stopPropagation();
    const open = document.getElementById("shootMenu");
    if (open?.dataset.for === styleKey(styleNo, color)) closeShootMenu();
    else openShootMenu(btn, styleNo, color, onDone);
  });
  return btn;
}

function openShootMenu(anchor, styleNo, color, onDone) {
  closeShootMenu();
  const menu = document.createElement("div");
  menu.id = "shootMenu";
  menu.dataset.for = styleKey(styleNo, color);
  menu.className = "header-menu-dropdown shoot-menu";
  menu.setAttribute("role", "menu");
  menu.addEventListener("click", e => e.stopPropagation());

  const item = (label, onClick, { sub = false, disabled = false, title = "" } = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "header-menu-item" + (sub ? " shoot-menu-sub" : "");
    b.setAttribute("role", "menuitem");
    b.textContent = label;
    b.disabled = disabled;
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  };
  const style = { styleNo, color };

  const showShoots = () => {
    const planned = getAllPhotoshoots().filter(s => s.status === "planned").sort((a, b) => a.date.localeCompare(b.date));
    const inShoots = new Set(getPlannedShootsFor(styleNo, color).map(s => s.id));
    menu.replaceChildren(
      Object.assign(document.createElement("div"), { className: "shoot-menu-heading", textContent: "Add to Photoshoot" }),
      ...planned.map(s => item(`${formatShootDateShort(s.date)} · ${getPhotoshootTitle(s)}`, async () => {
        closeShootMenu();
        try {
          await addStylesToPhotoshoot(s.id, [style]);
          showIndicator(`${styleNo} ${color} added to ${getPhotoshootTitle(s)} (${formatShootDate(s.date)})`, "success");
        } catch (err) {
          showIndicator(err.message || "Couldn't add to the shoot.", "error");
        }
        onDone();
      }, { sub: true, disabled: inShoots.has(s.id), title: inShoots.has(s.id) ? "Already in this shoot" : "" })),
      item("New photoshoot…", () => {
        closeShootMenu();
        openPhotoshootForm(null, [style]);
      }, { sub: true }),
    );
    place();
    menu.querySelector("button:not(:disabled)")?.focus();
  };

  const done = describeShootStatus(styleNo, color)?.tone === "shot";
  menu.append(
    item("Add to Photoshoot ›", showShoots),
    item("Mark as Complete", async () => {
      closeShootMenu();
      try {
        await markStylesCompleteCg([style]);
        showIndicator(`${styleNo} ${color} marked complete (CG)`, "success");
      } catch (err) {
        showIndicator(err.message || "Couldn't mark it complete.", "error");
      }
      onDone();
    }, { disabled: done, title: done ? "Already done" : "Made in Photoshop or with AI — logged as CG today" }),
  );
  if (needsShoot(styleNo, color)) {
    menu.append(item("Remove from Need to Shoot", async () => {
      closeShootMenu();
      const planned = getPlannedShootsFor(styleNo, color);
      if (planned.length && !confirm(`${styleNo} ${color} is in ${getPhotoshootTitle(planned[0])} (${formatShootDate(planned[0].date)}). Take it out of the shoot and off Need to Shoot?`)) return;
      try {
        await removeFromPlannedShoots([style]);
        await removeFromShootList([style]);
        showIndicator(`${styleNo} ${color} taken off Need to Shoot`, "success");
      } catch (err) {
        showIndicator(err.message || "Couldn't remove it.", "error");
      }
      onDone();
    }));
  }
  document.body.appendChild(menu);

  // Under the button, kept inside the window.
  function place() {
    const r = anchor.getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
    const below = r.bottom + 4;
    const top = below + menu.offsetHeight > window.innerHeight - 8 ? r.top - menu.offsetHeight - 4 : below;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }
  place();
  menu.querySelector("button")?.focus();
}

/** `compact`: the short label (the Shoot column, beside the camera / AI buttons). */
const SHOOT_STATUS_CAMERA_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';

/** The Photoshoots page with that shoot open. */
function goToPhotoshoot(id) {
  if (!getPhotoshootById(id)) return;
  switchAppView("photoshoots");
  if (getCurrentAppView() === "photoshoots") openShootPane(id);
}

function createShootStatusBadge(styleNo, color, { compact = false } = {}) {
  const status = describeShootStatus(styleNo, color);
  const el = document.createElement("span");
  if (!status) {
    setDisplayText(el, EMPTY_DISPLAY);
    return el;
  }
  el.className = "shoot-status";
  el.dataset.tone = status.tone;
  // A scheduled date takes its shoot's type colour (Studio / Editorial).
  if (status.tone === "scheduled") el.dataset.shootType = status.shoots[0].type;
  el.textContent = compact ? status.short ?? status.label : status.label;
  if (compact) el.title = status.label;
  if (status.shoots.length) {
    el.title = (compact ? `${status.label}\n` : "") + status.shoots.map(s => `${getPhotoshootTitle(s)} · ${getPhotoshootTypeLabel(s.type)} · ${formatShootDate(s.date)}${s.model ? ` · ${s.model}` : ""}`).join("\n")
      + "\nClick to open the photoshoot";
    // A camera in front; a click opens the (next) photoshoot on the Photoshoots page.
    el.classList.add("is-link");
    el.setAttribute("role", "link");
    el.tabIndex = 0;
    el.insertAdjacentHTML("afterbegin", SHOOT_STATUS_CAMERA_ICON);
    const open = e => {
      e.preventDefault();
      e.stopPropagation();
      goToPhotoshoot(status.shoots[0].id);
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", e => { if (e.key === "Enter") open(e); });
  }
  return el;
}


// ── Column sorting ───────────────────────────────────────────────────────────
//
// Click a header: ascending → descending → back to the default order. Blank
// values sort last either way. Dates are "YYYY-MM-DD", so they sort as text.

const needSort = { col: null, dir: 1 };
const shootSort = { col: null, dir: 1 };

const NEED_SORT_COLUMNS = {
  styleNo: r => r.styleNo,
  color: r => r.color,
  description: r => r.description,
  type: r => String(SHOOT_REASON_KEYS.indexOf(r.type) + 1 || 9),
  available: r => r.availableDate,
  category: r => r.category,
  season: r => r.season,
  n41: r => r.n41,
  // An old 0026-11-16 shows as 11/16/26, so it sorts as 2026 too.
  ihd: r => fixTwoDigitYear(findStyle(r.styleNo, r.color)?.ihd ?? ""),
  // To decide, then Photoshoot by shoot date (not scheduled last), then CG.
  shoot: r => (!r.method ? "0" : r.method === "photoshoot" ? `1${r.nextDate || "9999"}` : "2"),
  added: r => r.addedAt,
};

const SHOOT_SORT_COLUMNS = {
  date: s => s.date,
  name: s => getPhotoshootTitle(s),
  type: s => getPhotoshootTypeLabel(s.type),
  styles: s => String(s.styles.length).padStart(6, "0"),
};

/**
 * Blanks go last — except with `blankFirstAscending` (IHD columns): soonest
 * first puts the styles with no IHD at the top, latest first at the bottom.
 */
function compareSortValues(a, b, dir, { blankFirstAscending = false } = {}) {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (!x || !y) return ((x ? -1 : 0) + (y ? 1 : 0)) * (blankFirstAscending && dir === 1 ? -1 : 1);
  return dir * x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
}

/** Date columns where soonest first puts the blanks on top. */
const BLANK_FIRST_SORT_COLUMNS = new Set(["ihd"]);

/** Re-sort `rows` in place by the clicked column; the existing order breaks ties. */
function applyColumnSort(rows, sort, columns) {
  if (!sort.col || !columns[sort.col]) return;
  const value = columns[sort.col];
  const opts = { blankFirstAscending: BLANK_FIRST_SORT_COLUMNS.has(sort.col) };
  const order = new Map(rows.map((r, i) => [r, i]));
  rows.sort((a, b) => compareSortValues(value(a), value(b), sort.dir, opts) || order.get(a) - order.get(b));
}

function initColumnSort(tableId, sort, columns, render) {
  const headers = [...document.querySelectorAll(`#${tableId} thead th[data-col]`)];
  headers.forEach(th => {
    if (!columns[th.dataset.col]) {
      th.classList.add("th-no-sort");
      return;
    }
    th.addEventListener("click", () => {
      if (sort.col === th.dataset.col) {
        if (sort.dir === 1) sort.dir = -1;
        else { sort.col = null; sort.dir = 1; }
      } else {
        sort.col = th.dataset.col;
        sort.dir = 1;
      }
      headers.forEach(h => {
        h.classList.remove("sorted-asc", "sorted-desc");
        if (h.dataset.col === sort.col) h.classList.add(sort.dir === 1 ? "sorted-asc" : "sorted-desc");
      });
      render();
    });
  });
}

// ── The two pages ────────────────────────────────────────────────────────────

function isPhotoshootView(view = getCurrentAppView()) {
  return view === "photoshoots" || view === "needToShoot";
}

function renderPhotoshootsView() {
  const need = getCurrentAppView() === "needToShoot";
  document.getElementById("needToolbarControls").hidden = !need;
  document.getElementById("shootsToolbarControls").hidden = need;
  document.getElementById("needTableWrap").hidden = !need;
  document.getElementById("shootsTableWrap").hidden = need;
  document.getElementById("needRowCounter").hidden = !need;
  document.getElementById("shootsRowCounter").hidden = need;
  document.getElementById("needSearchInput").hidden = !need;
  document.getElementById("shootSearchInput").hidden = need;
  document.getElementById("newShootBtn").hidden = need;
  if (need) leaveShootsPage();

  if (need) renderNeedTable(); else renderShootsTable();
}

/** After any change: redraw whatever shows shoot status. */
function refreshPhotoshootViews() {
  // The style pane's details (shoot buttons, IHD) follow changes made in a table.
  const paneStyleNow = paneStyle && findStyle(paneStyle.styleNo, paneStyle.color);
  if (paneStyleNow) renderStylePaneSummary(paneStyleNow);
  if (isPhotoshootView()) renderPhotoshootsView();
  if (getCurrentAppView() === "styles" && typeof renderStylesTable === "function") renderStylesTable();
  if (getCurrentAppView() === "complete") renderCompleteView();
  if (getCurrentAppView() === "pos" && typeof renderPoView === "function") renderPoView();
  // Shoots sit on the Home calendar too.
  refreshCalendarIfActive();
  if (paneShootId) {
    const shoot = getPhotoshootById(paneShootId);
    if (shoot) renderShootPane(shoot); else closeShootPane();
  }
}

// ── Need to Shoot ────────────────────────────────────────────────────────────

/** A list entry joined to its style record (when the database has it). */
function buildNeedRows() {
  return getShootListEntries()
    // Done ones (shot, or CG) are on the Complete page instead.
    .filter(e => !e.shotShootId)
    .map(e => {
      const style = findStyle(e.styleNo, e.color);
      const status = describeShootStatus(e.styleNo, e.color);
      return {
        styleNo: e.styleNo,
        color: e.color,
        description: style?.description ?? "",
        category: style?.category ?? "",
        season: style?.season ?? "",
        n41: style?.status ?? "",
        addedAt: e.addedAt,
        // From its PO, not chosen (js/store.js getShootType).
        type: getShootType(e.styleNo, e.color),
        // Photoshoot / CG — "" until it's decided.
        method: getShootMethod(e.styleNo, e.color),
        availableDate: style?.availableDate ?? "",
        notes: style?.notes ?? "",
        status,
        nextDate: status?.tone === "scheduled" ? status.shoots[0].date : "",
      };
    });
}

// ── IHD months ───────────────────────────────────────────────────────────────
//
// Down the left of Need to Shoot: Show all, No month, then each month (Available, or a real IHD) on the
// list in a folder per year that opens and closes. Picking one filters the
// list to it. Only months some style on the list has are shown.

let needIhdMonth = "all"; // "all" | "none" | "YYYY-MM"
/** Open year folders, by year — this year's to start. */
const needOpenYears = new Set([String(new Date().getFullYear())]);
/** The month whose year was last opened for it — a newly picked month opens its year once. */
let needYearOpenedFor = "";

/**
 * The row's month — its Available month, else its IHD's (styleScheduleMonth);
 * from a PO, the month that PO line is under on the POs page — or "none".
 */
function needIhdMonthKey(r) {
  const style = findStyle(r.styleNo, r.color);
  return (style?.ihdFromPo && style.ihdMonth) || styleScheduleMonth(style, style?.ihd) || "none";
}

function createNeedMonthItem(key, label, count, { top = false, title = "" } = {}) {
  const item = document.createElement("div");
  item.className = "po-month" + (top ? " po-month--top" : "") + (key === needIhdMonth ? " is-active" : "");
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "po-month-pick";
  pick.setAttribute("aria-current", String(key === needIhdMonth));
  const name = document.createElement("span");
  name.className = "po-month-name";
  name.textContent = label;
  if (title) name.title = title;
  const n = document.createElement("span");
  n.className = "po-month-count";
  n.textContent = count.toLocaleString();
  n.title = `${count.toLocaleString()} ${count === 1 ? "style" : "styles"}`;
  pick.append(name, n);
  pick.addEventListener("click", () => {
    needIhdMonth = key;
    renderNeedTable();
  });
  item.appendChild(pick);
  return item;
}

/** `rows`: the list before the month filter, so each count is what picking it shows. */
function renderNeedMonthList(rows) {
  const list = document.getElementById("needMonthList");
  if (!list) return;
  const counts = new Map();
  rows.forEach(r => {
    const key = needIhdMonthKey(r);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  // The picked month stays listed (at 0) while other filters hide all of it.
  if (needIhdMonth !== "all" && !counts.has(needIhdMonth)) counts.set(needIhdMonth, 0);
  const months = [...counts.keys()].filter(k => k !== "none").sort();
  if (needIhdMonth !== needYearOpenedFor && /^\d{4}-\d{2}$/.test(needIhdMonth)) {
    needYearOpenedFor = needIhdMonth;
    needOpenYears.add(needIhdMonth.slice(0, 4));
  }

  const nodes = [createNeedMonthItem("all", "Show all", rows.length, { top: true })];
  if (counts.has("none")) nodes.push(createNeedMonthItem("none", "No month", counts.get("none"), { top: true }));
  const byYear = new Map();
  months.forEach(m => {
    const y = m.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(m);
  });
  byYear.forEach((ms, year) => {
    const open = needOpenYears.has(year);
    const head = document.createElement("button");
    head.type = "button";
    head.className = "po-year";
    head.setAttribute("aria-expanded", String(open));
    head.innerHTML = `<span class="po-year-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>${open ? PO_FOLDER_OPEN_ICON : PO_FOLDER_ICON}`;
    const label = document.createElement("span");
    label.className = "po-year-name";
    label.textContent = year;
    head.appendChild(label);
    head.addEventListener("click", () => {
      if (needOpenYears.has(year)) needOpenYears.delete(year); else needOpenYears.add(year);
      renderNeedTable();
    });
    nodes.push(head);
    if (open) nodes.push(...ms.map(m => createNeedMonthItem(m,
      new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleString(undefined, { month: "long" }),
      counts.get(m), { title: formatPoMonth(m) })));
  });
  list.replaceChildren(...nodes);
}

/**
 * Need to Shoot's default order: Available month, oldest first (none last);
 * in a month, each Style #'s colours together, the Style #s by their
 * soonest IHD (no IHD on top), then Style #; a Style #'s colours by IHD,
 * then colour.
 */
function sortNeedRowsDefault(rows) {
  const month = r => /^\d{4}-\d{2}/.exec(String(r.availableDate ?? ""))?.[0] ?? "";
  const ihd = NEED_SORT_COLUMNS.ihd;
  const groupKey = r => `${month(r)}\u0000${r.styleNo.toUpperCase()}`;
  /** month + Style # → its soonest IHD ("" with none). */
  const groupIhd = new Map();
  rows.forEach(r => {
    const key = groupKey(r);
    const d = ihd(r);
    const best = groupIhd.get(key);
    if (best === undefined || (d && (!best || d < best))) groupIhd.set(key, d);
  });
  const blankFirst = { blankFirstAscending: true };
  rows.sort((a, b) => compareSortValues(month(a), month(b), 1) ||
    compareSortValues(groupIhd.get(groupKey(a)), groupIhd.get(groupKey(b)), 1, blankFirst) ||
    a.styleNo.localeCompare(b.styleNo, undefined, { numeric: true }) ||
    compareSortValues(ihd(a), ihd(b), 1, blankFirst) ||
    a.color.localeCompare(b.color));
  return rows;
}

function renderNeedTable() {
  const q = (document.getElementById("needSearchInput")?.value ?? "").trim().toLowerCase();
  setActiveSearchQuery(q);

  const preMonthRows = buildNeedRows().filter(r => {
    if (needFilter === "undecided" && r.method) return false;
    if ((needFilter === "photoshoot" || needFilter === "cg") && r.method !== needFilter) return false;
    if (needReasonFilter !== "all" && r.type !== needReasonFilter) return false;
    if (!columnFilterPasses("needTable", "ihd", monthFilterKey(findStyle(r.styleNo, r.color)?.ihd))) return false;
    if (!columnFilterPasses("needTable", "n41", statusFilterKey(r.n41))) return false;
    if (!columnFilterPasses("needTable", "type", r.type || BLANK_FILTER_LABEL)) return false;
    if (!columnFilterPasses("needTable", "available", monthFilterKey(r.availableDate))) return false;
    if (!q) return true;
    return `${r.styleNo} ${r.color} ${r.description} ${r.category} ${r.season} ${getShootReasonLabel(r.type)} ${getShootMethodLabel(r.method)} ${r.notes}`.toLowerCase().includes(q);
  });
  renderNeedMonthList(preMonthRows);
  filteredNeedRows = needIhdMonth === "all" ? preMonthRows : preMonthRows.filter(r => needIhdMonthKey(r) === needIhdMonth);
  sortNeedRowsDefault(filteredNeedRows);
  applyColumnSort(filteredNeedRows, needSort, NEED_SORT_COLUMNS);
  // A set's pieces sit together, where the first of them sorted to.
  const needBlocks = groupBySet(filteredNeedRows);
  filteredNeedRows = needBlocks.flat();
  /** row → its set's block number, for the rows of a set showing more than one piece. */
  const setOf = new Map();
  needBlocks.forEach((b, i) => { if (b.length > 1) b.forEach(r => setOf.set(r, i)); });
  // One level up: neighbouring blocks of the same Style # (or set) in the same
  // Available month — J2644 BLUE, GREEN, YELLOW; a set in two colours.
  const familyOf = familyRuns(needBlocks, r => `${/^\d{4}-\d{2}/.exec(r.availableDate ?? "")?.[0] ?? ""}\u0000${styleFamilyKey(r.styleNo)}`);
  const pagedFor = [needFilter, needReasonFilter, needIhdMonth, q].join("|");
  needPage = pagedFor === needPagedFor ? clampTablePage(needPage, filteredNeedRows.length, needPageSize) : 1;
  needPagedFor = pagedFor;

  document.querySelectorAll("#needFilters .filter-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.filter === needFilter));
  document.querySelectorAll("#needReasonFilters .filter-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.reason === needReasonFilter));
  const counter = document.getElementById("needRowCounter");
  if (counter) counter.textContent = filteredNeedRows.length === 1 ? "1 style" : `${filteredNeedRows.length.toLocaleString()} styles`;

  const tbody = document.getElementById("needTableBody");
  const cols = [...document.querySelectorAll("#needTable thead th[data-col]")].map(th => th.dataset.col);
  if (filteredNeedRows.length === 0) {
    const msg = getShootListEntries().length === 0
      ? "Nothing to shoot yet — use Add suggested on the POs page, or tick styles in the Styles tab."
      : "No styles match the current filters.";
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(msg)}</td></tr>`;
    syncNeedSelectionUi();
    renderNeedPager();
    return;
  }

  const pageRows = filteredNeedRows.slice((needPage - 1) * needPageSize, needPage * needPageSize);
  // Places on this page, so a group cut by the page break still closes at the edge.
  const setPlace = groupPlaces(pageRows, setOf);
  const familyPlace = groupPlaces(pageRows, familyOf);
  tbody.replaceChildren(...pageRows.map(r => {
    const key = styleKey(r.styleNo, r.color);
    const tr = document.createElement("tr");
    tr.className = "clickable-row";
    tr.dataset.styleNo = r.styleNo;
    tr.dataset.color = r.color;
    if (setPlace.has(r)) {
      tr.classList.add("set-row");
      tr.dataset.setPlace = setPlace.get(r);
    }
    if (familyPlace.has(r)) {
      tr.classList.add("family-row");
      tr.dataset.familyPlace = familyPlace.get(r);
    }
    cols.forEach(col => {
      const td = document.createElement("td");
      td.dataset.col = col;
      switch (col) {
        case "select": {
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.className = "row-select";
          cb.checked = needSelectedKeys.has(key);
          cb.setAttribute("aria-label", `Select ${r.styleNo} ${r.color}`);
          cb.addEventListener("change", () => {
            if (cb.checked) needSelectedKeys.add(key); else needSelectedKeys.delete(key);
            syncNeedSelectionUi();
          });
          td.appendChild(cb);
          break;
        }
        case "image": td.appendChild(createStyleThumb(r.styleNo, r.color)); break;
        case "styleNo": {
          mountSearchHighlightedText(td, r.styleNo);
          if (setPlace.has(r)) td.appendChild(createSetTag(r.styleNo, r.color));
          break;
        }
        case "type": td.appendChild(createShootTypePill(r.styleNo, r.color)); break;
        case "available": {
          const pill = createAvailablePill(r.availableDate, findStyle(r.styleNo, r.color));
          if (pill) td.appendChild(pill); else setDisplayText(td, EMPTY_DISPLAY);
          break;
        }
        case "shoot": td.appendChild(createStyleShootCell(findStyle(r.styleNo, r.color) ?? { styleNo: r.styleNo, color: r.color, status: r.n41 })); break;
        case "n41": td.appendChild(createStyleStatusPill(r.n41)); break;
        case "ihd": {
          // Editable here too.
          const style = findStyle(r.styleNo, r.color);
          if (style) td.appendChild(createIhdInput(style, { onSaved: refreshPhotoshootViews }));
          else setDisplayText(td, EMPTY_DISPLAY);
          break;
        }
        case "added": setDisplayText(td, r.addedAt ? formatLongDate(r.addedAt.slice(0, 10)) : EMPTY_DISPLAY); break;
        case "notes": {
          const style = findStyle(r.styleNo, r.color);
          if (style) td.appendChild(createStyleNotesInput(style, { onSaved: refreshStylePaneSummary }));
          else setDisplayText(td, EMPTY_DISPLAY);
          break;
        }
        default:
          mountSearchHighlightedText(td, r[col] ?? "");
          if (col === "description" && r.description) td.title = r.description;
      }
      tr.appendChild(td);
    });
    return tr;
  }));
  renderNeedPager();
  syncNeedSelectionUi();
  syncStylePaneRows();
}

/** Type header filter: the types on the list, in New Style / New Color / Recut / Reshoot order, then none. */
function needTypeFilterOptions(rows) {
  const counts = new Map();
  rows.forEach(r => {
    const key = r.type || BLANK_FILTER_LABEL;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const rank = key => (key === BLANK_FILTER_LABEL ? SHOOT_REASON_KEYS.length : SHOOT_REASON_KEYS.indexOf(key));
  return [...counts.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map(key => ({ key, label: key === BLANK_FILTER_LABEL ? "No type" : getShootReasonLabel(key), count: counts.get(key) }));
}

/** Available header filter: the months on the list (as the pills show them, JAN 27), oldest first, then none. */
function needAvailableFilterOptions(rows) {
  const counts = new Map();
  rows.forEach(r => {
    const key = monthFilterKey(r.availableDate);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.keys()]
    .sort((a, b) => (a === BLANK_FILTER_LABEL) - (b === BLANK_FILTER_LABEL) || a.localeCompare(b))
    .map(key => ({ key, label: key === BLANK_FILTER_LABEL ? "No Available date" : formatMonYY(key), count: counts.get(key) }));
}

/**
 * `groupOf`: row → group id (rows not in a group are left out). Returns row →
 * "first" | "mid" | "last" | "only" for each grouped row, by where it sits
 * among its neighbours in `rows`.
 */
function groupPlaces(rows, groupOf) {
  const places = new Map();
  rows.forEach((r, i) => {
    if (!groupOf.has(r)) return;
    const id = groupOf.get(r);
    const first = i === 0 || groupOf.get(rows[i - 1]) !== id;
    const last = i === rows.length - 1 || groupOf.get(rows[i + 1]) !== id;
    places.set(r, first && last ? "only" : first ? "first" : last ? "last" : "mid");
  });
  return places;
}

/** The small SET tag beside a Style #; the tooltip names the other pieces. */
function createSetTag(styleNo, color) {
  const tag = document.createElement("span");
  tag.className = "set-tag";
  tag.textContent = "SET";
  const mates = getSetMates(styleNo, color).map(s => s.styleNo);
  tag.title = mates.length ? `A set with ${mates.join(", ")} — kept together` : "A set — kept together";
  return tag;
}

function renderNeedPager() {
  renderTablePager("needPager", {
    total: filteredNeedRows.length,
    page: needPage,
    pageSize: needPageSize,
    noun: "Styles",
    onPage: n => {
      needPage = n;
      renderNeedTable();
      document.querySelector("#needTableWrap > .table-scroll-y")?.scrollTo({ top: 0 });
    },
    onPageSize: n => {
      needPageSize = n;
      saveTablePageSize("needTable", n);
      needPage = 1;
      renderNeedTable();
    },
  });
}

function getSelectedNeedStyles() {
  return getShootListEntries()
    .filter(e => needSelectedKeys.has(styleKey(e.styleNo, e.color)))
    .map(e => ({ styleNo: e.styleNo, color: e.color }));
}

function syncNeedSelectionUi() {
  // Drop ticks for rows that are no longer on the list.
  needSelectedKeys = new Set([...needSelectedKeys].filter(k => shootList.has(k)));
  const all = document.getElementById("needSelectAll");
  if (all) {
    const picked = filteredNeedRows.filter(r => needSelectedKeys.has(styleKey(r.styleNo, r.color))).length;
    all.checked = picked > 0 && picked === filteredNeedRows.length;
    all.indeterminate = picked > 0 && picked < filteredNeedRows.length;
  }
  const bar = document.getElementById("needSelectionBar");
  if (bar) bar.hidden = needSelectedKeys.size === 0;
  const count = document.getElementById("needSelectionCount");
  if (count) count.textContent = `${needSelectedKeys.size.toLocaleString()} selected`;

  // Existing planned shoots to add the selection to.
  const select = document.getElementById("needAddToShootSelect");
  if (select) {
    const planned = getAllPhotoshoots().filter(s => s.status === "planned").sort((a, b) => a.date.localeCompare(b.date));
    const current = select.value;
    select.replaceChildren(
      new Option(planned.length ? "Add to shoot…" : "No planned shoots", ""),
      ...planned.map(s => new Option(`${formatShootDate(s.date)} · ${getPhotoshootTitle(s)} (${s.styles.length})`, s.id)),
    );
    select.value = planned.some(s => s.id === current) ? current : "";
    select.disabled = planned.length === 0;
  }
}

async function addNeedSelectionToShoot(shootId) {
  const styles = getSelectedNeedStyles();
  if (!shootId || !styles.length) return;
  try {
    const added = await addStylesToPhotoshoot(shootId, styles);
    const shoot = getPhotoshootById(shootId);
    needSelectedKeys = new Set();
    refreshPhotoshootViews();
    showIndicator(`${added} added to ${getPhotoshootTitle(shoot)} (${formatShootDate(shoot.date)})`, "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't add to the shoot.", "error");
  }
}

/** Photoshoot or CG for every ticked style (and the waiting pieces of their sets). */
async function setNeedSelectionMethod(method) {
  const styles = getSelectedNeedStyles();
  if (!styles.length) return;
  if (method === "cg") {
    const inShoots = styles.filter(s => getPlannedShootsFor(s.styleNo, s.color).length).length;
    if (inShoots && !confirm(`${inShoots} of them ${inShoots === 1 ? "is" : "are"} in a planned shoot. Take ${inShoots === 1 ? "it" : "them"} out and go with CG?`)) return;
  }
  try {
    const result = await setShootMethod(styles, method);
    needSelectedKeys = new Set();
    refreshPhotoshootViews();
    showIndicator(shootMethodMessage(`${result.count} ${result.count === 1 ? "style" : "styles"}`, method, result), "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't save.", "error");
  }
}

async function removeNeedSelection() {
  const styles = getSelectedNeedStyles();
  if (!styles.length) return;
  const inShoots = styles.filter(s => getPlannedShootsFor(s.styleNo, s.color).length).length;
  const extra = inShoots ? `\n\n${inShoots} of them ${inShoots === 1 ? "is" : "are"} in a planned shoot and will come out of it.` : "";
  if (!confirm(`Take ${styles.length} ${styles.length === 1 ? "style" : "styles"} off Need to Shoot?${extra}`)) return;
  try {
    await removeFromPlannedShoots(styles);
    await removeFromShootList(styles);
    needSelectedKeys = new Set();
    refreshPhotoshootViews();
    showIndicator("Removed from Need to Shoot", "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't remove.", "error");
  }
}

// ── Shoots list ──────────────────────────────────────────────────────────────

function renderShootsTable() {
  const q = (document.getElementById("shootSearchInput")?.value ?? "").trim().toLowerCase();
  setActiveSearchQuery(q);
  const rows = getAllPhotoshoots().filter(s => {
    if (shootFilter !== "all" && s.status !== shootFilter) return false;
    if (!q) return true;
    return `${getPhotoshootTitle(s)} ${s.model} ${getPhotoshootTypeLabel(s.type)} ${s.notes} ${s.styles.map(x => x.styleNo).join(" ")}`.toLowerCase().includes(q);
  });
  // Planned: soonest first. Complete: most recent first.
  rows.sort((a, b) => (shootFilter === "complete" ? -1 : 1) * a.date.localeCompare(b.date));
  applyColumnSort(rows, shootSort, SHOOT_SORT_COLUMNS);

  document.querySelectorAll("#shootFilters .filter-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.filter === shootFilter));
  const counter = document.getElementById("shootsRowCounter");
  if (counter) counter.textContent = rows.length === 1 ? "1 shoot" : `${rows.length} shoots`;

  const tbody = document.getElementById("shootsTableBody");
  const cols = [...document.querySelectorAll("#shootsTable thead th[data-col]")].map(th => th.dataset.col);
  // The list picks what the rest of the page shows: keep the open shoot if
  // it's still listed, else the first one (redraws from there).
  if (getCurrentAppView() === "photoshoots" && !rows.some(s => s.id === paneShootId)) {
    if (rows.length) return openShootPane(rows[0].id);
    closeShootPane();
  }
  if (rows.length === 0) {
    const msg = getAllPhotoshoots().length === 0
      ? "No shoots yet — tick styles on Need to Shoot and use Create photoshoot."
      : "No shoots match the current filters.";
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(msg)}</td></tr>`;
    return;
  }
  const today = todayYmd();
  tbody.replaceChildren(...rows.map(s => {
    const tr = document.createElement("tr");
    tr.className = "clickable-row" + (s.id === paneShootId ? " is-pane-row" : "");
    tr.dataset.shootId = s.id;
    cols.forEach(col => {
      const td = document.createElement("td");
      td.dataset.col = col;
      switch (col) {
        case "date": {
          setDisplayText(td, formatShootDateMd(s.date));
          if (s.status === "planned" && s.date && s.date < today) td.classList.add("is-overdue");
          break;
        }
        case "name": mountSearchHighlightedText(td, getPhotoshootTitle(s)); break;
        case "type": {
          const pill = document.createElement("span");
          pill.className = "shoot-type";
          pill.dataset.type = s.type;
          pill.textContent = getPhotoshootTypeLabel(s.type);
          td.appendChild(pill);
          break;
        }
        case "styles": {
          td.textContent = String(s.styles.length);
          td.title = s.styles.length === 1 ? "1 style" : `${s.styles.length} styles`;
          break;
        }
      }
      tr.appendChild(td);
    });
    return tr;
  }));
}

// ── Shoot pane ───────────────────────────────────────────────────────────────

function renderShootPane(shoot) {
  document.getElementById("shootPaneTitle").textContent = getPhotoshootTitle(shoot);
  // Everything about the shoot on the line under its name.
  const count = shoot.styles.length === 1 ? "1 style" : `${shoot.styles.length} styles`;
  document.getElementById("shootPaneSubtitle").textContent = [
    formatShootDateMd(shoot.date),
    getPhotoshootTypeLabel(shoot.type),
    shoot.model,
    count,
    shoot.status === "complete" && shoot.completedAt ? `Completed ${formatShootDateMd(shoot.completedAt)}` : "",
  ].filter(Boolean).join(" · ");
  const notes = document.getElementById("shootPaneNotes");
  if (notes) {
    notes.textContent = shoot.notes;
    notes.hidden = !shoot.notes;
  }
  const status = document.getElementById("shootPaneStatus");
  status.dataset.tone = shoot.status === "complete" ? "shot" : "scheduled";
  status.textContent = shoot.status === "complete" ? "Complete" : "Planned";

  // Menu ⋮: Mark shoot complete, or Reopen once it is.
  const complete = document.getElementById("shootMenuComplete");
  if (complete) {
    const done = shoot.status === "complete";
    complete.querySelector("span").textContent = done ? "Reopen shoot" : "Mark shoot complete";
    complete.title = done
      ? "Its styles are recorded as shot. Reopening puts them back on Need to Shoot."
      : "Marks every style in it as shot — they leave Need to Shoot. Remove any that weren't shot first.";
    complete.disabled = !done && shoot.styles.length === 0;
  }

  const list = document.getElementById("shootPaneStyles");
  document.getElementById("shootPaneStylesHead").hidden = shoot.styles.length === 0;
  if (shoot.styles.length === 0) {
    list.replaceChildren(Object.assign(document.createElement("div"), { className: "item-tasks-empty", textContent: "No styles yet — pick Photoshoot for them on Need to Shoot." }));
    return;
  }
  // One block per style — or per set, whose pieces sit in a box and move as one.
  const blocks = getShootBlocks(shoot);
  // Neighbouring blocks of one Style # (or set), any colour, share an outer
  // box. Only a frame: dragging and ↑ / ↓ still move single blocks.
  const familyOf = familyRuns(blocks, s => styleFamilyKey(s.styleNo));
  let index = 0;
  const nodes = [];
  let family = null;
  blocks.forEach((block, b) => {
    const rows = block.map(s => createShootStyleRow(shoot, s, index++, b, blocks.length, block.length > 1));
    const el = rows.length === 1 ? rows[0] : Object.assign(document.createElement("div"), { className: "shoot-set" });
    if (rows.length > 1) el.append(...rows);
    el.classList.add("shoot-block");
    el.dataset.block = String(b);
    const run = familyOf.get(block[0]);
    if (!run) {
      family = null;
      nodes.push(el);
      return;
    }
    if (family?.dataset.run !== String(run)) {
      family = Object.assign(document.createElement("div"), { className: "shoot-family" });
      family.dataset.run = String(run);
      nodes.push(family);
    }
    family.appendChild(el);
  });
  list.replaceChildren(...nodes);
}

/**
 * A shoot's styles in blocks (js/store.js groupBySet). If a set's pieces had
 * drifted apart in the saved order, the shoot takes the tidied order — it's
 * saved with the next change to the shoot.
 */
function getShootBlocks(shoot) {
  const blocks = groupBySet(shoot.styles);
  const flat = blocks.flat();
  if (flat.some((s, i) => s !== shoot.styles[i])) shoot.styles = flat;
  return blocks;
}

/**
 * One style's row. `index` is its place in the shoot, `block` its block's
 * (of `blockCount`); `inSet` when the block is a set of several pieces.
 */
function createShootStyleRow(shoot, s, index, block, blockCount, inSet) {
  const style = findStyle(s.styleNo, s.color);
  const row = document.createElement("div");
  row.className = "shoot-style-row";
  // Right-clicking the style copies its number (js/copy-menu.js).
  row.dataset.styleNo = s.styleNo;
  row.dataset.color = s.color;
  if (paneStyle && paneStyle.styleNo === s.styleNo && paneStyle.color === s.color) row.classList.add("is-pane-open");
  // The grip drags its block (the style, or its whole set) to another place.
  const grip = document.createElement("span");
  grip.className = "shoot-style-grip";
  grip.title = inSet ? "Drag to reorder — the set moves together" : "Drag to reorder";
  grip.setAttribute("aria-hidden", "true");
  grip.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" fill="currentColor" viewBox="0 0 12 16"><circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="9" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="9" cy="13" r="1.4"/></svg>';
  grip.addEventListener("pointerdown", () => {
    const el = row.closest(".shoot-block");
    if (el) el.draggable = true;
  });
  const num = document.createElement("span");
  num.className = "shoot-style-num";
  num.textContent = String(index + 1);
  // ↑ / ↓: swap its block with the one above / below.
  const move = document.createElement("span");
  move.className = "shoot-style-move";
  [["up", -1, "Move up", "M6 15l6-6 6 6"], ["down", 1, "Move down", "M6 9l6 6 6-6"]].forEach(([dir, delta, label, path]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "shoot-move-btn";
    b.dataset.dir = dir;
    b.title = inSet ? `${label} — the set moves together` : label;
    b.setAttribute("aria-label", `${label}: ${s.styleNo} ${s.color}`);
    b.disabled = delta < 0 ? block === 0 : block === blockCount - 1;
    b.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    b.addEventListener("click", () => stepShootBlock(shoot.id, block, delta));
    move.appendChild(b);
  });
  row.append(grip, num, move);
  // A set's pieces: this row's part of the [ joining their Style #s (crm.css).
  if (inSet) row.appendChild(Object.assign(document.createElement("span"), { className: "shoot-set-bracket" }));
  const thumb = createStyleThumb(s.styleNo, s.color);
  thumb.addEventListener("click", () => openStyleGallery(s.styleNo, s.color));
  const cell = (className, text = "") => {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    if (text) el.title = text;
    return el;
  };
  // Style # large, its Color beside it a little lighter.
  const name = cell("shoot-style-name");
  const no = document.createElement("strong");
  no.textContent = s.styleNo;
  const col = document.createElement("span");
  col.textContent = s.color;
  name.append(no, col);
  name.title = `${s.styleNo} · ${s.color}`;
  if (inSet) name.appendChild(createSetTag(s.styleNo, s.color));
  row.append(thumb, name);

  // The type, from its PO — and the yellow TOP pill (js/styles.js).
  const type = cell("shoot-style-type");
  type.appendChild(createShootTypePill(s.styleNo, s.color));
  addStyleTopPill(type, style ?? s);
  row.append(type, cell("shoot-style-desc shoot-col-desc", style ? style.description : "Not in the Styles database"));

  const avail = cell("shoot-style-avail shoot-col-avail");
  const pill = style && createAvailablePill(style.availableDate, style);
  if (pill) avail.appendChild(pill); else avail.textContent = EMPTY_DISPLAY;
  row.appendChild(avail);

  // IHD, editable here.
  const ihd = cell("shoot-style-ihd shoot-col-ihd");
  if (style) ihd.appendChild(createIhdInput(style, { onSaved: refreshPhotoshootViews }));
  row.appendChild(ihd);

  // The style's notes — the same ones as on POs, Need to Shoot and Styles.
  const notes = cell("shoot-style-notes shoot-col-notes");
  if (style) notes.appendChild(createStyleNotesInput(style, { onSaved: refreshStylePaneSummary }));
  row.appendChild(notes);

  const end = cell("shoot-style-end");
  if (shoot.status === "planned") {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-close";
    remove.textContent = "✕";
    remove.title = inSet ? "Remove the set from this shoot (stays on Need to Shoot)" : "Remove from this shoot (stays on Need to Shoot)";
    remove.setAttribute("aria-label", `Remove ${s.styleNo} ${s.color} from this shoot`);
    remove.addEventListener("click", () => removeStyleFromShoot(shoot.id, s));
    end.appendChild(remove);
  }
  row.appendChild(end);
  return row;
}

// ── Reordering a shoot's styles ──────────────────────────────────────────────
//
// Drag a block by its grip — a style, or a set with all its pieces; a line
// shows where it will go. The order is the shoot's own (its styles list),
// saved as soon as it's dropped.

let shootDragFrom = -1;

function clearShootDropMarks(list) {
  list.querySelectorAll(".is-drop-before, .is-drop-after, .is-dragging").forEach(el => el.classList.remove("is-drop-before", "is-drop-after", "is-dragging"));
}

/** Where a drop at clientY lands: the index of the block the dragged one ends up before. */
function shootDropIndex(list, clientY) {
  const blocks = [...list.querySelectorAll(".shoot-block")];
  const at = blocks.findIndex(r => {
    const box = r.getBoundingClientRect();
    return clientY < box.top + box.height / 2;
  });
  return at < 0 ? blocks.length : at;
}

/**
 * The new order shows at once and is saved `delay` ms later — the arrow keys
 * wait for a pause, so a run of presses is one save. A failed save puts back
 * the order from before the first unsaved move.
 */
let shootOrderPending = null; // { id, before, timer }

function setShootOrder(shoot, styles, delay = 0) {
  if (shootOrderPending && shootOrderPending.id !== shoot.id) flushShootOrder();
  if (!shootOrderPending) shootOrderPending = { id: shoot.id, before: shoot.styles, timer: 0 };
  shoot.styles = styles;
  renderShootPane(shoot);
  clearTimeout(shootOrderPending.timer);
  shootOrderPending.timer = setTimeout(flushShootOrder, delay);
}

async function flushShootOrder() {
  const pending = shootOrderPending;
  if (!pending) return;
  shootOrderPending = null;
  clearTimeout(pending.timer);
  const shoot = getPhotoshootById(pending.id);
  if (!shoot) return;
  try {
    await updatePhotoshoot(shoot.id, { styles: shoot.styles });
  } catch (err) {
    shoot.styles = pending.before;
    if (paneShootId === shoot.id) renderShootPane(shoot);
    showIndicator(err.message || "Couldn't save the new order.", "error");
  }
}

/** A dropped block: from its place to before block `to`. */
function moveShootBlock(shootId, from, to) {
  const shoot = getPhotoshootById(shootId);
  if (!shoot || from < 0) return;
  const before = shoot.styles;
  const blocks = getShootBlocks(shoot);
  const [moved] = blocks.splice(from, 1);
  if (!moved) return;
  blocks.splice(to > from ? to - 1 : to, 0, moved);
  const styles = blocks.flat();
  if (styles.every((s, i) => s === before[i])) return;
  setShootOrder(shoot, styles);
}

/** A row's ↑ / ↓ buttons: swap its block with the one above / below. */
function stepShootBlock(shootId, index, delta) {
  const shoot = getPhotoshootById(shootId);
  if (!shoot) return;
  const blocks = getShootBlocks(shoot);
  const j = index + delta;
  if (j < 0 || j >= blocks.length) return;
  [blocks[index], blocks[j]] = [blocks[j], blocks[index]];
  setShootOrder(shoot, blocks.flat(), 600);
}

function initShootStyleReorder() {
  const list = document.getElementById("shootPaneStyles");
  if (!list) return;
  list.addEventListener("dragstart", e => {
    const block = e.target.closest?.(".shoot-block");
    if (!block?.draggable) { e.preventDefault(); return; }
    shootDragFrom = Number(block.dataset.block);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", block.querySelector("[data-style-no]")?.dataset.styleNo ?? block.dataset.styleNo ?? "");
    requestAnimationFrame(() => block.classList.add("is-dragging"));
  });
  list.addEventListener("dragover", e => {
    if (shootDragFrom < 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const blocks = [...list.querySelectorAll(".shoot-block")];
    const to = shootDropIndex(list, e.clientY);
    blocks.forEach(r => r.classList.remove("is-drop-before", "is-drop-after"));
    if (to < blocks.length) blocks[to].classList.add("is-drop-before");
    else blocks[blocks.length - 1]?.classList.add("is-drop-after");
  });
  list.addEventListener("drop", e => {
    if (shootDragFrom < 0) return;
    e.preventDefault();
    const from = shootDragFrom;
    const to = shootDropIndex(list, e.clientY);
    shootDragFrom = -1;
    clearShootDropMarks(list);
    if (paneShootId) moveShootBlock(paneShootId, from, to);
  });
  list.addEventListener("dragend", e => {
    shootDragFrom = -1;
    clearShootDropMarks(list);
    const block = e.target.closest?.(".shoot-block");
    if (block) block.draggable = false;
  });
  // Click a row (not its buttons, photo, IHD or notes): that style's pane on the right.
  list.addEventListener("click", e => {
    const row = e.target.closest(".shoot-style-row");
    if (!row || e.target.closest("button, input, a, .style-thumb, .cell-date, .shoot-style-grip")) return;
    openStylePane(row.dataset.styleNo, row.dataset.color);
  });
  // A grip pressed but not dragged: the block stops being draggable again.
  document.addEventListener("pointerup", () => {
    if (shootDragFrom < 0) list.querySelectorAll(".shoot-block[draggable='true']").forEach(r => { r.draggable = false; });
  });
}

// ── Docking ──────────────────────────────────────────────────────────────────
//
// On the Photoshoots page the pane fills the page beside the shoots list
// (#shootDock); anywhere else (Home) it floats over the page as before.

let shootPaneHome = null; // { parent, next } — where it lives when floating

function isShootPaneDocked() {
  return Boolean(document.getElementById("shootPane")?.classList.contains("is-docked"));
}

function setShootPaneDocked(docked) {
  const pane = document.getElementById("shootPane");
  const dock = document.getElementById("shootDock");
  if (!pane || !dock || isShootPaneDocked() === docked) return;
  if (docked) {
    shootPaneHome = { parent: pane.parentElement, next: pane.nextSibling };
    dock.appendChild(pane);
  } else if (shootPaneHome) {
    shootPaneHome.parent.insertBefore(pane, shootPaneHome.next);
  }
  pane.classList.toggle("is-docked", docked);
}

function syncShootDockEmpty() {
  const empty = document.getElementById("shootDockEmpty");
  if (empty) empty.hidden = Boolean(paneShootId && isShootPaneDocked());
}

/** Leaving the Photoshoots page: the docked pane goes with it. */
function leaveShootsPage() {
  if (!isShootPaneDocked()) return;
  closeShootPane();
  setShootPaneDocked(false);
}

function openShootPane(id) {
  const shoot = getPhotoshootById(id);
  const pane = document.getElementById("shootPane");
  if (!shoot || !pane) return;
  // One pane at a time — on Home it can be opened over a campaign's.
  closeItemPane();
  closeStylePane();
  setShootPaneDocked(getCurrentAppView() === "photoshoots");
  const changed = paneShootId !== shoot.id;
  if (changed) {
    flushShootOrder(); // a waiting ↑ / ↓ save for the shoot being left
  }
  paneShootId = shoot.id;
  renderShootPane(shoot);
  closeShootPaneMenu();
  pane.hidden = false;
  if (changed) pane.querySelector(".item-pane-body")?.scrollTo({ top: 0 });
  syncShootDockEmpty();
  if (getCurrentAppView() === "photoshoots") renderShootsTable();
}

function closeShootPane() {
  if (!paneShootId) return;
  paneShootId = null;
  closeShootPaneMenu();
  const pane = document.getElementById("shootPane");
  if (pane) pane.hidden = true;
  syncShootDockEmpty();
  if (getCurrentAppView() === "photoshoots") renderShootsTable();
  // On Home, the card and calendar day lit up for this shoot go with it.
  if (typeof clearCalGroupSelection === "function") clearCalGroupSelection();
}

function closeShootPaneMenu() {
  const menu = document.getElementById("shootPaneMenu");
  if (menu) menu.hidden = true;
  document.getElementById("shootPaneMenuBtn")?.setAttribute("aria-expanded", "false");
}

async function setShootComplete(id, complete) {
  const shoot = getPhotoshootById(id);
  if (!shoot) return;
  if (complete && !confirm(`Mark ${getPhotoshootTitle(shoot)} complete? Its ${shoot.styles.length} ${shoot.styles.length === 1 ? "style is" : "styles are"} recorded as shot and leave Need to Shoot.`)) return;
  try {
    if (complete) await completePhotoshoot(id); else await reopenPhotoshoot(id);
    refreshPhotoshootViews();
    showIndicator(complete ? `${getPhotoshootTitle(shoot)} complete — ${shoot.styles.length} shot` : "Shoot reopened — its styles are back on Need to Shoot", "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't update the shoot.", "error");
  }
}

async function removeStyleFromShoot(id, style) {
  const shoot = getPhotoshootById(id);
  if (!shoot) return;
  // A set leaves together.
  const key = styleSetKey(style.styleNo, style.color);
  const styles = key ? shoot.styles.filter(s => styleSetKey(s.styleNo, s.color) === key) : [style];
  try {
    await removeStylesFromPhotoshoot(id, styles);
    refreshPhotoshootViews();
  } catch (err) {
    showIndicator(err.message || "Couldn't remove it from the shoot.", "error");
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initPhotoshoots() {
  needPageSize = readTablePageSize("needTable");
  // The Shoot cell menu closes on any click elsewhere, Esc, or a scroll.
  document.addEventListener("click", closeShootMenu);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeShootMenu(); });
  document.addEventListener("scroll", e => { if (!e.target.closest?.("#shootMenu")) closeShootMenu(); }, true);
  initColumnSort("needTable", needSort, NEED_SORT_COLUMNS, renderNeedTable);
  initColumnSort("shootsTable", shootSort, SHOOT_SORT_COLUMNS, renderShootsTable);
  initColumnFilter("needTable", "ihd", {
    options: () => monthFilterOptions(buildNeedRows().map(r => findStyle(r.styleNo, r.color)?.ihd ?? "")),
    onChange: renderNeedTable,
    sortable: true,
  });
  initColumnFilter("needTable", "type", {
    options: () => needTypeFilterOptions(buildNeedRows()),
    onChange: renderNeedTable,
  });
  initColumnFilter("needTable", "available", {
    options: () => needAvailableFilterOptions(buildNeedRows()),
    onChange: renderNeedTable,
  });
  initColumnFilter("needTable", "n41", {
    options: () => statusFilterOptions(buildNeedRows().map(r => r.n41)),
    onChange: renderNeedTable,
    hideByDefault: isStatusHiddenByDefault,
    sortable: true,
  });

  // Need to Shoot controls.
  document.querySelectorAll("#needFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => { needFilter = btn.dataset.filter; renderNeedTable(); });
  });
  document.querySelectorAll("#needReasonFilters .filter-btn").forEach(btn => {
    // The same T-shirt / paint bucket / scissors as the type pills.
    if (btn.dataset.reason !== "all") btn.innerHTML = shootReasonIcon(btn.dataset.reason);
    btn.addEventListener("click", () => { needReasonFilter = btn.dataset.reason; renderNeedTable(); });
  });
  document.getElementById("needSearchInput")?.addEventListener("input", renderNeedTable);
  document.getElementById("needSelectAll")?.addEventListener("change", e => {
    filteredNeedRows.forEach(r => {
      const key = styleKey(r.styleNo, r.color);
      if (e.target.checked) needSelectedKeys.add(key); else needSelectedKeys.delete(key);
    });
    renderNeedTable();
  });
  document.getElementById("needTableBody")?.addEventListener("click", e => {
    if (e.target.closest('td[data-col="select"]')) {
      if (e.target.tagName !== "INPUT") e.target.closest("td").querySelector("input")?.click();
      return;
    }
    if (e.target.closest('td[data-col="ihd"], td[data-col="notes"], .shoot-picker')) return;
    const tr = e.target.closest("tr[data-style-no]");
    if (tr) openStylePane(tr.dataset.styleNo, tr.dataset.color);
  });
  document.getElementById("needCreateShootBtn")?.addEventListener("click", () => openPhotoshootForm(null, getSelectedNeedStyles()));
  document.getElementById("needAddToShootSelect")?.addEventListener("change", e => addNeedSelectionToShoot(e.target.value));
  document.getElementById("needRemoveBtn")?.addEventListener("click", removeNeedSelection);
  document.querySelectorAll("#needSelectionBar [data-method]").forEach(btn => {
    btn.addEventListener("click", () => setNeedSelectionMethod(btn.dataset.method));
  });
  document.getElementById("needClearSelectionBtn")?.addEventListener("click", () => { needSelectedKeys = new Set(); renderNeedTable(); });

  // Shoots controls.
  document.querySelectorAll("#shootFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => { shootFilter = btn.dataset.filter; renderShootsTable(); });
  });
  document.getElementById("shootSearchInput")?.addEventListener("input", renderShootsTable);
  document.getElementById("newShootBtn")?.addEventListener("click", () => openPhotoshootForm(null, []));
  document.getElementById("shootsTableBody")?.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-shoot-id]");
    if (tr) openShootPane(tr.dataset.shootId);
  });

  // Pane.
  const menuBtn = document.getElementById("shootPaneMenuBtn");
  const menu = document.getElementById("shootPaneMenu");
  menuBtn?.addEventListener("click", e => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  document.addEventListener("click", e => {
    if (!menu || menu.hidden) return;
    if (menu.contains(e.target) || menuBtn.contains(e.target)) return;
    closeShootPaneMenu();
  });
  document.getElementById("shootMenuComplete")?.addEventListener("click", () => {
    closeShootPaneMenu();
    const shoot = getPhotoshootById(paneShootId);
    if (shoot) setShootComplete(shoot.id, shoot.status !== "complete");
  });
  document.getElementById("shootMenuEdit")?.addEventListener("click", () => {
    closeShootPaneMenu();
    if (paneShootId) openPhotoshootForm(paneShootId);
  });
  document.getElementById("shootMenuDelete")?.addEventListener("click", async () => {
    closeShootPaneMenu();
    const shoot = getPhotoshootById(paneShootId);
    if (!shoot) return;
    const extra = shoot.status === "complete" ? " Its styles go back on Need to Shoot." : " Its styles stay on Need to Shoot.";
    if (!confirm(`Delete ${getPhotoshootTitle(shoot)} (${formatShootDate(shoot.date)})?${extra}`)) return;
    try {
      await deletePhotoshoot(shoot.id);
      closeShootPane();
      refreshPhotoshootViews();
      showIndicator("Shoot deleted", "success");
    } catch (err) {
      showIndicator(err.message || "Couldn't delete the shoot.", "error");
    }
  });
  document.getElementById("shootPaneClose")?.addEventListener("click", closeShootPane);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !paneShootId) return;
    if (document.querySelector(".modal-backdrop.open")) return;
    if (menu && !menu.hidden) { closeShootPaneMenu(); return; }
    // Docked, it's the page itself — Esc doesn't close it.
    if (!isShootPaneDocked()) closeShootPane();
  });
  initShootStyleReorder();
}
