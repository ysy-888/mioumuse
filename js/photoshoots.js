/**
 * Photoshoots — the Need to Shoot list and the shoots themselves.
 *
 *   Need to Shoot   every style flagged for a shoot and not yet shot, with
 *                   where it stands: not scheduled, or scheduled for a
 *                   shoot's (tentative) date. Tick some to create a shoot,
 *                   add them to an existing one, or take them off the list.
 *   Shoots          each shoot: date, studio / editorial, model, styles.
 *                   Clicking one opens its side pane; marking it complete
 *                   records its styles as shot, and they leave the list.
 *
 * The shared status badge (createShootStatusBadge) also shows in the Styles
 * table's Shoot column.
 */

let photoshootSubview = "need"; // "need" | "shoots"
let needFilter = "all";         // "all" | "unscheduled" | "scheduled"
let needShowShot = false;
let shootFilter = "planned";    // "planned" | "complete" | "all"
let needSelectedKeys = new Set();
let filteredNeedRows = [];
let paneShootId = null;

// ── Status badge ─────────────────────────────────────────────────────────────

function formatShootDate(ymdValue) {
  return ymdValue ? formatTaskDate(ymdValue) : "No date";
}

/**
 * Where a style stands: To shoot / Scheduled · date / Shot · date — or
 * nothing at all when it isn't on the list.
 */
function describeShootStatus(styleNo, color) {
  const entry = getShootListEntry(styleNo, color);
  if (!entry) return null;
  if (entry.shotShootId) {
    const shoot = getPhotoshootById(entry.shotShootId);
    return { tone: "shot", label: `Shot · ${shoot ? formatShootDate(shoot.date) : formatLongDate(entry.shotAt.slice(0, 10))}`, shoots: shoot ? [shoot] : [] };
  }
  const planned = getPlannedShootsFor(styleNo, color);
  if (planned.length) {
    const next = planned[0];
    return {
      tone: "scheduled",
      label: `Scheduled · ${formatShootDate(next.date)}${planned.length > 1 ? ` +${planned.length - 1}` : ""}`,
      shoots: planned,
    };
  }
  return { tone: "needed", label: "To shoot", shoots: [] };
}

function createShootStatusBadge(styleNo, color) {
  const status = describeShootStatus(styleNo, color);
  const el = document.createElement("span");
  if (!status) {
    setDisplayText(el, EMPTY_DISPLAY);
    return el;
  }
  el.className = "shoot-status";
  el.dataset.tone = status.tone;
  el.textContent = status.label;
  if (status.shoots.length) {
    el.title = status.shoots.map(s => `${getPhotoshootTitle(s)} · ${getPhotoshootTypeLabel(s.type)} · ${formatShootDate(s.date)}${s.model ? ` · ${s.model}` : ""}`).join("\n");
  }
  return el;
}

// ── Sub-views ────────────────────────────────────────────────────────────────

function setPhotoshootSubview(view) {
  photoshootSubview = view;
  renderPhotoshootsView();
}

function renderPhotoshootsView() {
  document.querySelectorAll("#photoshootSubtabs .filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === photoshootSubview);
  });
  const need = photoshootSubview === "need";
  document.getElementById("needToolbarControls").hidden = !need;
  document.getElementById("shootsToolbarControls").hidden = need;
  document.getElementById("needTableWrap").hidden = !need;
  document.getElementById("shootsTableWrap").hidden = need;
  document.getElementById("needRowCounter").hidden = !need;
  document.getElementById("shootsRowCounter").hidden = need;
  document.getElementById("needSearchInput").hidden = !need;
  document.getElementById("shootSearchInput").hidden = need;
  document.getElementById("newShootBtn").hidden = need;
  if (need) closeShootPane();

  const waiting = getShootListEntries().filter(e => !e.shotShootId).length;
  const needBtn = document.querySelector('#photoshootSubtabs [data-view="need"]');
  if (needBtn) needBtn.textContent = `Need to Shoot (${waiting.toLocaleString()})`;
  const planned = getAllPhotoshoots().filter(s => s.status === "planned").length;
  const shootsBtn = document.querySelector('#photoshootSubtabs [data-view="shoots"]');
  if (shootsBtn) shootsBtn.textContent = `Shoots (${planned} planned)`;

  if (need) renderNeedTable(); else renderShootsTable();
}

