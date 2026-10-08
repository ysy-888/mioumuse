/**
 * Data layer.
 *
 * Backed by Supabase (see js/auth.js for the client). Every function here is
 * async and returns plain objects; everything else in the app reads through
 * the synchronous getters below (getAllTradeShows, getTradeShowById, …),
 * which serve from an in-memory cache kept in sync with the database — so the
 * rest of the app never awaits a network round trip just to render.
 *
 * Shape:
 *   TradeShow { id, show,            // a TRADE_SHOWS key
 *               startDate, endDate,  // "YYYY-MM-DD", inclusive
 *               notes }
 *
 * Tasks are never stored — they're derived from each show's dates (see
 * js/tasks.js). Only which ones are done is kept.
 */

let allTradeShows = [];

// ── Normalisation ────────────────────────────────────────────────────────────

function normalizeTradeShow(raw) {
  const startDate = parseYmd(raw?.startDate) ? String(raw.startDate) : "";
  let endDate = parseYmd(raw?.endDate) ? String(raw.endDate) : startDate;
  // A show that "ends" before it starts is a typo, not a negative-length
  // event — treat it as one day rather than dropping it off the calendar.
  if (startDate && endDate < startDate) endDate = startDate;

  return {
    id: String(raw?.id ?? ""),
    show: String(raw?.show ?? "").trim(),
    startDate,
    endDate,
    notes: String(raw?.notes ?? ""),
  };
}

// ── Supabase row mapping ─────────────────────────────────────────────────────
//
// The DB is snake_case; everything above this line works in the app's
// camelCase shape. These are the only two places that translate between them.

function tradeShowRowToInput(row) {
  return {
    id: row.id,
    show: row.show,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
  };
}

function tradeShowToRow(tradeShow) {
  return {
    id: tradeShow.id,
    show: tradeShow.show,
    start_date: tradeShow.startDate,
    end_date: tradeShow.endDate,
    notes: tradeShow.notes,
  };
}

function requireClient() {
  if (!supabaseClient) throw new Error("Supabase isn't configured — set SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js.");
  return supabaseClient;
}

function throwIfError({ error }) {
  if (error) throw new Error(error.message);
}

async function persistTradeShow(tradeShow) {
  throwIfError(await requireClient().from("trade_shows").upsert(tradeShowToRow(tradeShow)));
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Load every row Row Level Security lets the signed-in user see. */
async function loadAppData() {
  const client = requireClient();
  const [showsRes, tasksRes] = await Promise.all([
    client.from("trade_shows").select("*"),
    client.from("completed_tasks").select("task_id"),
  ]);
  throwIfError(showsRes);
  throwIfError(tasksRes);

  allTradeShows = showsRes.data.map(row => normalizeTradeShow(tradeShowRowToInput(row)));
  completedTaskIds = new Set(tasksRes.data.map(row => row.task_id));

  return { tradeShows: allTradeShows };
}

/** Wipe every trade show and completed task. Cannot be undone. */
async function clearAllData() {
  const client = requireClient();
  // Every id is non-empty, so "not equal to empty string" reaches every row
  // RLS lets this user see — Supabase requires an explicit filter on delete.
  const results = await Promise.all([
    client.from("trade_shows").delete().neq("id", ""),
    client.from("completed_tasks").delete().neq("task_id", ""),
  ]);
  results.forEach(throwIfError);
  return loadAppData();
}

function getAllTradeShows() {
  return allTradeShows;
}

function getTradeShowById(id) {
  return allTradeShows.find(t => t.id === String(id)) ?? null;
}

/** "Magic Las Vegas 2027" — the show plus the year it opens. */
function getTradeShowTitle(tradeShow) {
  const label = getTradeShowLabel(tradeShow?.show);
  const year = tradeShow?.startDate?.slice(0, 4);
  return year ? `${label} ${year}` : label;
}

/** Unique, and sortable by when it was made. */
function newTradeShowId() {
  return `ts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function validateTradeShowFields(fields) {
  if (!TRADE_SHOW_KEYS.includes(fields.show)) throw new Error("Pick a trade show.");
  if (!parseYmd(fields.startDate)) throw new Error("Pick a start date.");
  if (!parseYmd(fields.endDate)) throw new Error("Pick an end date.");
  if (fields.endDate < fields.startDate) throw new Error("The end date can't be before the start date.");
}

async function createTradeShow(fields) {
  const tradeShow = normalizeTradeShow({ ...fields, id: newTradeShowId() });
  validateTradeShowFields(tradeShow);
  await persistTradeShow(tradeShow);
  allTradeShows.push(tradeShow);
  return tradeShow;
}

/** Merge `patch` into a trade show and persist. Returns the updated record. */
async function updateTradeShow(id, patch) {
  const tradeShow = getTradeShowById(id);
  if (!tradeShow) throw new Error(`Trade show ${id} not found.`);
  const merged = normalizeTradeShow({ ...tradeShow, ...patch });
  validateTradeShowFields(merged);
  await persistTradeShow(merged);
  Object.assign(tradeShow, merged);
  return tradeShow;
}

/** Deletes the show and the completion marks on its tasks. */
async function deleteTradeShow(id) {
  const index = allTradeShows.findIndex(t => t.id === String(id));
  if (index === -1) throw new Error(`Trade show ${id} not found.`);

  const client = requireClient();
  throwIfError(await client.from("trade_shows").delete().eq("id", String(id)));
  const prefix = `${TASK_ID_PREFIX_TRADE_SHOW}|${id}|`;
  throwIfError(await client.from("completed_tasks").delete().like("task_id", `${prefix}%`));
  [...completedTaskIds].filter(taskId => taskId.startsWith(prefix)).forEach(taskId => completedTaskIds.delete(taskId));

  const [removed] = allTradeShows.splice(index, 1);
  return removed;
}

/**
 * Notes autosave as they are typed, so this writes the one field rather than
 * re-validating the whole record on every keystroke.
 */
async function setTradeShowNotes(id, notes) {
  const tradeShow = getTradeShowById(id);
  if (!tradeShow) throw new Error(`Trade show ${id} not found.`);
  tradeShow.notes = String(notes ?? "");
  await persistTradeShow(tradeShow);
  return tradeShow;
}

// ── Task completion ──────────────────────────────────────────────────────────

/**
 * Only completion is stored — the tasks themselves are always regenerated from
 * each show's dates, so there is no calendar to backfill or migrate.
 */
let completedTaskIds = new Set();

function isTaskComplete(taskId) {
  return completedTaskIds.has(taskId);
}

async function setTaskComplete(taskId, complete) {
  const client = requireClient();
  if (complete) {
    // completed_tasks has no single-column id — its primary key is the
    // (user_id, task_id) pair, so the upsert has to name it explicitly.
    throwIfError(await client.from("completed_tasks").upsert({ task_id: taskId }, { onConflict: "user_id,task_id" }));
    completedTaskIds.add(taskId);
  } else {
    throwIfError(await client.from("completed_tasks").delete().eq("task_id", taskId));
    completedTaskIds.delete(taskId);
  }
  return complete;
}
