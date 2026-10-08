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
