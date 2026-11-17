// ── Activity log ─────────────────────────────────────────────────────────────
//
// Every add, change and removal in the team's data, with who and when. The
// database writes it (triggers on the shared tables — supabase/migrations/
// 20261117170000_activity_log.sql), so nothing here has to remember to log;
// this file only reads it: the Activity page, and a style's History in the
// style pane.

const ACT_PAGE_SIZE = 200;
/** Runs of this many like entries (one person, one table, minutes apart) fold into one line. */
const ACT_BULK_MIN = 5;
const ACT_BULK_GAP_MS = 2 * 60 * 1000;

/**
 * Each logged table: the area it belongs to (the page's Area filter), the
 * plural for a folded run, and what adding / removing / changing a row reads
 * as ({x} = the row's name).
 */
const ACT_TABLES = {
  styles: { area: "Styles", plural: "styles", add: "added style {x}", del: "deleted style {x}" },
  shoot_list: { area: "Need to Shoot", plural: "styles on Need to Shoot", add: "added {x} to Need to Shoot", del: "took {x} off Need to Shoot", upd: "changed {x} on Need to Shoot" },
  photoshoots: { area: "Photoshoots", plural: "photoshoots", add: "created photoshoot {x}", del: "deleted photoshoot {x}", upd: "changed photoshoot {x}" },
  style_completions: { area: "Complete", plural: "completions", add: "marked {x} complete", del: "took {x} off Complete", upd: "changed {x} on Complete" },
  sample_photo_links: { area: "Sample photos", plural: "sample photos", add: "linked a sample photo to {x}", del: "unlinked the sample photo from {x}", upd: "changed the sample photo for {x}" },
  po_fit_comments: { area: "POs", plural: "fit comments", add: "added a fit comment on {x}", del: "deleted a fit comment on {x}", upd: "changed a fit comment on {x}" },
  po_color_samples: { area: "POs", plural: "PP samples", add: "set the PP sample for {x}", del: "cleared the PP sample for {x}", upd: "changed the PP sample for {x}" },
  po_month_archive: { area: "POs", plural: "months", add: "archived the {x} POs", del: "brought back the {x} POs" },
  campaigns: { area: "Campaigns", plural: "campaigns", add: "created campaign {x}", del: "deleted campaign {x}", upd: "changed campaign {x}" },
  trade_shows: { area: "Trade Shows", plural: "trade shows", add: "added trade show {x}", del: "deleted trade show {x}", upd: "changed trade show {x}" },
  banners: { area: "Platforms", plural: "banners", add: "added banner {x}", del: "deleted banner {x}", upd: "changed banner {x}" },
  holidays: { area: "Holidays", plural: "holidays", add: "added holiday {x}", del: "deleted holiday {x}", upd: "changed holiday {x}" },
  email_settings: { area: "E-Mail", plural: "emails", add: "started email {x}", del: "deleted email {x}", upd: "changed email {x}" },
  completed_tasks: { area: "Tasks", plural: "tasks", add: "checked off {x}", del: "unchecked {x}" },
};

/** Column → the name people know it by (anything else: its name, tidied). */
const ACT_FIELDS = {
  n41_status: "N41 status", available_date: "Available", received_qty: "Received qty",
  sample_status: "Sample", ihd: "IHD", top_date: "TOP date", top_po: "TOP PO", style_no: "Style #",
  shot_shoot_id: "Shot in", shot_at: "Shot", shoot_id: "Shoot", completed_at: "Completed",
  shoot_date: "Date", shoot_type: "Type", start_date: "Start", end_date: "End", weekdays: "Days",
  image_path: "Image", banner_type: "Banner type", pp_sample: "PP sample", path: "Photo",
  archived_at: "Archived", comment_date: "Comment date", round_type: "Round", round_no: "Round #",
  pp_samples: "PP samples", top_sample: "TOP sample", html: "Content", template_id: "Template", po_no: "PO #", deleted_at: "Deleted",
};

const act = {
  entries: [],
  done: false,
  loading: false,
  token: 0,
  filters: { q: "", who: "", area: "", range: "30" },
  /** Folded runs the user opened, by their first entry's id. */
  open: new Set(),
  facets: null,
};

function actEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function actFieldLabel(col) {
  return ACT_FIELDS[col] ?? col.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
}

function actPersonName(id) {
  if (!id) return "System";
  const p = typeof chatPerson === "function" ? chatPerson(id) : null;
  return id === chat?.me ? `${p?.name ?? "You"}` : (p?.name ?? "Someone");
}

