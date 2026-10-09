/**
 * App-wide constants and small shared helpers.
 *
 * The data layer (js/store.js) talks to Supabase; everything else calls
 * through it and knows nothing about where the data actually lives.
 */

const APP_NAME = "Mioumuse";
const STORAGE_PREFIX = "mioumuse";

/** localStorage key namespaced to this app — used only for small UI prefs now. */
function scopedStorageKey(base) {
  return `${STORAGE_PREFIX}.${base}`;
}

// ── Supabase ─────────────────────────────────────────────────────────────────
//
// The anon key is a public key by design — it grants nothing on its own.
// Row Level Security on every table requires a valid signed-in session before
// any row is readable or writable, so it's safe for this to sit in the
// browser's JS. Get both values from your Supabase project:
// Project Settings → API. See supabase-schema.sql for the one-time setup.
const SUPABASE_URL = "https://anzrcautqhbxdyobdyxp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFuenJjYXV0cWhieGR5b2JkeXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjAzNTMsImV4cCI6MjEwNzAzNjM1M30.np3cwEcYoy44f6nwqgUsuTiCxe01T_mJzl3H2BgVDvA";

// ── Trade shows ──────────────────────────────────────────────────────────────

/**
 * The shows on the circuit. `key` is what's stored on the record, so a label
 * can be reworded later without touching saved data; `label` is what the UI
 * shows. Each key also picks the show's colour in crm.css.
 */
const TRADE_SHOWS = [
  { key: "atlanta-apparel", label: "Atlanta Apparel" },
  { key: "dallas-market", label: "Dallas Market" },
  { key: "magic-new-york", label: "Magic New York" },
  { key: "magic-las-vegas", label: "Magic Las Vegas" },
  { key: "magic-nashville", label: "Magic Nashville" },
  { key: "flair", label: "Flair" },
];

const TRADE_SHOW_KEYS = TRADE_SHOWS.map(s => s.key);

function getTradeShowLabel(key) {
  return TRADE_SHOWS.find(s => s.key === key)?.label ?? key;
}

/**
 * The email tasks every show creates, counted back from Day 1. `key` is part
 * of the task id, so these stay stable even if a show's dates move — a
 * checked-off email stays checked off.
 */
const TRADE_SHOW_EMAIL_TASKS = [
  { key: "email-3w", label: "Email · 3 weeks out", daysBefore: 21 },
  { key: "email-1w", label: "Email · 1 week out", daysBefore: 7 },
  { key: "email-1d", label: "Email · Day before", daysBefore: 1 },
];

// ── Platforms ────────────────────────────────────────────────────────────────

/**
 * The online stores banners are made for. Same key/label split as the rest:
 * the key is stored and picks the colour in crm.css.
 */
const PLATFORMS = [
  { key: "faire", label: "Faire" },
  { key: "fashiongo", label: "FashionGo" },
  { key: "magento", label: "Magento" },
];

const PLATFORM_KEYS = PLATFORMS.map(p => p.key);

function getPlatformLabel(key) {
  return PLATFORMS.find(p => p.key === key)?.label ?? key;
}

/** What a banner is for. The first is what a new banner starts as. */
const BANNER_TYPES = [
  { key: "collection", label: "Collection" },
  { key: "display", label: "Display" },
  { key: "advertisement", label: "Advertisement" },
];

const BANNER_TYPE_KEYS = BANNER_TYPES.map(t => t.key);

function getBannerTypeLabel(key) {
  return BANNER_TYPES.find(t => t.key === key)?.label ?? key;
}

/** A banner features at least one style and at most this many. */
const MAX_BANNER_STYLES = 4;

/** Supabase Storage bucket the banner images live in (see supabase-schema.sql). */
const BANNER_BUCKET = "banners";

/** Larger than any web banner needs to be; keeps a stray photo from going up. */
const MAX_BANNER_FILE_BYTES = 10 * 1024 * 1024;

// ── Photoshoots ──────────────────────────────────────────────────────────────

/** What kind of shoot. The first is what a new shoot starts as. */
const PHOTOSHOOT_TYPES = [
  { key: "studio", label: "Studio" },
  { key: "editorial", label: "Editorial" },
];

const PHOTOSHOOT_TYPE_KEYS = PHOTOSHOOT_TYPES.map(t => t.key);

function getPhotoshootTypeLabel(key) {
  return PHOTOSHOOT_TYPES.find(t => t.key === key)?.label ?? key;
}

// ── Campaigns ────────────────────────────────────────────────────────────────

/**
 * What kind of campaign it is. Same key/label split as TRADE_SHOWS: the key is
 * stored and picks the colour in crm.css, the label is what's shown.
 */
const CAMPAIGN_TYPES = [
  { key: "sale", label: "Sale" },
  { key: "new-arrivals", label: "New Arrivals" },
  { key: "collection-launch", label: "Collection Launch" },
  { key: "holiday", label: "Holiday" },
  { key: "promotion", label: "Promotion" },
];

const CAMPAIGN_TYPE_KEYS = CAMPAIGN_TYPES.map(t => t.key);
const DEFAULT_CAMPAIGN_TYPE = "sale";

function getCampaignTypeLabel(key) {
  return CAMPAIGN_TYPES.find(t => t.key === key)?.label ?? key;
}

/**
 * The kinds of task a campaign can be given — as many of each as it needs.
 * `key` doubles as the task's calendar kind, so a campaign email and a trade
 * show email filter and draw the same way.
 */
const CAMPAIGN_TASK_CATEGORIES = [
  { key: "email", label: "Email" },
  { key: "banner", label: "Banner" },
  { key: "social", label: "Social Media" },
];

const CAMPAIGN_TASK_CATEGORY_KEYS = CAMPAIGN_TASK_CATEGORIES.map(c => c.key);

function getCampaignTaskCategoryLabel(key) {
  return CAMPAIGN_TASK_CATEGORIES.find(c => c.key === key)?.label ?? key;
}
