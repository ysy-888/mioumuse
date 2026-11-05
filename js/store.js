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
 *   Style     { styleNo, color,      // together, the record's identity
 *               status,              // N41 status, e.g. ACTIVE, SOLDOUT
 *               season, category, description,
 *               ihd,                 // in-house date, "YYYY-MM-DD" or ""
 *               updatedAt }
 *   ShootListEntry { styleNo, color, addedAt, reason,
 *               shotShootId, shotAt }    // set once done: a shoot's id, or "cg"
 *   StyleCompletion { id, styleNo, color, // the Complete history, one per time done
 *               method,              // "photoshoot" | "cg"
 *               shootId, reason, completedAt }
 *   Photoshoot { id, name, date, model,
 *               type,                // "studio" | "editorial"
 *               notes, status,       // "planned" | "complete"
 *               completedAt,
 *               styles: [{ styleNo, color }] }
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

  // Mailchimp links are an add-on: if their table isn't there yet, the rest
  // of the app still loads — there are just no links.
  const linksRes = await client.from("task_links").select("task_id, mc_campaign_id, sent_seen");
  taskLinks = new Map((linksRes.error ? [] : linksRes.data).map(row => [row.task_id, {
    campaignId: row.mc_campaign_id,
    sentSeen: row.sent_seen === true,
  }]));

  // The Styles database is an add-on too, and can run to thousands of rows.
  setAllStyles(await loadAllRows(client, "styles"));
  repairTwoDigitYearIhds();

  // Photoshoots and the Need to Shoot list — add-ons as well.
  const [shootRows, shootsRes] = await Promise.all([
    loadAllRows(client, "shoot_list"),
    client.from("photoshoots").select("*"),
  ]);
  setShootList(shootRows);
  allPhotoshoots = (shootsRes.error ? [] : shootsRes.data).map(row => normalizePhotoshoot(photoshootRowToInput(row)));

  // PO lines from the cost sheet — an add-on too — and the months archived.
  [allPoLines, poArchivedMonths, allPoColors] = await Promise.all([loadPoLines(client), loadPoArchivedMonths(client), loadPoColors(client), loadSamplePhotoLinks(client)]);
  poColorsByPo = null;

  // The Complete history (styles shot or made in CG).
  await loadStyleCompletions(client);
}

// ── PO lines (the cost sheet) ────────────────────────────────────────────────
//
// One row per style line of a month's tab: Style # as written (T6941-RE4),
// its base Style # (T6941), the recut number, P.O#, dept (S new, SR recut)
// and Store In. Company (C) lines aren't kept. Each import replaces them all.

let allPoLines = [];
let poLinesTableReady = true;

const PO_LINES_SQL = `create table if not exists po_lines (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month text not null, row_no int not null, po_style text not null default '',
  style_no text not null default '', recut int not null default 0, po_no text not null default '',
  dept text not null default '', store_in date,
  primary key (user_id, month, row_no)
);
alter table po_lines enable row level security;
drop policy if exists "po_lines: own rows only" on po_lines;
create policy "po_lines: own rows only" on po_lines
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());`;

function poLineRowToLine(row) {
  return {
    month: row.month,
    rowNo: row.row_no,
    poStyle: row.po_style,
    styleNo: row.style_no,
    recut: row.recut ?? 0,
    poNo: row.po_no,
    dept: row.dept,
    storeIn: row.store_in ?? "",
  };
}

async function loadPoLines(client) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await client.from("po_lines").select("*")
      .order("month").order("row_no")
      .range(from, from + PAGE - 1);
    if (res.error) {
      poLinesTableReady = false;
      return rows.map(poLineRowToLine);
    }
    rows.push(...res.data);
    if (res.data.length < PAGE) return rows.map(poLineRowToLine);
  }
}

function getAllPoLines() {
  return allPoLines;
}

// ── PO colours (N41's PO report) ─────────────────────────────────────────────
//
// The cost sheet has no colours, so they come from N41: one row per P.O# +
// Style (as N41 writes it) + Color. A report only covers its date range, so
// an import replaces the POs it has and leaves every other PO as it was.

let allPoColors = [];
/** P.O# → its colours (upper case), rebuilt on load and import. */
let poColorsByPo = null;

const PO_COLORS_SQL = `create table if not exists po_colors (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  po_no text not null, style text not null default '', color text not null default '',
  imported_at timestamptz not null default now(),
  primary key (user_id, po_no, style, color)
);
alter table po_colors enable row level security;
drop policy if exists "po_colors: own rows only" on po_colors;
create policy "po_colors: own rows only" on po_colors
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());`;

/** A missing table (SQL not run yet) reads as no colours. */
async function loadPoColors(client) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await client.from("po_colors").select("po_no,style,color")
      .order("po_no").range(from, from + PAGE - 1);
    if (res.error) return [];
    rows.push(...res.data.map(r => ({ poNo: r.po_no, style: r.style, color: r.color })));
    if (res.data.length < PAGE) return rows;
  }
}

/** The colours N41 has for a P.O#, upper case — empty when it has none. */
function getPoColors(poNo) {
  if (!poColorsByPo) {
    poColorsByPo = new Map();
    allPoColors.forEach(r => {
      if (!poColorsByPo.has(r.poNo)) poColorsByPo.set(r.poNo, new Set());
      poColorsByPo.get(r.poNo).add(r.color.trim().toUpperCase());
    });
  }
  return poColorsByPo.get(String(poNo ?? "").trim()) ?? new Set();
}

function getAllPoColors() {
  return allPoColors;
}