function actAvatarHtml(id) {
  if (!id) return `<span class="chat-avatar chat-avatar--sm act-avatar-system" aria-hidden="true">⚙</span>`;
  return chatAvatarHtml(id, "sm");
}

/** A task's name from its app-wide id ("cp|<campaign>|<task>", "ts|<show>|<task>"). */
function actTaskName(taskId) {
  const [kind, recordId] = String(taskId ?? "").split("|");
  try {
    if (kind === "cp") {
      const c = getCampaignById(recordId);
      const t = c && buildCampaignTasks(c).find(x => x.id === taskId);
      if (c) return `${t?.label ?? "a task"} for ${c.name}`;
    }
    if (kind === "ts") {
      const s = getTradeShowById(recordId);
      const t = s && buildTradeShowTasks(s).find(x => x.id === taskId);
      if (s) return `${t?.label ?? "a task"} for ${s.show}`;
    }
  } catch { /* a record that's gone */ }
  return "a task";
}

/** The row's name as the sentence shows it. */
function actThing(e) {
  if (e.table_name === "completed_tasks") return actTaskName(e.row_key);
  if (e.table_name === "photoshoots") {
    const shoot = getPhotoshootById(e.row_key);
    if (shoot) return getPhotoshootTitle(shoot);
  }
  if (e.table_name === "po_fit_comments") {
    const [po, styleNo, round, no] = e.row_key.split(" · ");
    return `${styleNo} (PO ${po}, ${round} ${no})`;
  }
  return e.label || e.row_key || "an entry";
}