/** After any change: redraw whatever shows shoot status. */
function refreshPhotoshootViews() {
  if (getCurrentAppView() === "photoshoots") renderPhotoshootsView();
  if (getCurrentAppView() === "styles" && typeof renderStylesTable === "function") renderStylesTable();
  if (paneShootId) {
    const shoot = getPhotoshootById(paneShootId);
    if (shoot) renderShootPane(shoot); else closeShootPane();
  }
}

// ── Need to Shoot ────────────────────────────────────────────────────────────

/** A list entry joined to its style record (when the database has it). */
function buildNeedRows() {
  return getShootListEntries()
    .filter(e => needShowShot || !e.shotShootId)
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
        status,
        nextDate: status?.tone === "scheduled" ? status.shoots[0].date : "",
      };
    });
}

function renderNeedTable() {
  const q = (document.getElementById("needSearchInput")?.value ?? "").trim().toLowerCase();
  setActiveSearchQuery(q);

  filteredNeedRows = buildNeedRows().filter(r => {
    if (needFilter === "unscheduled" && r.status?.tone !== "needed") return false;
    if (needFilter === "scheduled" && r.status?.tone !== "scheduled") return false;
    if (!q) return true;
    return `${r.styleNo} ${r.color} ${r.description} ${r.category} ${r.season}`.toLowerCase().includes(q);
  });
  // Unscheduled first (that's the work to plan), then by shoot date, then style.
  const rank = r => (r.status?.tone === "needed" ? 0 : r.status?.tone === "scheduled" ? 1 : 2);
  filteredNeedRows.sort((a, b) => rank(a) - rank(b) || a.nextDate.localeCompare(b.nextDate) ||
    a.styleNo.localeCompare(b.styleNo, undefined, { numeric: true }) || a.color.localeCompare(b.color));

  document.querySelectorAll("#needFilters .filter-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.filter === needFilter));
  const showShot = document.getElementById("needShowShot");
  if (showShot) showShot.checked = needShowShot;
  const counter = document.getElementById("needRowCounter");
  if (counter) counter.textContent = filteredNeedRows.length === 1 ? "1 style" : `${filteredNeedRows.length.toLocaleString()} styles`;

  const tbody = document.getElementById("needTableBody");
  const cols = [...document.querySelectorAll("#needTable thead th[data-col]")].map(th => th.dataset.col);
  if (filteredNeedRows.length === 0) {
    const msg = getShootListEntries().length === 0
      ? "Nothing to shoot yet — tick styles in the Styles tab and use Add to Need to Shoot."
      : "No styles match the current filters.";
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(msg)}</td></tr>`;
    syncNeedSelectionUi();
    return;
  }

  tbody.replaceChildren(...filteredNeedRows.map(r => {
    const key = styleKey(r.styleNo, r.color);
    const tr = document.createElement("tr");
    tr.className = "clickable-row";
    tr.dataset.styleNo = r.styleNo;
    tr.dataset.color = r.color;
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
        case "shoot": td.appendChild(createShootStatusBadge(r.styleNo, r.color)); break;
        case "n41": td.appendChild(createStyleStatusPill(r.n41)); break;
        case "added": setDisplayText(td, r.addedAt ? formatLongDate(r.addedAt.slice(0, 10)) : EMPTY_DISPLAY); break;
        default:
          mountSearchHighlightedText(td, r[col] ?? "");
          if (col === "description" && r.description) td.title = r.description;
      }
      tr.appendChild(td);
    });
    return tr;
  }));
  syncNeedSelectionUi();
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

async function removeNeedSelection() {
  const styles = getSelectedNeedStyles();
  if (!styles.length) return;
  const inShoots = styles.filter(s => getPlannedShootsFor(s.styleNo, s.color).length).length;
  const extra = inShoots ? `\n\n${inShoots} of them ${inShoots === 1 ? "is" : "are"} in a planned shoot and will stay in it.` : "";
  if (!confirm(`Take ${styles.length} ${styles.length === 1 ? "style" : "styles"} off Need to Shoot?${extra}`)) return;
  try {
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

  document.querySelectorAll("#shootFilters .filter-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.filter === shootFilter));
  const counter = document.getElementById("shootsRowCounter");
  if (counter) counter.textContent = rows.length === 1 ? "1 shoot" : `${rows.length} shoots`;

  const tbody = document.getElementById("shootsTableBody");
  const cols = [...document.querySelectorAll("#shootsTable thead th[data-col]")].map(th => th.dataset.col);
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
          setDisplayText(td, formatShootDate(s.date));
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
        case "model": mountSearchHighlightedText(td, s.model); break;
        case "styles": td.appendChild(createShootStylesPreview(s)); break;
        case "status": {
          const pill = document.createElement("span");
          pill.className = "shoot-status";
          pill.dataset.tone = s.status === "complete" ? "shot" : "scheduled";
          pill.textContent = s.status === "complete" ? "Complete" : "Planned";
          td.appendChild(pill);
          break;
        }
      }
      tr.appendChild(td);
    });
    return tr;
  }));
}

/** A few thumbnails and the count. */
function createShootStylesPreview(shoot) {
  const wrap = document.createElement("span");
  wrap.className = "shoot-styles-preview";
  shoot.styles.slice(0, 4).forEach(s => wrap.appendChild(createStyleThumb(s.styleNo, s.color, "shoot-mini-thumb")));
  const count = document.createElement("span");
  count.className = "shoot-styles-count";
  count.textContent = shoot.styles.length === 1 ? "1 style" : `${shoot.styles.length} styles`;
  wrap.appendChild(count);
  return wrap;
}

// ── Shoot pane ───────────────────────────────────────────────────────────────

function renderShootPane(shoot) {
  document.getElementById("shootPaneTitle").textContent = getPhotoshootTitle(shoot);
  document.getElementById("shootPaneSubtitle").textContent =
    [getPhotoshootTypeLabel(shoot.type), formatShootDate(shoot.date), shoot.model].filter(Boolean).join(" · ");
  const status = document.getElementById("shootPaneStatus");
  status.dataset.tone = shoot.status === "complete" ? "shot" : "scheduled";
  status.textContent = shoot.status === "complete" ? "Complete" : "Planned";

  const fields = [
    ["Date", formatShootDate(shoot.date)],
    ["Type", getPhotoshootTypeLabel(shoot.type)],
    ["Model", shoot.model || EMPTY_DISPLAY],
    ["Styles", String(shoot.styles.length)],
    shoot.status === "complete" && shoot.completedAt ? ["Completed", formatLongDate(shoot.completedAt.slice(0, 10))] : null,
    shoot.notes ? ["Notes", shoot.notes] : null,
  ].filter(Boolean);
  document.getElementById("shootPaneSummary").replaceChildren(...fields.flatMap(([label, value]) => {
    const l = document.createElement("span");
    l.className = "item-pane-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "item-pane-value";
    v.textContent = value;
    return [l, v];
  }));

  const action = document.getElementById("shootPaneAction");
  action.replaceChildren();
  const btn = document.createElement("button");
  btn.type = "button";
  if (shoot.status === "complete") {
    btn.className = "btn";
    btn.textContent = "Reopen shoot";
    btn.addEventListener("click", () => setShootComplete(shoot.id, false));
  } else {
    btn.className = "btn btn-primary";
    btn.textContent = "✓ Mark shoot complete";
    btn.disabled = shoot.styles.length === 0;
    btn.addEventListener("click", () => setShootComplete(shoot.id, true));
  }
  const hint = document.createElement("span");
  hint.className = "form-hint";
  hint.textContent = shoot.status === "complete"
    ? "Its styles are recorded as shot. Reopening puts them back on Need to Shoot."
    : "Marks every style below as shot — they leave Need to Shoot. Remove any that weren't shot first.";
  action.append(btn, hint);

  document.getElementById("shootPaneStylesCount").textContent = String(shoot.styles.length);
  const list = document.getElementById("shootPaneStyles");
  if (shoot.styles.length === 0) {
    list.replaceChildren(Object.assign(document.createElement("div"), { className: "item-tasks-empty", textContent: "No styles yet — add them from Need to Shoot." }));
    return;
  }
  list.replaceChildren(...shoot.styles.map(s => {
    const style = findStyle(s.styleNo, s.color);
    const row = document.createElement("div");
    row.className = "shoot-style-row";
    const thumb = createStyleThumb(s.styleNo, s.color);
    thumb.addEventListener("click", () => openStyleGallery(s.styleNo, s.color));
    const text = document.createElement("span");
    text.className = "shoot-style-text";
    const top = document.createElement("strong");
    top.textContent = `${s.styleNo} · ${s.color}`;
    const sub = document.createElement("span");
    sub.textContent = style ? [style.description, style.category].filter(Boolean).join(" · ") : "Not in the Styles database";
    text.append(top, sub);
    row.append(thumb, text);
    if (shoot.status === "planned") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-close";
      remove.textContent = "✕";
      remove.title = "Remove from this shoot (stays on Need to Shoot)";
      remove.setAttribute("aria-label", `Remove ${s.styleNo} ${s.color} from this shoot`);
      remove.addEventListener("click", () => removeStyleFromShoot(shoot.id, s));
      row.appendChild(remove);
    }
    return row;
  }));
}

function openShootPane(id) {
  const shoot = getPhotoshootById(id);
  const pane = document.getElementById("shootPane");
  if (!shoot || !pane) return;
  paneShootId = shoot.id;
  renderShootPane(shoot);
  closeShootPaneMenu();
  pane.hidden = false;
  pane.querySelector(".item-pane-body")?.scrollTo({ top: 0 });
  if (photoshootSubview === "shoots") renderShootsTable();
}

function closeShootPane() {
  if (!paneShootId) return;
  paneShootId = null;
  closeShootPaneMenu();
  const pane = document.getElementById("shootPane");
  if (pane) pane.hidden = true;
  if (getCurrentAppView() === "photoshoots" && photoshootSubview === "shoots") renderShootsTable();
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
  try {
    await updatePhotoshoot(id, { styles: shoot.styles.filter(s => styleKey(s.styleNo, s.color) !== styleKey(style.styleNo, style.color)) });
    refreshPhotoshootViews();
  } catch (err) {
    showIndicator(err.message || "Couldn't remove it from the shoot.", "error");
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initPhotoshoots() {
  document.querySelectorAll("#photoshootSubtabs .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => setPhotoshootSubview(btn.dataset.view));
  });

  // Need to Shoot controls.
  document.querySelectorAll("#needFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => { needFilter = btn.dataset.filter; renderNeedTable(); });
  });
  document.getElementById("needShowShot")?.addEventListener("change", e => { needShowShot = e.target.checked; renderNeedTable(); });
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
    const tr = e.target.closest("tr[data-style-no]");
    if (tr) openStyleGallery(tr.dataset.styleNo, tr.dataset.color);
  });
  document.getElementById("needCreateShootBtn")?.addEventListener("click", () => openPhotoshootForm(null, getSelectedNeedStyles()));
  document.getElementById("needAddToShootSelect")?.addEventListener("change", e => addNeedSelectionToShoot(e.target.value));
  document.getElementById("needRemoveBtn")?.addEventListener("click", removeNeedSelection);
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
    closeShootPane();
  });
}
