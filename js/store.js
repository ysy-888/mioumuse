/**
 * Data layer.
 *
 * Backed by Supabase (see js/auth.js for the client). Every function here is
 * async and returns plain objects; everything else in the app reads through
 * the synchronous getters below (getAllTradeShows, getCampaignById, …),
 * which serve from an in-memory cache kept in sync with the database — so the
 * rest of the app never awaits a network round trip just to render.
 *
 * Shape:
 *   TradeShow { id, show,            // a TRADE_SHOWS key
 *               startDate, endDate,  // "YYYY-MM-DD", inclusive
 *               notes }
 *   Campaign  { id, type,            // a CAMPAIGN_TYPES key
 *               name,                // optional, e.g. "Black Friday"
 *               startDate, endDate,
 *               weekdays: number[],  // [] = every day, else 0 (Sun) … 6 (Sat)
 *               tasks: [{ id, category, dueDate }],
 *               notes }
 *   Banner    { id, type,            // a BANNER_TYPES key
 *               platforms: string[], // PLATFORMS keys, one or more
 *               name,
 *               width, height,       // pixels; 0 = not set
 *               imagePath,           // object path in the BANNER_BUCKET, or ""
 *               styles: [{ styleNo, color }],   // 1 to MAX_BANNER_STYLES
 *               updatedAt }
 *
 * A trade show's tasks are derived from its dates (see js/tasks.js); a
 * campaign's are chosen one by one and stored on it. Either way, only which
 * tasks are done lives in completed_tasks.
 */

let allTradeShows = [];
let allCampaigns = [];
let allBanners = [];

// ── Normalisation ────────────────────────────────────────────────────────────

/** Valid "YYYY-MM-DD" or "". */
function normalizeYmd(value) {
  return parseYmd(value) ? String(value) : "";
}

/**
 * Start and end as a valid pair. An end before the start is a typo, not a
 * negative-length event — treat it as one day rather than dropping it.
 */
function normalizeDateRange(raw) {
  const startDate = normalizeYmd(raw?.startDate);
  let endDate = normalizeYmd(raw?.endDate) || startDate;
  if (startDate && endDate < startDate) endDate = startDate;
  return { startDate, endDate };
}

function normalizeTradeShow(raw) {
  return {
    id: String(raw?.id ?? ""),
    show: String(raw?.show ?? "").trim(),
    ...normalizeDateRange(raw),
    notes: String(raw?.notes ?? ""),
  };
}

function normalizeCampaignTask(raw) {
  return {
    id: String(raw?.id ?? "") || newCampaignTaskId(),
    category: CAMPAIGN_TASK_CATEGORY_KEYS.includes(raw?.category) ? raw.category : CAMPAIGN_TASK_CATEGORY_KEYS[0],
    dueDate: normalizeYmd(raw?.dueDate),
  };
}

/**
 * The weekdays a campaign runs on (0 = Sunday … 6 = Saturday), in order.
 * Empty means every day — and so does all seven, which is stored as empty so
 * there's one way to say it.
 */
function normalizeWeekdays(raw) {
  const days = [...new Set((Array.isArray(raw) ? raw : []).map(Number))]
    .filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
  return days.length === 7 ? [] : days;
}

function normalizeCampaign(raw) {
  return {
    id: String(raw?.id ?? ""),
    type: CAMPAIGN_TYPE_KEYS.includes(raw?.type) ? raw.type : DEFAULT_CAMPAIGN_TYPE,
    name: String(raw?.name ?? "").trim(),
    ...normalizeDateRange(raw),
    weekdays: normalizeWeekdays(raw?.weekdays),
    tasks: (Array.isArray(raw?.tasks) ? raw.tasks : []).map(normalizeCampaignTask),
    notes: String(raw?.notes ?? ""),
  };
}

// ── Supabase row mapping ─────────────────────────────────────────────────────
//
// The DB is snake_case; everything above this line works in the app's
// camelCase shape. These are the only places that translate between them.

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

function campaignRowToInput(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    weekdays: row.weekdays,
    // Stored with the same field names the app uses — the tasks are always
    // read and written whole, so a nested table would only add round trips.
    tasks: row.tasks,
    notes: row.notes,
  };
}