/** Save a report's rows: its POs are replaced, the rest kept. */
async function mergePoColors(rows) {
  const client = requireClient();
  const tableError = err => /po_colors/.test(err.message ?? "")
    ? new Error(`Create the po_colors table in Supabase first (SQL Editor):\n\n${PO_COLORS_SQL}`)
    : err;
  const pos = [...new Set(rows.map(r => r.poNo))];
  const BATCH = 300;
  for (let i = 0; i < pos.length; i += BATCH) {
    const del = await client.from("po_colors").delete().in("po_no", pos.slice(i, i + BATCH));
    if (del.error) throw tableError(del.error);
  }
  for (let i = 0; i < rows.length; i += 500) {
    const res = await client.from("po_colors").insert(rows.slice(i, i + 500)
      .map(r => ({ po_no: r.poNo, style: r.style, color: r.color })));
    if (res.error) throw tableError(res.error);
  }
  const replaced = new Set(pos);
  allPoColors = [...allPoColors.filter(r => !replaced.has(r.poNo)), ...rows];
  poColorsByPo = null;
}

// Archived months ("2026-07"): still listed on the POs page, but their Store
// Ins no longer set IHDs. Kept apart from po_lines, which every import
// replaces, so an archive survives re-reading the sheet.

let poArchivedMonths = new Set();

const PO_MONTH_ARCHIVE_SQL = `create table if not exists po_month_archive (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month text not null,
  archived_at timestamptz not null default now(),
  primary key (user_id, month)
);
alter table po_month_archive enable row level security;
drop policy if exists "po_month_archive: own rows only" on po_month_archive;
create policy "po_month_archive: own rows only" on po_month_archive
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());`;

/** A missing table (SQL not run yet) reads as nothing archived. */
async function loadPoArchivedMonths(client) {
  const res = await client.from("po_month_archive").select("month");
  return new Set(res.error ? [] : res.data.map(r => r.month));
}

function getPoArchivedMonths() {
  return poArchivedMonths;
}

async function setPoMonthArchived(month, archived) {
  const client = requireClient();
  const res = archived
    ? await client.from("po_month_archive").upsert({ month }, { onConflict: "user_id,month" })
    : await client.from("po_month_archive").delete().eq("month", month);
  if (res.error) {
    throw /po_month_archive/.test(res.error.message ?? "")
      ? new Error(`Create the po_month_archive table in Supabase first (SQL Editor):\n\n${PO_MONTH_ARCHIVE_SQL}`)
      : res.error;
  }
  if (archived) poArchivedMonths.add(month); else poArchivedMonths.delete(month);
}

// ── Sample photo links ───────────────────────────────────────────────────────
// Which photo in the sample photo folder stands in for a style + colour,
// picked by hand (js/sample-photos.js). The path is relative to that folder,
// "/"-separated: "FALL 26/IMG_4412.JPG".

/** styleKey(style, color) → path */
let samplePhotoLinks = new Map();

const SAMPLE_PHOTO_LINKS_SQL = `create table if not exists sample_photo_links (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  style_no text not null, color text not null default '', path text not null,
  linked_at timestamptz not null default now(),
  primary key (user_id, style_no, color)
);
alter table sample_photo_links enable row level security;
drop policy if exists "sample_photo_links: own rows only" on sample_photo_links;
create policy "sample_photo_links: own rows only" on sample_photo_links
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());`;

/** A missing table (SQL not run yet) reads as no links. */
async function loadSamplePhotoLinks(client) {
  const PAGE = 1000;
  const links = new Map();
  for (let from = 0; ; from += PAGE) {
    const res = await client.from("sample_photo_links").select("style_no,color,path")
      .order("style_no").range(from, from + PAGE - 1);
    if (res.error) break;
    res.data.forEach(r => links.set(styleKey(r.style_no, r.color), r.path));
    if (res.data.length < PAGE) break;
  }
  samplePhotoLinks = links;
}

function getSamplePhotoLink(styleNo, color) {
  return samplePhotoLinks.get(styleKey(styleNo, color)) ?? "";
}

/** path → the styles linked to it, as [styleNo, color] pairs. */
function getSamplePhotoLinksByPath() {
  const byPath = new Map();
  samplePhotoLinks.forEach((path, key) => {
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push(key.split("\u0000"));
  });
  return byPath;
}

/** Link a photo to a style + colour; an empty path removes the link. */
async function setSamplePhotoLink(styleNo, color, path) {
  const client = requireClient();
  const res = path
    ? await client.from("sample_photo_links").upsert(
        { style_no: styleNo, color, path, linked_at: new Date().toISOString() },
        { onConflict: "user_id,style_no,color" })
    : await client.from("sample_photo_links").delete().eq("style_no", styleNo).eq("color", color);
  if (res.error) {
    throw /sample_photo_links/.test(res.error.message ?? "")
      ? new Error(`Create the sample_photo_links table in Supabase first (SQL Editor):\n\n${SAMPLE_PHOTO_LINKS_SQL}`)
      : res.error;
  }
  if (path) samplePhotoLinks.set(styleKey(styleNo, color), path);
  else samplePhotoLinks.delete(styleKey(styleNo, color));
}

/** Replace every PO line with `lines` (from parseCostSheet). */
async function replacePoLines(lines) {
  const client = requireClient();
  const tableError = err => /po_lines/.test(err.message ?? "")
    ? new Error(`Create the po_lines table in Supabase first (SQL Editor):\n\n${PO_LINES_SQL}`)
    : err;
  const del = await client.from("po_lines").delete().neq("month", "");
  if (del.error) throw tableError(del.error);
  const BATCH = 500;
  for (let i = 0; i < lines.length; i += BATCH) {
    const res = await client.from("po_lines").insert(lines.slice(i, i + BATCH).map(l => ({
      month: l.month,
      row_no: l.rowNo,
      po_style: l.poStyle,
      style_no: l.styleNo,
      recut: l.recut,
      po_no: l.poNo,
      dept: l.dept,
      store_in: l.storeIn || null,
    })));
    if (res.error) throw tableError(res.error);
  }
  allPoLines = lines;
  poLinesTableReady = true;
}

