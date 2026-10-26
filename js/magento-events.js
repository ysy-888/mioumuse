/**
 * Magento → Events: the store's events (its events extension), each one a
 * trade show. Created, edited and deleted from here: Title, Content, Start,
 * End and Status go to Magento; the trade show (and so its category, notes
 * and email tasks) lives in the app.
 *
 * An event and an app trade show belong together when their dates overlap
 * (and, when both are known, they're the same show). An event with no trade
 * show in the app gets its category from its name ("MAGIC Las Vegas Feb
 * 2027" → Magic Las Vegas); saving it in the app adds the trade show.
 *
 * Dates: see "Events" in supabase/functions/magento/index.ts — the helper
 * saves the store's midnight, so the Magento admin shows the right day.
 */

/** { items, loading, error, loaded, can, timezone, seq } */
const mgEvents = { items: [], loading: false, error: "", loaded: false, can: {}, timezone: "", seq: 0 };
/** Search and the Status buttons (null = all, "on", "off"). */
const mgEventsQuery = { search: "", status: null };

/**
 * Words in an event's name → the trade show. Checked in order: the Magic
 * shows by their city first, then the cities and names on their own.
 */
const MG_EVENT_SHOW_PATTERNS = [
  ["magic-las-vegas", /\bmagic\b.*\b(las\s*vegas|vegas|lv)\b|\b(las\s*vegas|vegas)\b.*\bmagic\b/i],
  ["magic-new-york", /\bmagic\b.*\b(new\s*york|nyc|ny)\b|\b(new\s*york|nyc)\b.*\bmagic\b/i],
  ["magic-nashville", /\bmagic\b.*\bnashville\b|\bnashville\b.*\bmagic\b/i],
  ["atlanta-apparel", /\batlanta\b|\bamc\b/i],
  ["dallas-market", /\bdallas\b/i],
  ["flair", /\bflair\b/i],
  ["magic-las-vegas", /\b(las\s*vegas|vegas)\b/i],
  ["magic-new-york", /\b(new\s*york|nyc)\b/i],
  ["magic-nashville", /\bnashville\b/i],
];

/** The trade show an event's name points to, or "" when it doesn't say. */
function guessMgEventShow(title) {
  const text = String(title ?? "");
  return MG_EVENT_SHOW_PATTERNS.find(([, re]) => re.test(text))?.[0]
    ?? TRADE_SHOWS.find(s => text.toLowerCase().includes(s.label.toLowerCase()))?.key
    ?? "";
}

function mgEventOverlaps(event, tradeShow) {
  return Boolean(event.start) && tradeShow.startDate <= (event.end || event.start) && tradeShow.endDate >= event.start;
}

/**
 * The app's trade show for an event: dates overlap, the same show preferred.
 * Another show is taken only when no other event's name claims it (a
 * category picked by hand that the name doesn't say).
 */
function findMgEventTradeShow(event, show = guessMgEventShow(event.title)) {
  const overlapping = getAllTradeShows().filter(t => mgEventOverlaps(event, t));
  return overlapping.find(t => t.show === show)
    ?? overlapping.find(t => !mgEvents.items.some(o => o !== event && guessMgEventShow(o.title) === t.show && mgEventOverlaps(o, t)))
    ?? null;
}

/** { show, tradeShow, guessed } — the trade show's category wins over the name. */
function mgEventShow(event) {
  const tradeShow = findMgEventTradeShow(event);
  if (tradeShow) return { show: tradeShow.show, tradeShow, guessed: false };
  return { show: guessMgEventShow(event.title), tradeShow: null, guessed: true };
}

// ── Loading ──────────────────────────────────────────────────────────────────

function enterMgEvents() {
  renderMgEvents();
  if (!mgEvents.loaded && !mgEvents.loading) loadMgEvents();
}

async function loadMgEvents() {
  const seq = ++mgEvents.seq;
  mgEvents.loading = true;
  mgEvents.error = "";
  renderMgEvents();
  try {
    const data = await callMagento("events");
    if (seq !== mgEvents.seq) return;
    mgEvents.items = data.items ?? [];
    mgEvents.can = data.can ?? {};
    mgEvents.timezone = data.timezone ?? "";
  } catch (err) {
    if (seq !== mgEvents.seq) return;
    mgEvents.error = err.message || "Couldn't load events.";
    mgEvents.items = [];
  }
  mgEvents.loading = false;
  mgEvents.loaded = true;
  renderMgEvents();
}