function campaignToRow(campaign) {
  return {
    id: campaign.id,
    type: campaign.type,
    name: campaign.name,
    start_date: campaign.startDate,
    end_date: campaign.endDate,
    weekdays: campaign.weekdays,
    tasks: campaign.tasks,
    notes: campaign.notes,
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

async function persistCampaign(campaign) {
  throwIfError(await requireClient().from("campaigns").upsert(campaignToRow(campaign)));
}

// ── Load / clear ─────────────────────────────────────────────────────────────

/** Load every row Row Level Security lets the signed-in user see. */
async function loadAppData() {
  const client = requireClient();
  const [showsRes, campaignsRes, bannersRes, tasksRes] = await Promise.all([
    client.from("trade_shows").select("*"),
    client.from("campaigns").select("*"),
    client.from("banners").select("*"),
    client.from("completed_tasks").select("task_id"),
  ]);
  throwIfError(showsRes);
  throwIfError(campaignsRes);
  throwIfError(bannersRes);
  throwIfError(tasksRes);

  allTradeShows = showsRes.data.map(row => normalizeTradeShow(tradeShowRowToInput(row)));
  allCampaigns = campaignsRes.data.map(row => normalizeCampaign(campaignRowToInput(row)));
  allBanners = bannersRes.data.map(row => normalizeBanner(bannerRowToInput(row)));
  completedTaskIds = new Set(tasksRes.data.map(row => row.task_id));
}

/**
 * Wipe every trade show, campaign, banner (images included), and completed
 * task. Cannot be undone.
 */
async function clearAllData() {
  const client = requireClient();
  await removeBannerImages(allBanners.map(b => b.imagePath));
  // Every id is non-empty, so "not equal to empty string" reaches every row
  // RLS lets this user see — Supabase requires an explicit filter on delete.
  const results = await Promise.all([
    client.from("trade_shows").delete().neq("id", ""),
    client.from("campaigns").delete().neq("id", ""),
    client.from("banners").delete().neq("id", ""),
    client.from("completed_tasks").delete().neq("task_id", ""),
  ]);
  results.forEach(throwIfError);
  return loadAppData();
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Unique, and sortable by when it was made. */
function newRecordId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function newCampaignTaskId() {
  return newRecordId("t");
}

function validateDateRange({ startDate, endDate }) {
  if (!parseYmd(startDate)) throw new Error("Pick a start date.");
  if (!parseYmd(endDate)) throw new Error("Pick an end date.");
  if (endDate < startDate) throw new Error("The end date can't be before the start date.");
}

/** Forget completion marks — used when a record or some of its tasks go. */
async function deleteCompletedTasks(taskIds) {
  if (taskIds.length === 0) return;
  throwIfError(await requireClient().from("completed_tasks").delete().in("task_id", taskIds));
  taskIds.forEach(id => completedTaskIds.delete(id));
}

/** Every completion mark whose id starts with `prefix`. */
async function deleteCompletedTasksWithPrefix(prefix) {
  throwIfError(await requireClient().from("completed_tasks").delete().like("task_id", `${prefix}%`));
  [...completedTaskIds].filter(id => id.startsWith(prefix)).forEach(id => completedTaskIds.delete(id));
}

// ── Trade shows ──────────────────────────────────────────────────────────────

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

function validateTradeShowFields(fields) {
  if (!TRADE_SHOW_KEYS.includes(fields.show)) throw new Error("Pick a trade show.");
  validateDateRange(fields);
}

async function createTradeShow(fields) {
  const tradeShow = normalizeTradeShow({ ...fields, id: newRecordId("ts") });
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
  throwIfError(await requireClient().from("trade_shows").delete().eq("id", String(id)));
  await deleteCompletedTasksWithPrefix(`${TASK_ID_PREFIX_TRADE_SHOW}|${id}|`);
  const [removed] = allTradeShows.splice(index, 1);
  return removed;
}

// ── Campaigns ────────────────────────────────────────────────────────────────

function getAllCampaigns() {
  return allCampaigns;
}

function getCampaignById(id) {
  return allCampaigns.find(c => c.id === String(id)) ?? null;
}

/** The name if it has one, otherwise its type — "Black Friday", or "Sale". */
function getCampaignTitle(campaign) {
  return campaign?.name || getCampaignTypeLabel(campaign?.type);
}

function validateCampaignFields(fields) {
  if (!CAMPAIGN_TYPE_KEYS.includes(fields.type)) throw new Error("Pick a campaign type.");
  validateDateRange(fields);
  if (fields.weekdays.length > 0 && countActiveDays(fields) === 0) {
    throw new Error("None of the chosen days fall between the start and end dates.");
  }
  if (fields.tasks.some(task => !task.dueDate)) throw new Error("Every task needs a due date.");
}

async function createCampaign(fields) {
  const campaign = normalizeCampaign({ ...fields, id: newRecordId("cp") });
  validateCampaignFields(campaign);
  await persistCampaign(campaign);
  allCampaigns.push(campaign);
  return campaign;
}

/**
 * Merge `patch` into a campaign and persist. Tasks that were removed take
 * their completion marks with them, so nothing is left pointing at a task
 * that no longer exists.
 */
async function updateCampaign(id, patch) {
  const campaign = getCampaignById(id);
  if (!campaign) throw new Error(`Campaign ${id} not found.`);
  const merged = normalizeCampaign({ ...campaign, ...patch });
  validateCampaignFields(merged);
  await persistCampaign(merged);

  const kept = new Set(merged.tasks.map(t => t.id));
  const removedTaskIds = campaign.tasks
    .filter(t => !kept.has(t.id))
    .map(t => buildCampaignTaskId(campaign.id, t.id))
    .filter(isTaskComplete);
  await deleteCompletedTasks(removedTaskIds);

  Object.assign(campaign, merged);
  return campaign;
}

async function deleteCampaign(id) {
  const index = allCampaigns.findIndex(c => c.id === String(id));
  if (index === -1) throw new Error(`Campaign ${id} not found.`);
  throwIfError(await requireClient().from("campaigns").delete().eq("id", String(id)));
  await deleteCompletedTasksWithPrefix(`${TASK_ID_PREFIX_CAMPAIGN}|${id}|`);
  const [removed] = allCampaigns.splice(index, 1);
  return removed;
}

// ── Banners ──────────────────────────────────────────────────────────────────
//
// The row holds the banner's details; the image itself lives in Supabase
// Storage under <user id>/<banner id>/…, and the row keeps its path.

function normalizeBannerStyle(raw) {
  return {
    styleNo: String(raw?.styleNo ?? "").trim(),
    color: String(raw?.color ?? "").trim(),
  };
}

function normalizePixelSize(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Which platforms a banner runs on, in PLATFORMS order. Accepts the list, or
 * the single `platform` banners were first saved with.
 */
function normalizeBannerPlatforms(raw) {
  const source = Array.isArray(raw?.platforms) && raw.platforms.length ? raw.platforms : [raw?.platform];
  const set = new Set(source);
  return PLATFORM_KEYS.filter(key => set.has(key));
}

function normalizeBanner(raw) {
  return {
    id: String(raw?.id ?? ""),
    type: BANNER_TYPE_KEYS.includes(raw?.type) ? raw.type : BANNER_TYPE_KEYS[0],
    platforms: normalizeBannerPlatforms(raw),
    name: String(raw?.name ?? "").trim(),
    width: normalizePixelSize(raw?.width),
    height: normalizePixelSize(raw?.height),
    imagePath: String(raw?.imagePath ?? ""),
    // Rows with neither a style # nor a colour are just unused form lines.
    styles: (Array.isArray(raw?.styles) ? raw.styles : [])
      .map(normalizeBannerStyle)
      .filter(s => s.styleNo || s.color)
      .slice(0, MAX_BANNER_STYLES),
    updatedAt: String(raw?.updatedAt ?? ""),
  };
}

function bannerRowToInput(row) {
  return {
    id: row.id,
    type: row.banner_type,
    platforms: row.platforms,
    platform: row.platform,
    name: row.name,
    width: row.width,
    height: row.height,
    imagePath: row.image_path,
    styles: row.styles,
    updatedAt: row.updated_at,
  };
}

function bannerToRow(banner) {
  return {
    id: banner.id,
    banner_type: banner.type,
    platforms: banner.platforms,
    name: banner.name,
    width: banner.width || null,
    height: banner.height || null,
    image_path: banner.imagePath,
    styles: banner.styles,
    updated_at: banner.updatedAt,
  };
}

async function persistBanner(banner) {
  throwIfError(await requireClient().from("banners").upsert(bannerToRow(banner)));
}

function getAllBanners() {
  return allBanners;
}

function getBannerById(id) {
  return allBanners.find(b => b.id === String(id)) ?? null;
}

/** "1920 × 600", or "" when the size isn't set. */
function formatBannerSize(banner) {
  return banner?.width && banner?.height ? `${banner.width} × ${banner.height}` : "";
}

/** Public URL of a banner's image, or "" when it has none. */
function getBannerImageUrl(banner) {
  if (!banner?.imagePath || !supabaseClient) return "";
  return supabaseClient.storage.from(BANNER_BUCKET).getPublicUrl(banner.imagePath).data?.publicUrl ?? "";
}

function validateBannerFields(fields) {
  if (!BANNER_TYPE_KEYS.includes(fields.type)) throw new Error("Pick a banner type.");
  if (fields.platforms.length === 0) throw new Error("Pick at least one platform.");
  if (!fields.name) throw new Error("Give the banner a name.");
  if (fields.styles.length > MAX_BANNER_STYLES) {
    throw new Error(`A banner can feature up to ${MAX_BANNER_STYLES} styles.`);
  }
}

function checkBannerFile(file) {
  if (!file) return;
  if (!String(file.type).startsWith("image/")) throw new Error("The banner has to be an image file.");
  if (file.size > MAX_BANNER_FILE_BYTES) {
    throw new Error(`That image is over ${Math.round(MAX_BANNER_FILE_BYTES / 1024 / 1024)} MB.`);
  }
}

/** Upload under the signed-in user's own folder — what the storage policy allows. */
async function uploadBannerImage(bannerId, file) {
  checkBannerFile(file);
  const client = requireClient();
  const { data } = await client.auth.getSession();
  const userId = data?.session?.user?.id;
  if (!userId) throw new Error("Sign in again to upload images.");

  const ext = (String(file.name).match(/\.([a-z0-9]+)$/i)?.[1] ?? "png").toLowerCase();
  // A fresh name per upload, so a replaced image never serves from cache.
  const path = `${userId}/${bannerId}/${Date.now().toString(36)}.${ext}`;
  throwIfError(await client.storage.from(BANNER_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  }));
  return path;
}

/** Best-effort: a leftover file costs a little storage, not correctness. */
async function removeBannerImages(paths) {
  const list = paths.filter(Boolean);
  if (list.length === 0 || !supabaseClient) return;
  try {
    await supabaseClient.storage.from(BANNER_BUCKET).remove(list);
  } catch {
    /* ignored — see above */
  }
}

/** `file` is the image to upload, or null for none yet. */
async function createBanner(fields, file = null) {
  const banner = normalizeBanner({ ...fields, id: newRecordId("bn"), updatedAt: new Date().toISOString() });
  validateBannerFields(banner);
  checkBannerFile(file);

  if (file) banner.imagePath = await uploadBannerImage(banner.id, file);
  try {
    await persistBanner(banner);
  } catch (err) {
    // The row never landed, so the image it would have pointed at goes too.
    await removeBannerImages([banner.imagePath]);
    throw err;
  }
  allBanners.push(banner);
  return banner;
}

/**
 * Merge `patch` into a banner and persist. `image` is a new file to replace
 * the current one, `null` to leave it, or `false` to remove it.
 */
async function updateBanner(id, patch, image = null) {
  const banner = getBannerById(id);
  if (!banner) throw new Error(`Banner ${id} not found.`);
  const merged = normalizeBanner({ ...banner, ...patch, updatedAt: new Date().toISOString() });
  validateBannerFields(merged);
  checkBannerFile(image || null);

  const oldPath = banner.imagePath;
  if (image) merged.imagePath = await uploadBannerImage(banner.id, image);
  else if (image === false) merged.imagePath = "";

  try {
    await persistBanner(merged);
  } catch (err) {
    if (image) await removeBannerImages([merged.imagePath]);
    throw err;
  }
  // Only once the row points at the new image does the old one go.
  if (oldPath && oldPath !== merged.imagePath) await removeBannerImages([oldPath]);

  Object.assign(banner, merged);
  return banner;
}

async function deleteBanner(id) {
  const index = allBanners.findIndex(b => b.id === String(id));
  if (index === -1) throw new Error(`Banner ${id} not found.`);
  throwIfError(await requireClient().from("banners").delete().eq("id", String(id)));
  const [removed] = allBanners.splice(index, 1);
  await removeBannerImages([removed.imagePath]);
  return removed;
}

// ── Notes ────────────────────────────────────────────────────────────────────

/**
 * Notes autosave as they're typed, so this writes the one field rather than
 * re-validating the whole record on every keystroke.
 */
async function setRecordNotes(type, id, notes) {
  if (type === "campaign") {
    const campaign = getCampaignById(id);
    if (!campaign) throw new Error(`Campaign ${id} not found.`);
    campaign.notes = String(notes ?? "");
    await persistCampaign(campaign);
    return;
  }
  const tradeShow = getTradeShowById(id);
  if (!tradeShow) throw new Error(`Trade show ${id} not found.`);
  tradeShow.notes = String(notes ?? "");
  await persistTradeShow(tradeShow);
}

// ── Task completion ──────────────────────────────────────────────────────────

/**
 * Only completion is stored — the tasks themselves come from each record, so
 * there is no calendar to backfill or migrate.
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