/** Set every colour of a Style # to one IHD — the cost sheet's date is per style. */
async function setStyleNoIhd(styleNo, ihd) {
  const colors = getStyleColors(styleNo);
  if (!colors.length) return;
  throwIfError(await requireClient().from("styles")
    .update({ ihd: ihd || null })
    .eq("style_no", colors[0].styleNo));
  colors.forEach(style => { style.ihd = ihd; });
}

/**
 * Every row of a style-keyed table, a page at a time — Supabase hands back at
 * most 1,000 rows per request. A missing table (SQL not run yet) reads as
 * empty, so the rest of the app still loads.
 */
async function loadAllRows(client, table) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await client.from(table).select("*")
      .order("style_no").order("color")
      .range(from, from + PAGE - 1);
    if (res.error) return rows;
    rows.push(...res.data);
    if (res.data.length < PAGE) return rows;
  }
}

/**
 * Wipe every trade show, campaign, banner (images included), and completed
 * task. Cannot be undone. The Styles database is left alone — it comes from
 * the ATS export and is re-imported, not entered by hand.
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
  // Links only — the Mailchimp campaigns themselves are left alone.
  await client.from("task_links").delete().neq("task_id", "");
  return loadAppData();
}

// ── Magento groups ───────────────────────────────────────────────────────────

/**
 * The imported Magento groups: { groups: Map(groupSku → [childSku]),
 * importedAt } — or null when the magento_groups table isn't there yet.
 */
async function loadMagentoGroupRows() {
  const client = requireClient();
  const rows = [];
  // Supabase hands back 1,000 rows at a time.
  for (let from = 0; ; from += 1000) {
    const res = await client.from("magento_groups").select("group_sku, child_skus, imported_at").range(from, from + 999);
    if (res.error) {
      if (from === 0) return null; // the table isn't set up yet
      throw new Error(res.error.message);
    }
    rows.push(...res.data);
    if (res.data.length < 1000) break;
  }
  const groups = new Map(rows.map(r => [r.group_sku, Array.isArray(r.child_skus) ? r.child_skus.map(String) : []]));
  const importedAt = rows.reduce((latest, r) => (r.imported_at > latest ? r.imported_at : latest), "");
  return { groups, importedAt };
}

/** Replace every imported group with these (Map groupSku → [childSku]). */
/**
 * The N41 Sales Orders report, as imported: orderKey → { poNo, soNo, customer,
 * status }, plus importedAt — or null when the n41_orders table isn't there yet.
 */
async function loadN41OrderRows() {
  const client = requireClient();
  const orders = new Map();
  let importedAt = "";
  for (let from = 0; ; from += 1000) {
    const res = await client.from("n41_orders").select("*").order("order_no").range(from, from + 999);
    if (res.error) {
      if (from === 0) return null; // the table isn't set up yet
      throw new Error(res.error.message);
    }
    (res.data ?? []).forEach(r => {
      orders.set(r.order_no, { poNo: r.po_no, soNo: r.so_no ?? "", customer: r.customer, status: r.status });
      if (r.imported_at > importedAt) importedAt = r.imported_at;
    });
    if ((res.data ?? []).length < 1000) break;
  }
  return { orders, importedAt };
}

/** Each report covers a date range, so orders are added or updated, never cleared. */
async function saveN41OrderRows(orders) {
  const client = requireClient();
  const importedAt = new Date().toISOString();
  const rows = [...orders].map(([order_no, o]) => ({ order_no, po_no: o.poNo, so_no: o.soNo, customer: o.customer, status: o.status, imported_at: importedAt }));
  for (let i = 0; i < rows.length; i += 500) {
    throwIfError(await client.from("n41_orders").upsert(rows.slice(i, i + 500), { onConflict: "user_id,order_no" }));
  }
  return importedAt;
}

async function replaceMagentoGroupRows(groups) {
  const client = requireClient();
  const importedAt = new Date().toISOString();
  throwIfError(await client.from("magento_groups").delete().neq("group_sku", ""));
  const rows = [...groups].map(([group_sku, child_skus]) => ({ group_sku, child_skus, imported_at: importedAt }));
  for (let i = 0; i < rows.length; i += 500) {
    throwIfError(await client.from("magento_groups").insert(rows.slice(i, i + 500)));
  }
  return importedAt;
}

// ── Table views ──────────────────────────────────────────────────────────────

/**
 * Every saved table view, as { tableId: { order, hidden } } — or null when
 * the table_views table isn't there yet (an add-on: the app works without it).
 */
async function loadTableViewRows() {
  const res = await requireClient().from("table_views").select("table_id, col_order, hidden");
  if (res.error) return null;
  return Object.fromEntries(res.data.map(row => [row.table_id, {
    order: Array.isArray(row.col_order) ? row.col_order : [],
    hidden: Array.isArray(row.hidden) ? row.hidden : [],
  }]));
}