// ── Table ────────────────────────────────────────────────────────────────────

function visibleMgEvents() {
  const q = mgEventsQuery.search.trim().toLowerCase();
  return mgEvents.items
    .filter(e => !q || e.title.toLowerCase().includes(q) || getTradeShowLabel(mgEventShow(e).show).toLowerCase().includes(q))
    .filter(e => mgEventsQuery.status === null || (mgEventsQuery.status === "on") === Boolean(e.enabled))
    // Newest first.
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

function describeMgEventsCount() {
  if (mgEvents.loading && !mgEvents.items.length) return "— events";
  const n = visibleMgEvents().length;
  return n === 1 ? "1 event" : `${n.toLocaleString()} events`;
}

function renderMgEvents() {
  if (mgSubview === "events") updateMgCounter();
  syncMgEventsToolbar();
  const tbody = document.getElementById("mgEventsBody");
  if (!tbody) return;
  const cols = [...document.querySelectorAll("#mgEventsTable thead th[data-col]")].map(th => th.dataset.col);
  const message = text => {
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(text)}</td></tr>`;
  };
  if (mgStore?.error) return message(mgStore.error);
  if (mgEvents.error) return message(mgEvents.error);
  if (mgEvents.loading && !mgEvents.items.length) return message("Loading events…");
  const rows = visibleMgEvents();
  if (!rows.length) return message(mgEvents.items.length ? "No events match the current filters." : "No events yet.");

  setActiveSearchQuery(mgEventsQuery.search.trim().toLowerCase());
  tbody.replaceChildren(...rows.map(event => {
    const tr = document.createElement("tr");
    tr.className = "clickable-row";
    tr.dataset.id = event.id;
    if (event.enabled === false) tr.classList.add("mg-row-disabled");
    const link = mgEventShow(event);
    cols.forEach(col => {
      const td = document.createElement("td");
      td.dataset.col = col;
      fillMgEventCell(col, event, link, td);
      tr.appendChild(td);
    });
    return tr;
  }));
  tbody.closest("table")?.classList.toggle("is-loading", mgEvents.loading);
}

function fillMgEventCell(col, event, link, td) {
  if (col === "title") {
    const wrap = document.createElement("span");
    wrap.className = "record-name-cell";
    const dot = document.createElement("span");
    dot.className = "item-dot";
    dot.dataset.show = link.show || "none";
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "mg-ellipsis";
    mountSearchHighlightedText(name, event.title || EMPTY_DISPLAY);
    wrap.append(dot, name);
    td.appendChild(wrap);
    td.title = event.title;
  } else if (col === "show") {
    if (!link.show) {
      td.textContent = "Not matched";
      td.className = "mg-muted";
      td.title = "The name doesn't say which trade show — open the event to pick one.";
      return;
    }
    const tag = document.createElement("span");
    tag.className = "mg-event-show";
    tag.dataset.show = link.show;
    tag.textContent = getTradeShowLabel(link.show);
    td.appendChild(tag);
    if (link.guessed) td.title = "From the event's name";
  } else if (col === "start") {
    td.textContent = formatLongDate(event.start) || EMPTY_DISPLAY;
  } else if (col === "end") {
    td.textContent = formatLongDate(event.end) || EMPTY_DISPLAY;
  } else if (col === "status") {
    td.appendChild(createMgEventStatusSwitch(event));
  } else if (col === "tradeShow") {
    td.appendChild(createMgEventTradeShowCell(event, link));
  }
}

function createMgEventStatusSwitch(event) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mg-status-switch";
  const on = Boolean(event.enabled);
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.innerHTML = `<span class="mg-switch-track" aria-hidden="true"><span class="mg-switch-knob"></span></span><span class="mg-switch-label">${on ? "Enabled" : "Disabled"}</span>`;
  btn.disabled = !mgEvents.can.update;
  btn.addEventListener("click", async e => {
    e.stopPropagation();
    btn.disabled = true;
    try {
      const saved = await callMagento("saveEvent", { id: event.id, changes: { status: !on } });
      replaceMgEvent(saved);
      showIndicator(`${event.title} ${saved.enabled ? "enabled" : "disabled"}`, "success");
    } catch (err) {
      showIndicator(err.message || "Couldn't change the event.", "error");
      btn.disabled = false;
    }
  });
  return btn;
}

/** The app's trade show: a link to it, or a button to add it. */
function createMgEventTradeShowCell(event, link) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mg-link";
  if (link.tradeShow) {
    btn.textContent = getTradeShowTitle(link.tradeShow);
    btn.title = "Open the trade show";
    btn.addEventListener("click", e => {
      e.stopPropagation();
      switchAppView("tradeShows");
      openItemPane(ITEM_TYPE_TRADE_SHOW, link.tradeShow.id);
    });
    return btn;
  }
  if (!link.show || !event.start) {
    const span = document.createElement("span");
    span.className = "mg-muted";
    span.textContent = "Not in app";
    return span;
  }
  btn.textContent = "Add to Trade Shows";
  btn.title = `Add ${getTradeShowLabel(link.show)}, ${formatDateRange(event.start, event.end || event.start)}, to the app's trade shows`;
  btn.addEventListener("click", async e => {
    e.stopPropagation();
    btn.disabled = true;
    try {
      const created = await linkMgEventTradeShow(event, link.show, null);
      showIndicator(`${getTradeShowTitle(created)} added to Trade Shows`, "success");
      renderMgEvents();
    } catch (err) {
      showIndicator(err.message || "Couldn't add the trade show.", "error");
      btn.disabled = false;
    }
  });
  return btn;
}

function replaceMgEvent(saved) {
  const i = mgEvents.items.findIndex(e => String(e.id) === String(saved.id));
  if (i === -1) mgEvents.items.push(saved);
  else mgEvents.items[i] = saved;
  renderMgEvents();
}

/**
 * The app's trade show follows the event: the one it already had is moved to
 * the event's show and dates, or a new one is added.
 */
async function linkMgEventTradeShow(event, show, tradeShow) {
  const fields = { show, startDate: event.start, endDate: event.end || event.start };
  const result = tradeShow
    ? (tradeShow.show === fields.show && tradeShow.startDate === fields.startDate && tradeShow.endDate === fields.endDate
      ? tradeShow
      : await updateTradeShow(tradeShow.id, fields))
    : await createTradeShow({ ...fields, notes: "" });
  refreshTaskViews();
  return result;
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function syncMgEventsToolbar() {
  document.querySelectorAll("#mgEventStatusFilters .filter-btn").forEach(btn => {
    const key = btn.dataset.status || null;
    btn.classList.toggle("active", key === mgEventsQuery.status);
  });
  const add = document.getElementById("mgAddEventBtn");
  if (add) add.disabled = mgEvents.loaded && !mgEvents.can.create;
  // Events saved the old way (shown the day before in the Magento admin).
  const fix = document.getElementById("mgFixEventDatesBtn");
  if (fix) {
    const n = mgEvents.items.filter(e => e.needsDateFix).length;
    fix.hidden = !n || !mgEvents.can.update;
    fix.textContent = `Fix ${n} date${n === 1 ? "" : "s"}`;
    fix.title = `${n} event${n === 1 ? " shows" : "s show"} the day before in the Magento admin (saved at midnight UTC). Re-saves ${n === 1 ? "it" : "them"} at the store's midnight — the same days.`;
  }
}

async function fixMgEventDates() {
  const n = mgEvents.items.filter(e => e.needsDateFix).length;
  if (!n || !confirm(`Re-save ${n} event${n === 1 ? "" : "s"} so the Magento admin shows the right start and end days? The days themselves stay the same.`)) return;
  setAppLoading(true, "Fixing event dates…");
  try {
    const { fixed, failed } = await callMagento("fixEventDates");
    showIndicator(failed.length ? `Fixed ${fixed}; ${failed.length} failed — ${failed[0]}` : `Fixed ${fixed} event${fixed === 1 ? "" : "s"}`, failed.length ? "error" : "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't fix the dates.", "error");
  } finally {
    setAppLoading(false);
  }
  loadMgEvents();
}

function exportMgEventsCsv() {
  const rows = visibleMgEvents();
  if (!rows.length) {
    showIndicator("Nothing to export", "error");
    return;
  }
  downloadCsv(`Magento events ${todayYmd()}`,
    ["ID", "Title", "Trade Show", "Start", "End", "Status", "In App"],
    rows.map(e => {
      const link = mgEventShow(e);
      return [e.id, e.title, link.show ? getTradeShowLabel(link.show) : "", e.start, e.end, e.enabled ? "Enabled" : "Disabled", link.tradeShow ? "Yes" : "No"];
    }));
}

// ── The form ─────────────────────────────────────────────────────────────────

/** { id, tradeShow } of the event being edited; id null for a new one. */
let mgEventForm = null;

function fillMgEventShowPicker() {
  const row = document.getElementById("mgEventFormShow");
  if (!row) return;
  row.replaceChildren(...TRADE_SHOWS.map(show => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "form-toggle-btn item-toggle";
    btn.dataset.value = show.key;
    btn.dataset.show = show.key;
    btn.textContent = show.label;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      setMgEventShowValue(show.key);
      row.classList.remove("is-invalid");
      // A new event's title starts as the show's name.
      const title = document.getElementById("mgEventFormTitleInput");
      if (title && !mgEventForm?.id && (!title.value.trim() || TRADE_SHOWS.some(s => s.label === title.value.trim()))) title.value = show.label;
    });
    return btn;
  }));
}