function actFormatValue(col, v) {
  if (v === null || v === undefined || v === "") return "empty";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (col === "method") return getShootMethodLabel(v) || String(v);
  if (col === "reason") return getShootReasonLabel(v) || String(v);
  if (col === "sample_status") return getSampleStatusLabel(v) || String(v);
  if (col === "shot_shoot_id" || col === "shoot_id") {
    const shoot = getPhotoshootById(v);
    return shoot ? getPhotoshootTitle(shoot) : "a shoot";
  }
  if (Array.isArray(v)) return v.length === 1 ? "1 item" : `${v.length} items`;
  if (typeof v === "object") return "…";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatMdy(s);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString(undefined, { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" });
  }
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

/** One element of a list column, by name. */
function actListItemName(item) {
  if (item && typeof item === "object") {
    if (item.styleNo) return [item.styleNo, item.color].filter(Boolean).join(" ");
    if (item.category) return [getCampaignTaskCategoryLabel(item.category), item.dueDate ? formatMdy(item.dueDate) : ""].filter(Boolean).join(" ");
    return item.name || item.label || item.title || item.id || "an item";
  }
  return String(item);
}

/** A list column's change: what was added, removed or edited (matched by id). */
function actListChangeHtml(change) {
  const added = change.added ?? [];
  const removed = change.removed ?? [];
  const idOf = x => (x && typeof x === "object" ? x.id : undefined);
  const removedIds = new Map(removed.filter(idOf).map(x => [idOf(x), x]));
  const parts = [];
  const names = (list, verb) => {
    if (!list.length) return;
    const shown = list.slice(0, 6).map(x => actEsc(actListItemName(x))).join(", ");
    parts.push(`${verb} ${shown}${list.length > 6 ? ` and ${list.length - 6} more` : ""}`);
  };
  const edited = added.filter(x => idOf(x) && removedIds.has(idOf(x)));
  names(added.filter(x => !edited.includes(x)), "added");
  names(removed.filter(x => !edited.some(e => idOf(e) === idOf(x))), "removed");
  names(edited, "edited");
  return parts.join("; ");
}

/** The lines under an update: each changed field, old → new. */
function actChangesHtml(e) {
  if (e.action !== "update") return "";
  const lines = Object.entries(e.changes ?? {})
    .filter(([col]) => col !== "deleted_at")
    .map(([col, c]) => {
      const field = `<span class="act-field">${actEsc(actFieldLabel(col))}</span>`;
      if (c?.edited) return `${field} edited`;
      if (c?.reordered) return `${field} reordered`;
      if (c && ("added" in c || "removed" in c)) return `${field} ${actListChangeHtml(c)}`;
      return `${field} <span class="act-old">${actEsc(actFormatValue(col, c?.from))}</span>`
        + `<span class="act-arrow" aria-label="to">→</span><span class="act-new">${actEsc(actFormatValue(col, c?.to))}</span>`;
    });
  return lines.length ? `<ul class="act-changes">${lines.map(l => `<li>${l}</li>`).join("")}</ul>` : "";
}

/** "changed", "added …", or for a soft delete "removed" / "restored". */
function actVerbHtml(e) {
  const meta = ACT_TABLES[e.table_name] ?? {};
  const x = `<button type="button" class="act-thing" data-act-open="${e.id}">${actEsc(actThing(e))}</button>`;
  let phrase;
  if (e.action === "insert") phrase = meta.add ?? "added {x}";
  else if (e.action === "delete") phrase = meta.del ?? "deleted {x}";
  else {
    const del = e.changes?.deleted_at;
    if (del && del.to && !del.from) phrase = "removed {x}";
    else if (del && del.from && !del.to) phrase = "restored {x}";
    else phrase = meta.upd ?? "changed {x}";
  }
  return actEsc(phrase).replace("{x}", x);
}

function actTime(at) {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function actDayLabel(at) {
  const d = new Date(at);
  const today = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(today) - day(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function actEntryHtml(e, { compact = false } = {}) {
  const who = `<span class="act-who">${actEsc(actPersonName(e.actor_id))}</span>`;
  const title = new Date(e.at).toLocaleString();
  return `<li class="act-entry${compact ? " is-compact" : ""}">
    ${compact ? "" : actAvatarHtml(e.actor_id)}
    <div class="act-body">
      <div class="act-line">${who} ${actVerbHtml(e)}</div>
      ${actChangesHtml(e)}
    </div>
    <time class="act-time" datetime="${actEsc(e.at)}" title="${actEsc(title)}">${compact ? actEsc(`${actDayLabel(e.at)}, ${actTime(e.at)}`) : actEsc(actTime(e.at))}</time>
  </li>`;
}

/** Entries in runs: like entries close together (an import, a bulk edit) fold into one. */
function actRuns(entries) {
  const runs = [];
  for (const e of entries) {
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.actor_id === e.actor_id && prev.table_name === e.table_name && prev.action === e.action
      && Math.abs(new Date(prev.at) - new Date(e.at)) <= ACT_BULK_GAP_MS
      && actDayLabel(prev.at) === actDayLabel(e.at)) last.push(e);
    else runs.push([e]);
  }
  return runs.flatMap(run => (run.length >= ACT_BULK_MIN ? [run] : run.map(e => [e])));
}

function actRunHtml(run) {
  if (run.length === 1) return actEntryHtml(run[0]);
  const first = run[0];
  const meta = ACT_TABLES[first.table_name] ?? {};
  const verb = first.action === "insert" ? "added" : first.action === "delete" ? "deleted" : "changed";
  const fields = [...new Set(run.flatMap(e => (e.action === "update" ? Object.keys(e.changes ?? {}) : [])))].map(actFieldLabel);
  const open = act.open.has(first.id);
  const span = `${actTime(run[run.length - 1].at)} – ${actTime(first.at)}`;
  return `<li class="act-entry act-run${open ? " is-open" : ""}">
    ${actAvatarHtml(first.actor_id)}
    <div class="act-body">
      <div class="act-line"><span class="act-who">${actEsc(actPersonName(first.actor_id))}</span> ${verb} ${run.length.toLocaleString()} ${actEsc(meta.plural ?? "entries")}</div>
      ${fields.length ? `<div class="act-run-fields">${actEsc(fields.join(", "))}</div>` : ""}
      <button type="button" class="btn-link act-run-toggle" data-act-run="${first.id}">${open ? "Hide" : "Show all"}</button>
      ${open ? `<ul class="act-run-list">${run.map(e => actEntryHtml(e, { compact: true })).join("")}</ul>` : ""}
    </div>
    <time class="act-time" datetime="${actEsc(first.at)}">${actEsc(span)}</time>
  </li>`;
}

// ── Loading ──────────────────────────────────────────────────────────────────

function actSinceIso(range) {
  const days = Number(range);
  if (!days) return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString();
}

function actQuery() {
  const f = act.filters;
  let q = requireClient().from("activity_log")
    .select("id, actor_id, at, table_name, action, row_key, label, style_no, color, changes")
    .order("id", { ascending: false })
    .limit(ACT_PAGE_SIZE);
  if (f.who === "system") q = q.is("actor_id", null);
  else if (f.who) q = q.eq("actor_id", f.who);
  if (f.area) q = q.in("table_name", Object.keys(ACT_TABLES).filter(t => ACT_TABLES[t].area === f.area));
  const since = actSinceIso(f.range);
  if (since) q = q.gte("at", since);
  if (f.q) q = q.ilike("label", `%${f.q.replace(/[%_\\]/g, "\\$&")}%`);
  return q;
}

async function loadActivity({ more = false } = {}) {
  const token = more ? act.token : ++act.token;
  if (!more) { act.entries = []; act.done = false; }
  act.loading = true;
  renderActivityList();
  try {
    let q = actQuery();
    if (more && act.entries.length) q = q.lt("id", act.entries[act.entries.length - 1].id);
    const { data, error } = await q;
    if (token !== act.token) return;
    if (error) throw new Error(error.message);
    act.entries.push(...(data ?? []));
    act.done = (data ?? []).length < ACT_PAGE_SIZE;
  } catch (err) {
    if (token === act.token) showIndicator(err.message || "Couldn't load the activity.", "error");
  } finally {
    if (token === act.token) {
      act.loading = false;
      renderActivityList();
    }
  }
}

/** Who and which areas have entries: the filters list only those. */
async function loadActivityFacets() {
  try {
    const { data, error } = await requireClient().rpc("activity_facets");
    if (error) throw error;
    act.facets = data ?? [];
  } catch {
    act.facets = [];
  }
  renderActivityFilters();
}

// ── The Activity page ────────────────────────────────────────────────────────

function renderActivityFilters() {
  const facets = act.facets ?? [];
  const who = document.getElementById("activityWho");
  const area = document.getElementById("activityArea");
  if (!who || !area) return;
  const people = [...new Set(facets.map(f => f.actor_id ?? "system"))]
    .map(id => ({ id, name: id === "system" ? "System" : actPersonName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  who.innerHTML = `<option value="">Everyone</option>${people.map(p => `<option value="${actEsc(p.id)}">${actEsc(p.name)}</option>`).join("")}`;
  who.value = people.some(p => p.id === act.filters.who) ? act.filters.who : "";
  who.hidden = people.length < 2 && !act.filters.who;
  const areas = [...new Set(facets.map(f => ACT_TABLES[f.table_name]?.area).filter(Boolean))].sort();
  area.innerHTML = `<option value="">All areas</option>${areas.map(a => `<option value="${actEsc(a)}">${actEsc(a)}</option>`).join("")}`;
  area.value = areas.includes(act.filters.area) ? act.filters.area : "";
}

function renderActivityList() {
  const list = document.getElementById("activityList");
  if (!list) return;
  const runs = actRuns(act.entries);
  const parts = [];
  let day = "";
  for (const run of runs) {
    const d = actDayLabel(run[0].at);
    if (d !== day) {
      if (day) parts.push("</ul>");
      parts.push(`<h3 class="act-day">${actEsc(d)}</h3><ul class="act-list">`);
      day = d;
    }
    parts.push(actRunHtml(run));
  }
  if (day) parts.push("</ul>");
  if (!act.entries.length && !act.loading) {
    const f = act.filters;
    const filtered = f.q || f.who || f.area;
    parts.push(`<div class="act-empty">${filtered ? "Nothing matches these filters." : f.range ? "No changes in this period." : "No changes recorded yet."}</div>`);
  }
  if (act.loading) parts.push(`<div class="act-empty">Loading…</div>`);
  else if (!act.done && act.entries.length) parts.push(`<div class="act-more"><button type="button" class="btn" id="activityMore">Load older</button></div>`);
  list.innerHTML = parts.join("");
  const count = document.getElementById("activityCount");
  if (count) count.textContent = act.entries.length ? `${act.entries.length.toLocaleString()}${act.done ? "" : "+"} changes` : "";
}

/** Open what an entry is about: the style's pane, the shoot, the campaign or show. */
function openActivityThing(e) {
  if (e.style_no && findStyle(e.style_no, e.color)) return openStylePane(e.style_no, e.color);
  if (e.style_no) {
    const any = getStyleColors?.(e.style_no)?.[0];
    if (any) return openStylePane(e.style_no, any.color ?? any);
  }
  if (e.table_name === "photoshoots" && getPhotoshootById(e.row_key)) {
    switchAppView("photoshoots");
    return openShootPane(e.row_key);
  }
  if (e.table_name === "campaigns" && getCampaignById(e.row_key)) return openItemPane(ITEM_TYPE_CAMPAIGN, e.row_key);
  if (e.table_name === "trade_shows" && getTradeShowById(e.row_key)) return openItemPane(ITEM_TYPE_TRADE_SHOW, e.row_key);
  if (e.table_name === "completed_tasks") {
    const [kind, id] = e.row_key.split("|");
    if (kind === "cp" && getCampaignById(id)) return openItemPane(ITEM_TYPE_CAMPAIGN, id);
    if (kind === "ts" && getTradeShowById(id)) return openItemPane(ITEM_TYPE_TRADE_SHOW, id);
  }
  showIndicator("That's no longer in the app.");
}

async function renderActivityPage() {
  if (typeof chat !== "undefined" && !chat.people?.size) {
    try { await loadChatPeople(); } catch { /* names fall back to "Someone" */ }
  }
  const search = document.getElementById("activitySearch");
  if (search && search.value !== act.filters.q) search.value = act.filters.q;
  const range = document.getElementById("activityRange");
  if (range) range.value = act.filters.range;
  loadActivityFacets();
  loadActivity();
}

/** The Activity page searching for one thing (a style's "See all"). */
function showActivityFor(q) {
  act.filters = { q, who: "", area: "", range: "" };
  switchAppView("activity");
}

function findActivityEntry(id) {
  return act.entries.find(e => String(e.id) === String(id)) ?? actStyleHistory.entries.find(e => String(e.id) === String(id));
}

function initActivity() {
  const search = document.getElementById("activitySearch");
  let timer = 0;
  search?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { act.filters.q = search.value.trim(); loadActivity(); }, 250);
  });
  document.getElementById("activityWho")?.addEventListener("change", e => { act.filters.who = e.target.value; loadActivity(); });
  document.getElementById("activityArea")?.addEventListener("change", e => { act.filters.area = e.target.value; loadActivity(); });
  document.getElementById("activityRange")?.addEventListener("change", e => { act.filters.range = e.target.value; loadActivity(); });
  document.getElementById("activityRefresh")?.addEventListener("click", () => { loadActivityFacets(); loadActivity(); });
  document.getElementById("activityList")?.addEventListener("click", e => {
    if (e.target.closest("#activityMore")) return loadActivity({ more: true });
    const toggle = e.target.closest("[data-act-run]");
    if (toggle) {
      const id = Number(toggle.dataset.actRun);
      if (act.open.has(id)) act.open.delete(id); else act.open.add(id);
      return renderActivityList();
    }
    const thing = e.target.closest("[data-act-open]");
    if (thing) {
      const entry = findActivityEntry(thing.dataset.actOpen);
      if (entry) openActivityThing(entry);
    }
  });
  document.getElementById("stylePaneHistory")?.addEventListener("click", e => {
    const thing = e.target.closest("[data-act-open]");
    const entry = thing && findActivityEntry(thing.dataset.actOpen);
    // In a style's own history, its name opens nothing new — only other styles do.
    if (entry && !(paneStyle && entry.style_no === paneStyle.styleNo && entry.color === paneStyle.color)) openActivityThing(entry);
  });
  document.getElementById("stylePaneHistoryAll")?.addEventListener("click", () => {
    if (paneStyle) showActivityFor(paneStyle.styleNo);
  });
}

// ── A style's history (style pane) ───────────────────────────────────────────

const ACT_STYLE_HISTORY_SHOWN = 8;
const actStyleHistory = { key: "", entries: [], token: 0 };

/** The style's latest changes, everywhere it's logged (Styles, Need to Shoot, Complete…). */
async function renderStylePaneHistory(style) {
  const box = document.getElementById("stylePaneHistory");
  const count = document.getElementById("stylePaneHistoryCount");
  if (!box) return;
  const key = `${style.styleNo}\u0000${style.color}`;
  const token = ++actStyleHistory.token;
  if (actStyleHistory.key !== key) {
    actStyleHistory.key = key;
    actStyleHistory.entries = [];
    box.innerHTML = `<div class="act-empty is-small">Loading…</div>`;
    if (count) count.textContent = "";
  }
  try {
    const { data, error } = await requireClient().from("activity_log")
      .select("id, actor_id, at, table_name, action, row_key, label, style_no, color, changes")
      .eq("style_no", style.styleNo)
      .order("id", { ascending: false })
      .limit(60);
    if (token !== actStyleHistory.token) return;
    if (error) throw new Error(error.message);
    // This colour's, and the Style #'s own (a fit comment has no colour).
    actStyleHistory.entries = (data ?? []).filter(e => e.color == null || e.color === style.color);
  } catch {
    if (token !== actStyleHistory.token) return;
    box.innerHTML = `<div class="act-empty is-small">Couldn't load the history.</div>`;
    return;
  }
  const shown = actStyleHistory.entries.slice(0, ACT_STYLE_HISTORY_SHOWN);
  if (count) count.textContent = actStyleHistory.entries.length ? `${actStyleHistory.entries.length}${actStyleHistory.entries.length >= 60 ? "+" : ""}` : "";
  box.innerHTML = shown.length
    ? `<ul class="act-list is-mini">${shown.map(e => actEntryHtml(e, { compact: true })).join("")}</ul>`
    : `<div class="act-empty is-small">No changes recorded yet.</div>`;
  document.getElementById("stylePaneHistoryAll").hidden = !shown.length;
}