async function saveTableViewRow(tableId, { order, hidden }) {
  const row = { table_id: tableId, col_order: order, hidden, updated_at: new Date().toISOString() };
  throwIfError(await requireClient().from("table_views").upsert(row, { onConflict: "user_id,table_id" }));
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

/**
 * Every completion mark — and Mailchimp link — whose task id starts with
 * `prefix`. Used when a whole record goes.
 */
async function deleteCompletedTasksWithPrefix(prefix) {
  throwIfError(await requireClient().from("completed_tasks").delete().like("task_id", `${prefix}%`));
  [...completedTaskIds].filter(id => id.startsWith(prefix)).forEach(id => completedTaskIds.delete(id));
  await deleteTaskLinks([...taskLinks.keys()].filter(id => id.startsWith(prefix)));
}

// ── Mailchimp links ──────────────────────────────────────────────────────────
//
// task id → { campaignId, sentSeen }. Only the link is stored; the campaign's
// status, subject and send time are always read fresh from Mailchimp.

let taskLinks = new Map();

function getTaskLink(taskId) {
  return taskLinks.get(taskId) ?? null;
}

function getAllTaskLinks() {
  return taskLinks;
}

/** The task already linked to a Mailchimp campaign, if any. */
function findTaskLinkedTo(campaignId) {
  for (const [taskId, link] of taskLinks) if (link.campaignId === campaignId) return taskId;
  return null;
}

async function setTaskLink(taskId, campaignId) {
  const row = { task_id: taskId, mc_campaign_id: campaignId, sent_seen: false };
  throwIfError(await requireClient().from("task_links").upsert(row, { onConflict: "user_id,task_id" }));
  taskLinks.set(taskId, { campaignId, sentSeen: false });
}

/** Remember the app already ticked this task off for its sent campaign. */
async function markTaskLinkSentSeen(taskId) {
  const link = taskLinks.get(taskId);
  if (!link || link.sentSeen) return;
  throwIfError(await requireClient().from("task_links").update({ sent_seen: true }).eq("task_id", taskId));
  link.sentSeen = true;
}

async function deleteTaskLinks(taskIds) {
  const ids = taskIds.filter(id => taskLinks.has(id));
  if (ids.length === 0) return;
  throwIfError(await requireClient().from("task_links").delete().in("task_id", ids));
  ids.forEach(id => taskLinks.delete(id));
}

// ── Trade shows ──────────────────────────────────────────────────────────────

function getAllTradeShows() {
  return allTradeShows;
}

function getTradeShowById(id) {
  return allTradeShows.find(t => t.id === String(id)) ?? null;
}

/** "[Oct 2026]" — the month and year the show opens, or "" without a date. */
function getTradeShowMonthTag(tradeShow) {
  const start = parseYmd(tradeShow?.startDate);
  if (!start) return "";
  return `[${start.toLocaleString("en-US", { month: "short" })} ${start.getFullYear()}]`;
}

/** "Dallas Market [Oct 2026]" — the show plus the month it opens. */
function getTradeShowTitle(tradeShow) {
  const label = getTradeShowLabel(tradeShow?.show);
  const tag = getTradeShowMonthTag(tradeShow);
  return tag ? `${label} ${tag}` : label;
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
    .map(t => buildCampaignTaskId(campaign.id, t.id));
  await deleteCompletedTasks(removedTaskIds.filter(isTaskComplete));
  // Their Mailchimp links go too; the Mailchimp campaigns themselves stay.
  await deleteTaskLinks(removedTaskIds);

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

// ── Styles ───────────────────────────────────────────────────────────────────
//
// Imported from the N41 ATS export (js/style-import.js). One record per
// Style # + Color; importing again updates what changed and adds what's new.

let allStyles = [];
/**
 * Deleted styles stay in the database (deleted_at set), so an import skips
 * them instead of adding them back. They're left out of everything else.
 */
let deletedStyles = [];
/** Style # (upper case) → its colours, for the banner lookups. */
let stylesByNo = new Map();

/** The identity of a style record, matching the table's primary key. */
function styleKey(styleNo, color) {
  return `${styleNo}\u0000${color}`;
}

function styleRowToStyle(row) {
  return {
    styleNo: String(row.style_no ?? ""),
    color: String(row.color ?? ""),
    status: String(row.n41_status ?? ""),
    season: String(row.season ?? ""),
    category: String(row.category ?? ""),
    description: String(row.description ?? ""),
    // In-house date — entered in the app, not part of the ATS export.
    ihd: normalizeYmd(row.ihd),
    // Also entered in the app; the import leaves it alone.
    notes: String(row.notes ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    deletedAt: String(row.deleted_at ?? ""),
  };
}

/**
 * Note: IHD isn't in here on purpose. An import upserts these columns only,
 * and Supabase leaves the columns it isn't sent alone — so re-importing the
 * ATS export never wipes an IHD typed into the app.
 */
function styleToRow(style) {
  return {
    style_no: style.styleNo,
    color: style.color,
    n41_status: style.status,
    season: style.season,
    category: style.category,
    description: style.description,
    updated_at: new Date().toISOString(),
  };
}

function setAllStyles(rows) {
  const styles = rows.map(styleRowToStyle);
  allStyles = styles.filter(s => !s.deletedAt);
  deletedStyles = styles.filter(s => s.deletedAt);
  indexStyles();
}

function indexStyles() {
  stylesByNo = new Map();
  allStyles.forEach(style => {
    const key = style.styleNo.toUpperCase();
    if (!stylesByNo.has(key)) stylesByNo.set(key, []);
    stylesByNo.get(key).push(style);
  });
}

function getAllStyles() {
  return allStyles;
}

function getDeletedStyles() {
  return deletedStyles;
}

/**
 * Delete styles (or, with `deleted` false, restore them). The rows stay,
 * marked with deleted_at; the cache moves them across.
 */
async function setStylesDeleted(styles, deleted) {
  const BATCH = 500;
  const client = requireClient();
  const at = deleted ? new Date().toISOString() : null;
  for (let i = 0; i < styles.length; i += BATCH) {
    const res = await client.from("styles")
      .upsert(styles.slice(i, i + BATCH).map(s => ({ ...styleToRow(s), deleted_at: at })), { onConflict: "user_id,style_no,color" });
    if (res.error && /deleted_at/.test(res.error.message ?? "")) {
      throw new Error("Deleting styles needs the deleted_at column. Run the styles SQL in supabase-schema.sql first.");
    }
    throwIfError(res);
  }
  const keys = new Set(styles.map(s => styleKey(s.styleNo, s.color)));
  const moving = [...allStyles, ...deletedStyles].filter(s => keys.has(styleKey(s.styleNo, s.color)));
  moving.forEach(s => { s.deletedAt = at ?? ""; });
  const byStyle = (a, b) => a.styleNo.localeCompare(b.styleNo) || a.color.localeCompare(b.color);
  allStyles = [...allStyles.filter(s => !keys.has(styleKey(s.styleNo, s.color))), ...(deleted ? [] : moving)].sort(byStyle);
  deletedStyles = [...deletedStyles.filter(s => !keys.has(styleKey(s.styleNo, s.color))), ...(deleted ? moving : [])].sort(byStyle);
  indexStyles();
}

/** Every colour of a Style #, or [] when it isn't in the database. */
function getStyleColors(styleNo) {
  return stylesByNo.get(String(styleNo ?? "").trim().toUpperCase()) ?? [];
}

/** One Style # + Color, matched without regard to case. */
function findStyle(styleNo, color) {
  const c = String(color ?? "").trim().toUpperCase();
  return getStyleColors(styleNo).find(s => s.color.toUpperCase() === c) ?? null;
}

/**
 * IHDs saved before typed years were fixed can read 0026 for 2026. Put them
 * right — in the background, once, as the styles load.
 */
async function repairTwoDigitYearIhds() {
  const broken = allStyles.filter(s => s.ihd && Number(s.ihd.slice(0, 4)) < 100);
  for (const style of broken) {
    try {
      await setStyleIhd(style.styleNo, style.color, fixTwoDigitYear(style.ihd));
    } catch {
      /* left as is; it can be re-entered by hand */
    }
  }
  if (broken.length && typeof applyStyleFilters === "function" && getCurrentAppView() === "styles") {
    applyStyleFilters({ keepShown: true });
  }
}

/** Set (or clear, with "") one style's IHD. */
async function setStyleIhd(styleNo, color, ihd) {
  const style = findStyle(styleNo, color);
  if (!style) throw new Error(`${styleNo} ${color} isn't in the Styles database.`);
  const value = normalizeYmd(fixTwoDigitYear(ihd));
  if (value && !isPlausibleYmd(value)) throw new Error(`${value.slice(0, 4)} isn't a year.`);
  throwIfError(await requireClient().from("styles")
    .update({ ihd: value || null })
    .eq("style_no", style.styleNo).eq("color", style.color));
  style.ihd = value;
  return style;
}

/** Set (or clear, with "") one style's notes. */
async function setStyleNotes(styleNo, color, notes) {
  const style = findStyle(styleNo, color);
  if (!style) throw new Error(`${styleNo} ${color} isn't in the Styles database.`);
  const value = String(notes ?? "").trim();
  const res = await requireClient().from("styles")
    .update({ notes: value })
    .eq("style_no", style.styleNo).eq("color", style.color);
  if (res.error && /notes/.test(res.error.message ?? "")) {
    throw new Error("Notes need the notes column. Run the styles SQL in supabase-schema.sql first.");
  }
  throwIfError(res);
  style.notes = value;
  return style;
}

/** Distinct Style #s, for suggestions as you type. */
function getStyleNumbers() {
  return [...new Set(allStyles.map(s => s.styleNo))];
}

/**
 * Save new and changed styles, `onProgress(saved, total)` after each batch.
 * Batches keep each request small; a failure stops there, and what was
 * already saved stays saved (re-running the import picks up the rest).
 */
async function saveStyles(styles, onProgress) {
  const BATCH = 500;
  const client = requireClient();
  for (let i = 0; i < styles.length; i += BATCH) {
    const batch = styles.slice(i, i + BATCH);
    throwIfError(await client.from("styles").upsert(batch.map(styleToRow), { onConflict: "user_id,style_no,color" }));
    onProgress?.(Math.min(i + BATCH, styles.length), styles.length);
  }
  // Fold the saved records into the cache without a full reload.
  const byKey = new Map(allStyles.map(s => [styleKey(s.styleNo, s.color), s]));
  const now = new Date().toISOString();
  // Merged over what's cached, so fields the import doesn't carry (IHD) stay.
  styles.forEach(s => {
    const key = styleKey(s.styleNo, s.color);
    byKey.set(key, { ihd: "", notes: "", ...byKey.get(key), ...s, updatedAt: now });
  });
  allStyles = [...byKey.values()].sort((a, b) => a.styleNo.localeCompare(b.styleNo) || a.color.localeCompare(b.color));
  indexStyles();
}

// ── Style import history ─────────────────────────────────────────────────────
//
// One record per Excel import that saved anything — see style_imports in
// supabase-schema.sql. Loaded only when the history is opened: the list
// first, then one import's full set of changes when it's picked.

/** Record a finished import. `added` / `changed` as built by js/style-import.js. */
async function saveStyleImportRecord({ fileName, total, unchanged, added, changed }) {
  throwIfError(await requireClient().from("style_imports").insert({
    file_name: fileName,
    total_count: total,
    added_count: added.length,
    changed_count: changed.length,
    unchanged_count: unchanged,
    added,
    changed: changed.map(({ style, diffs }) => ({
      ...style,
      diffs: diffs.map(({ key, from, to }) => ({ key, from, to })),
    })),
  }));
}

/** Newest first, counts only. */
async function loadStyleImportHistory() {
  const res = await requireClient().from("style_imports")
    .select("id, imported_at, file_name, total_count, added_count, changed_count, unchanged_count")
    .order("imported_at", { ascending: false })
    .limit(500);
  throwIfError(res);
  return res.data.map(row => ({
    id: row.id,
    importedAt: row.imported_at,
    fileName: row.file_name,
    total: row.total_count,
    addedCount: row.added_count,
    changedCount: row.changed_count,
    unchanged: row.unchanged_count,
  }));
}

/** One import's changes, in the same shape the import preview uses. */
async function loadStyleImportChanges(id) {
  const res = await requireClient().from("style_imports")
    .select("added, changed").eq("id", id).single();
  throwIfError(res);
  return {
    added: res.data.added ?? [],
    changed: (res.data.changed ?? []).map(({ diffs, ...style }) => ({ style, diffs: diffs ?? [] })),
  };
}

// ── Need to Shoot list ───────────────────────────────────────────────────────
//
// A flag on a Style # + Color. It stays on the list — scheduled or not —
// until a photoshoot with it is marked complete; then it's recorded as shot
// (shotShootId / shotAt) and drops off. Reopening that shoot clears the
// record, so the style needs shooting again. Each one says why it's needed
// (reason, SHOOT_REASONS: New Style / New Color / Reshoot); entries from
// before reasons have none.

/** styleKey → ShootListEntry. */
let shootList = new Map();
let allPhotoshoots = [];

function setShootList(rows) {
  shootList = new Map(rows.map(row => {
    const entry = {
      styleNo: String(row.style_no ?? ""),
      color: String(row.color ?? ""),
      addedAt: String(row.added_at ?? ""),
      reason: SHOOT_REASON_KEYS.includes(row.reason) ? row.reason : "",
      shotShootId: row.shot_shoot_id ? String(row.shot_shoot_id) : "",
      shotAt: String(row.shot_at ?? ""),
    };
    return [styleKey(entry.styleNo, entry.color), entry];
  }));
}

/** COMPANY styles (NO_SHOOT_STATUSES) are never photographed. */
function isNoShootStyle(styleNo, color) {
  const status = String(findStyle(styleNo, color)?.status ?? "").trim().toUpperCase();
  return NO_SHOOT_STATUSES.includes(status);
}

/** The list, minus any no-shoot style that was added before it was ruled out. */
function getShootListEntries() {
  return [...shootList.values()].filter(e => !isNoShootStyle(e.styleNo, e.color));
}

function getShootListEntry(styleNo, color) {
  if (isNoShootStyle(styleNo, color)) return null;
  return shootList.get(styleKey(styleNo, color)) ?? null;
}

/** On the list and not yet shot. */
function needsShoot(styleNo, color) {
  const entry = getShootListEntry(styleNo, color);
  return Boolean(entry && !entry.shotShootId);
}

function shootListRow(entry) {
  return {
    style_no: entry.styleNo,
    color: entry.color,
    added_at: entry.addedAt,
    reason: entry.reason || null,
    shot_shoot_id: entry.shotShootId || null,
    shot_at: entry.shotAt || null,
  };
}

const SHOOT_REASON_SQL = "alter table shoot_list add column if not exists reason text;";

async function saveShootListEntries(entries) {
  const BATCH = 500;
  const client = requireClient();
  const anyReason = entries.some(e => e.reason);
  for (let i = 0; i < entries.length; i += BATCH) {
    let rows = entries.slice(i, i + BATCH).map(shootListRow);
    let res = await client.from("shoot_list").upsert(rows, { onConflict: "user_id,style_no,color" });
    // Before the reason column is added, entries without one still save.
    if (res.error && /reason/i.test(res.error.message ?? "")) {
      if (anyReason) throw new Error(`New Style / New Color / Reshoot need one line run in Supabase → SQL Editor first: ${SHOOT_REASON_SQL}`);
      rows = rows.map(({ reason, ...rest }) => rest);
      res = await client.from("shoot_list").upsert(rows, { onConflict: "user_id,style_no,color" });
    }
    throwIfError(res);
  }
  entries.forEach(e => shootList.set(styleKey(e.styleNo, e.color), e));
}

/**
 * Flag styles as needing a shoot, for `reason` (New Style / New Color /
 * Reshoot). Ones already waiting for that reason are left as they are, ones
 * waiting for another switch over; ones that were shot before go back on
 * the list. Returns how many were newly flagged or switched.
 */
async function addToShootList(styles, reason = "") {
  const now = new Date().toISOString();
  const changed = [];
  const seen = new Set();
  styles.forEach(({ styleNo, color }) => {
    const key = styleKey(styleNo, color);
    if (seen.has(key)) return;
    seen.add(key);
    if (isNoShootStyle(styleNo, color)) return;
    const current = shootList.get(key);
    if (current && !current.shotShootId) {
      if (reason && current.reason !== reason) changed.push({ ...current, reason });
      return;
    }
    changed.push({ styleNo, color, addedAt: now, reason, shotShootId: "", shotAt: "" });
  });
  await saveShootListEntries(changed);
  return changed.length;
}

/** Take styles off the list (they stay in any shoot they're in). */
async function removeFromShootList(styles) {
  const keys = [...new Set(styles.map(s => styleKey(s.styleNo, s.color)))].filter(k => shootList.has(k));
  const client = requireClient();
  // Two-column key, so one delete per style — ten at a time.
  for (let i = 0; i < keys.length; i += 10) {
    const chunk = keys.slice(i, i + 10);
    const results = await Promise.all(chunk.map(key => {
      const { styleNo, color } = shootList.get(key);
      return client.from("shoot_list").delete().eq("style_no", styleNo).eq("color", color);
    }));
    results.forEach(throwIfError);
    chunk.forEach(key => shootList.delete(key));
  }
  return keys.length;
}

// ── Complete: the history of styles photographed or made in CG ───────────────
//
// One row per time a style got its pictures: "photoshoot" when a shoot with
// it is marked complete (reopening the shoot takes those rows back out), or
// "cg" when it's marked complete by hand — made in Photoshop or with AI. The
// Need to Shoot entry is marked done too; a CG one keeps CG_SHOOT_ID in
// shotShootId, as there's no shoot. Later reshoots add rows, so it's a log.

const CG_SHOOT_ID = "cg";

const STYLE_COMPLETIONS_SQL = `create table if not exists style_completions (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  style_no text not null,
  color text not null,
  method text not null,
  shoot_id text,
  reason text,
  completed_at timestamptz not null default now()
);
alter table style_completions enable row level security;
drop policy if exists "style_completions: own rows only" on style_completions;
create policy "style_completions: own rows only" on style_completions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());`;

/** [{ id, styleNo, color, method: "photoshoot" | "cg", shootId, reason, completedAt }] */
let styleCompletions = [];

function completionRowToEntry(row) {
  return {
    id: String(row.id),
    styleNo: String(row.style_no ?? ""),
    color: String(row.color ?? ""),
    method: row.method === "cg" ? "cg" : "photoshoot",
    shootId: String(row.shoot_id ?? ""),
    reason: SHOOT_REASON_KEYS.includes(row.reason) ? row.reason : "",
    completedAt: String(row.completed_at ?? ""),
  };
}

/** A missing table (SQL not run yet) reads as no history. */
async function loadStyleCompletions(client) {
  const res = await client.from("style_completions").select("*");
  styleCompletions = res.error ? [] : res.data.map(completionRowToEntry);
}

function getStyleCompletions() {
  return styleCompletions;
}

function completionsTableError(err) {
  return /style_completions/.test(err?.message ?? "")
    ? new Error(`Create the style_completions table in Supabase first (SQL Editor):\n\n${STYLE_COMPLETIONS_SQL}`)
    : err;
}

async function insertStyleCompletions(entries) {
  if (!entries.length) return;
  const res = await requireClient().from("style_completions").insert(entries.map(e => ({
    id: e.id,
    style_no: e.styleNo,
    color: e.color,
    method: e.method,
    shoot_id: e.shootId || null,
    reason: e.reason || null,
    completed_at: e.completedAt,
  })));
  if (res.error) throw completionsTableError(res.error);
  styleCompletions.push(...entries);
}

/**
 * Made in Photoshop or with AI: logged as CG today, and done on Need to
 * Shoot (added there first if it wasn't). Returns how many were marked.
 */
async function markStylesCompleteCg(styles) {
  const now = new Date().toISOString();
  const seen = new Set();
  const marked = styles.filter(({ styleNo, color }) => {
    const key = styleKey(styleNo, color);
    if (seen.has(key) || isNoShootStyle(styleNo, color)) return false;
    seen.add(key);
    return true;
  });
  // The log first: if its table isn't there yet, nothing changes.
  await insertStyleCompletions(marked.map(({ styleNo, color }) => ({
    id: newRecordId("sc"),
    styleNo,
    color,
    method: "cg",
    shootId: "",
    reason: shootList.get(styleKey(styleNo, color))?.reason ?? "",
    completedAt: now,
  })));
  await saveShootListEntries(marked.map(({ styleNo, color }) => {
    const current = shootList.get(styleKey(styleNo, color));
    return {
      styleNo,
      color,
      addedAt: current?.addedAt || now,
      reason: current?.reason ?? "",
      shotShootId: CG_SHOOT_ID,
      shotAt: now,
    };
  }));
  return marked.length;
}

/**
 * Take back a CG completion. If it's still what marks the style done on
 * Need to Shoot, the style goes back to waiting there.
 */
async function undoCgCompletion(id) {
  const entry = styleCompletions.find(c => c.id === id && c.method === "cg");
  if (!entry) throw new Error("That completion isn't there any more.");
  const res = await requireClient().from("style_completions").delete().eq("id", id);
  if (res.error) throw completionsTableError(res.error);
  styleCompletions = styleCompletions.filter(c => c.id !== id);
  const current = shootList.get(styleKey(entry.styleNo, entry.color));
  if (current?.shotShootId === CG_SHOOT_ID && current.shotAt === entry.completedAt) {
    await saveShootListEntries([{ ...current, shotShootId: "", shotAt: "" }]);
  }
}

// ── Photoshoots ──────────────────────────────────────────────────────────────

function normalizePhotoshoot(raw) {
  const seen = new Set();
  return {
    id: String(raw?.id ?? ""),
    name: String(raw?.name ?? "").trim(),
    date: normalizeYmd(raw?.date),
    model: String(raw?.model ?? "").trim(),
    type: PHOTOSHOOT_TYPE_KEYS.includes(raw?.type) ? raw.type : PHOTOSHOOT_TYPE_KEYS[0],
    notes: String(raw?.notes ?? ""),
    status: raw?.status === "complete" ? "complete" : "planned",
    completedAt: String(raw?.completedAt ?? ""),
    styles: (Array.isArray(raw?.styles) ? raw.styles : [])
      .map(s => ({ styleNo: String(s?.styleNo ?? "").trim(), color: String(s?.color ?? "").trim() }))
      .filter(s => {
        const key = styleKey(s.styleNo, s.color);
        if (!s.styleNo || seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
  };
}

function photoshootRowToInput(row) {
  return {
    id: row.id,
    name: row.name,
    date: row.shoot_date,
    model: row.model,
    type: row.shoot_type,
    notes: row.notes,
    status: row.status,
    completedAt: row.completed_at,
    styles: row.styles,
  };
}

function photoshootToRow(shoot) {
  return {
    id: shoot.id,
    name: shoot.name,
    shoot_date: shoot.date,
    model: shoot.model,
    shoot_type: shoot.type,
    notes: shoot.notes,
    status: shoot.status,
    completed_at: shoot.completedAt || null,
    styles: shoot.styles,
  };
}

async function persistPhotoshoot(shoot) {
  throwIfError(await requireClient().from("photoshoots").upsert(photoshootToRow(shoot)));
}

function getAllPhotoshoots() {
  return allPhotoshoots;
}

function getPhotoshootById(id) {
  return allPhotoshoots.find(s => s.id === String(id)) ?? null;
}

/** "Fall Lookbook", or "Studio shoot" when it has no name. */
function getPhotoshootTitle(shoot) {
  return shoot?.name || `${getPhotoshootTypeLabel(shoot?.type)} shoot`;
}

/** Planned shoots a style is in, soonest first. */
function getPlannedShootsFor(styleNo, color) {
  const key = styleKey(styleNo, color);
  return allPhotoshoots
    .filter(s => s.status === "planned" && s.styles.some(x => styleKey(x.styleNo, x.color) === key))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function validatePhotoshoot(shoot) {
  if (!shoot.date) throw new Error("Pick a shoot date.");
}

/** Everything in a shoot is on the Need to Shoot list too. */
async function ensureOnShootList(styles) {
  const missing = styles.filter(s => !shootList.has(styleKey(s.styleNo, s.color)));
  if (missing.length) await addToShootList(missing);
}

async function createPhotoshoot(fields) {
  const styles = (fields.styles ?? []).filter(s => !isNoShootStyle(s.styleNo, s.color));
  const shoot = normalizePhotoshoot({ ...fields, styles, id: newRecordId("ps"), status: "planned" });
  validatePhotoshoot(shoot);
  await persistPhotoshoot(shoot);
  allPhotoshoots.push(shoot);
  await ensureOnShootList(shoot.styles);
  return shoot;
}

async function updatePhotoshoot(id, patch) {
  const shoot = getPhotoshootById(id);
  if (!shoot) throw new Error(`Photoshoot ${id} not found.`);
  const merged = normalizePhotoshoot({ ...shoot, ...patch });
  validatePhotoshoot(merged);
  await persistPhotoshoot(merged);
  Object.assign(shoot, merged);
  await ensureOnShootList(shoot.styles);
  return shoot;
}

/** Add styles to a shoot that already exists. Returns how many were new to it. */
async function addStylesToPhotoshoot(id, styles) {
  const shoot = getPhotoshootById(id);
  if (!shoot) throw new Error(`Photoshoot ${id} not found.`);
  const before = shoot.styles.length;
  const shootable = styles.filter(s => !isNoShootStyle(s.styleNo, s.color));
  await updatePhotoshoot(id, { styles: [...shoot.styles, ...shootable] });
  return shoot.styles.length - before;
}

/**
 * Done: every style in it is recorded as shot, and leaves Need to Shoot.
 */
async function completePhotoshoot(id) {
  const shoot = getPhotoshootById(id);
  if (!shoot) throw new Error(`Photoshoot ${id} not found.`);
  const now = new Date().toISOString();
  await ensureOnShootList(shoot.styles);
  // The Complete history first: if its table isn't there yet, nothing changes.
  await insertStyleCompletions(shoot.styles.map(s => ({
    id: newRecordId("sc"),
    styleNo: s.styleNo,
    color: s.color,
    method: "photoshoot",
    shootId: shoot.id,
    reason: shootList.get(styleKey(s.styleNo, s.color))?.reason ?? "",
    completedAt: now,
  })));
  await saveShootListEntries(shoot.styles.map(s => ({
    ...shootList.get(styleKey(s.styleNo, s.color)),
    shotShootId: shoot.id,
    shotAt: now,
  })));
  await updatePhotoshoot(id, { status: "complete", completedAt: now });
  return shoot;
}

/** Undo a completion: its styles need shooting again. */
async function reopenPhotoshoot(id) {
  const shoot = getPhotoshootById(id);
  if (!shoot) throw new Error(`Photoshoot ${id} not found.`);
  const unshot = getShootListEntries()
    .filter(e => e.shotShootId === shoot.id)
    .map(e => ({ ...e, shotShootId: "", shotAt: "" }));
  await saveShootListEntries(unshot);
  // Not shot after all: out of the Complete history. No table yet, nothing to take out.
  const res = await requireClient().from("style_completions").delete().eq("shoot_id", shoot.id);
  if (!res.error) styleCompletions = styleCompletions.filter(c => c.shootId !== shoot.id);
  await updatePhotoshoot(id, { status: "planned", completedAt: "" });
  return shoot;
}

/**
 * Delete a shoot. A completed one's styles are no longer recorded as shot by
 * it, so they go back on the list.
 */
async function deletePhotoshoot(id) {
  const index = allPhotoshoots.findIndex(s => s.id === String(id));
  if (index === -1) throw new Error(`Photoshoot ${id} not found.`);
  const shoot = allPhotoshoots[index];
  if (shoot.status === "complete") await reopenPhotoshoot(shoot.id);
  throwIfError(await requireClient().from("photoshoots").delete().eq("id", shoot.id));
  allPhotoshoots.splice(index, 1);
  return shoot;
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
/**
 * Move one campaign task's due date — used when its Mailchimp send time is
 * set, so the calendar shows the day the email actually goes out. Takes the
 * app-wide task id ("cp|<campaign>|<task>"); anything else is left alone.
 */
async function setCampaignTaskDueDate(appTaskId, dueDate) {
  const [prefix, campaignId, taskId] = String(appTaskId).split("|");
  if (prefix !== TASK_ID_PREFIX_CAMPAIGN || !parseYmd(dueDate)) return false;
  const campaign = getCampaignById(campaignId);
  const task = campaign?.tasks.find(t => t.id === taskId);
  if (!task || task.dueDate === dueDate) return false;
  task.dueDate = dueDate;
  await persistCampaign(campaign);
  return true;
}

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