function setMgEventShowValue(value) {
  document.querySelectorAll("#mgEventFormShow .form-toggle-btn").forEach(btn => {
    const active = btn.dataset.value === value;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function getMgEventShowValue() {
  return document.querySelector("#mgEventFormShow .form-toggle-btn.is-active")?.dataset.value ?? "";
}

function setMgEventFormMessage(text, type = "") {
  const el = document.getElementById("mgEventFormMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (type ? ` ${type}` : "");
}

function openMgEventForm(id = null) {
  const overlay = document.getElementById("mgEventFormOverlay");
  if (!overlay) return;
  const event = id === null ? null : mgEvents.items.find(e => String(e.id) === String(id));
  const link = event ? mgEventShow(event) : { show: "", tradeShow: null };
  mgEventForm = { id: event?.id ?? null, tradeShow: link.tradeShow };

  document.getElementById("mgEventFormHeading").textContent = event ? "Edit event" : "Add event";
  setMgEventShowValue(link.show);
  const hint = document.getElementById("mgEventFormShowHint");
  if (hint) {
    hint.textContent = !event ? "Saving also adds the trade show to the app."
      : link.tradeShow ? `Linked to ${getTradeShowTitle(link.tradeShow)} in the app.`
        : link.show ? "Picked from the event's name — saving adds the trade show to the app."
          : "The name doesn't say which trade show — pick one.";
  }
  document.getElementById("mgEventFormTitleInput").value = event?.title ?? "";
  document.getElementById("mgEventFormStart").value = event?.start ?? "";
  const end = document.getElementById("mgEventFormEnd");
  end.value = event?.end ?? "";
  end.min = event?.start ?? "";
  document.getElementById("mgEventFormStatus").checked = event ? Boolean(event.enabled) : true;
  document.getElementById("mgEventFormContent").value = event?.content ?? "";
  const del = document.getElementById("mgEventFormDeleteBtn");
  if (del) del.hidden = !event || !mgEvents.can.remove;
  const admin = document.getElementById("mgEventFormTimezone");
  if (admin) admin.textContent = mgEvents.timezone ? `Dates are saved as midnight, ${mgEvents.timezone} — the store's time zone.` : "";
  document.querySelectorAll("#mgEventForm .is-invalid, #mgEventFormShow").forEach(el => el.classList.remove("is-invalid"));
  setMgEventFormMessage("");
  overlay.classList.add("open");
  requestAnimationFrame(() => document.getElementById("mgEventFormTitleInput")?.focus());
}

function closeMgEventForm() {
  document.getElementById("mgEventFormOverlay")?.classList.remove("open");
  mgEventForm = null;
}

function isMgEventFormOpen() {
  return document.getElementById("mgEventFormOverlay")?.classList.contains("open") === true;
}

/** The first problem with the form, marking its field. */
function validateMgEventForm(f) {
  const mark = id => document.getElementById(id)?.classList.add("is-invalid");
  if (!f.show) { mark("mgEventFormShow"); return "Pick the trade show."; }
  if (!f.title.trim()) { mark("mgEventFormTitleInput"); return "Give the event a title."; }
  if (!f.start) { mark("mgEventFormStart"); return "Pick a start date."; }
  if (!f.end) { mark("mgEventFormEnd"); return "Pick an end date."; }
  if (f.end < f.start) { mark("mgEventFormEnd"); return "The end date can't be before the start date."; }
  return "";
}

async function saveMgEventForm() {
  if (!mgEventForm) return;
  document.querySelectorAll("#mgEventForm .is-invalid, #mgEventFormShow").forEach(el => el.classList.remove("is-invalid"));
  const f = {
    show: getMgEventShowValue(),
    title: document.getElementById("mgEventFormTitleInput").value,
    start: document.getElementById("mgEventFormStart").value,
    end: document.getElementById("mgEventFormEnd").value,
    status: document.getElementById("mgEventFormStatus").checked,
    content: document.getElementById("mgEventFormContent").value,
  };
  const invalid = validateMgEventForm(f);
  if (invalid) return setMgEventFormMessage(invalid, "error");

  const saveBtn = document.getElementById("mgEventFormSaveBtn");
  saveBtn.disabled = true;
  setMgEventFormMessage("Saving to Magento…");
  const { id, tradeShow } = mgEventForm;
  try {
    const saved = await callMagento("saveEvent", {
      id,
      changes: { title: f.title.trim(), content: f.content, start: f.start, end: f.end, status: f.status },
    });
    replaceMgEvent(saved);
    // Then the app's side: the trade show follows the event.
    let note = "";
    try {
      await linkMgEventTradeShow({ ...saved, start: saved.start || f.start, end: saved.end || f.end }, f.show, tradeShow);
    } catch (err) {
      note = ` — but the app's trade show couldn't be saved: ${err.message}`;
    }
    closeMgEventForm();
    renderMgEvents();
    showIndicator(`${saved.title || f.title} ${id === null ? "created" : "saved"}${note}`, note ? "error" : "success");
  } catch (err) {
    setMgEventFormMessage(err.message || "Couldn't save the event.", "error");
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteMgEventFromForm() {
  const event = mgEvents.items.find(e => String(e.id) === String(mgEventForm?.id));
  if (!event) return;
  if (!confirm(`Delete "${event.title}" from Magento? This can't be undone.\n\nThe trade show stays in the app.`)) return;
  const btn = document.getElementById("mgEventFormDeleteBtn");
  btn.disabled = true;
  setMgEventFormMessage("Deleting…");
  try {
    await callMagento("deleteEvent", { id: event.id });
    mgEvents.items = mgEvents.items.filter(e => e !== event);
    closeMgEventForm();
    renderMgEvents();
    showIndicator(`${event.title} deleted from Magento`, "success");
  } catch (err) {
    setMgEventFormMessage(err.message || "Couldn't delete the event.", "error");
  } finally {
    btn.disabled = false;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initMgEvents() {
  fillMgEventShowPicker();
  document.getElementById("mgEventsBody")?.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) openMgEventForm(tr.dataset.id);
  });
  document.getElementById("mgEventsBody")?.addEventListener("contextmenu", e => {
    const td = e.target.closest('td[data-col="title"]');
    const value = td?.textContent.trim();
    if (value && value !== EMPTY_DISPLAY) openCopyMenu(e, value);
  });
  document.querySelectorAll("#mgEventStatusFilters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      mgEventsQuery.status = btn.dataset.status || null;
      renderMgEvents();
    });
  });
  document.getElementById("mgAddEventBtn")?.addEventListener("click", () => openMgEventForm());
  document.getElementById("mgFixEventDatesBtn")?.addEventListener("click", fixMgEventDates);

  document.getElementById("mgEventFormSaveBtn")?.addEventListener("click", saveMgEventForm);
  document.getElementById("mgEventFormCancelBtn")?.addEventListener("click", closeMgEventForm);
  document.getElementById("mgEventFormCloseBtn")?.addEventListener("click", closeMgEventForm);
  document.getElementById("mgEventFormDeleteBtn")?.addEventListener("click", deleteMgEventFromForm);
  const start = document.getElementById("mgEventFormStart");
  const end = document.getElementById("mgEventFormEnd");
  start?.addEventListener("change", () => {
    // Shows run a few days: the end follows the start when left behind.
    if (start.value && (!end.value || end.value < start.value)) end.value = start.value;
    end.min = start.value;
  });
  const overlay = document.getElementById("mgEventFormOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closeMgEventForm();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && isMgEventFormOpen()) closeMgEventForm();
  });
}
