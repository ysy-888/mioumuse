/**
 * App-wide constants and small shared helpers.
 *
 * The data layer (js/store.js) talks to Supabase; everything else calls
 * through it and knows nothing about where the data actually lives.
 */

const APP_NAME = "Practice CRM";
const STORAGE_PREFIX = "practiceCrm";

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
const SUPABASE_URL = "https://ftwtcusefoddajqlnamc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0d3RjdXNlZm9kZGFqcWxuYW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNzI1ODIsImV4cCI6MjEwMjY0ODU4Mn0.AVw4k4R6-ApFbWKC8J5pIK7MexbLo1sHpknbGou7aDI";

// ── Domain vocabulary ────────────────────────────────────────────────────────

/**
 * Payroll processing cadence. A company can run more than one at a time —
 * e.g. monthly for salaried staff and bi-weekly for hourly — so this is a
 * multi-select, not a single value.
 *
 *   Monthly      — pay date is the end of every month
 *   Semi-Monthly — pay dates are the 15th and the end of every month
 *   Bi-Weekly    — every other <weekday>, anchored to a chosen first pay date
 */
const PAYROLL_SCHEDULES = ["Monthly", "Semi-Monthly", "Bi-Weekly"];

/**
 * Payroll tax deposit cadence (IRS depositor status).
 *   Quarterly    — due the last day of the month after the quarter ends
 *                  (the Form 941 deadline: Apr 30, Jul 31, Oct 31, Jan 31)
 *   Monthly      — due the 15th of the following month
 *   Semi-Weekly  — due relative to each pay date
 *
 * Listed longest-period first, matching how the schedule columns sort.
 */
const PAYROLL_TAX_SCHEDULES = ["Quarterly", "Monthly", "Semi-Weekly"];

/**
 * Sales tax filing cadence.
 *   Pre-Payment — a payment every month
 *   Quarterly   — every calendar quarter
 *   Y6          — every 6 months
 *   Y12         — annual
 *
 * Listed shortest-period first, which is also the cadence order the schedule
 * columns sort by.
 */
const SALES_TAX_SCHEDULES = ["Pre-Payment", "Quarterly", "Y6", "Y12"];

/**
 * Short forms for the narrow places — table cells, calendar chips, header
 * pills. Anything without an entry is already short enough to use as-is.
 */
const SCHEDULE_ABBREVIATIONS = {
  "Pre-Payment": "PP",
};

/** The narrow-space label for a schedule value. */
function getScheduleAbbreviation(value) {
  const s = String(value ?? "").trim();
  return SCHEDULE_ABBREVIATIONS[s] ?? s;
}

/**
 * States the practice files sales tax in, and when each one's payment is due.
 *
 * `dueDay` is the day of the month *after* the period being filed for — CA
 * wants it by the 24th, Minnesota by the 20th. Weekend handling is the same
 * as everywhere else in the app: the task moves back to the Friday before.
 */
const STATES = [
  { code: "CA", name: "California", salesTaxDueDay: 24 },
  { code: "MN", name: "Minnesota", salesTaxDueDay: 20 },
];

const STATE_CODES = STATES.map(s => s.code);

function getStateMeta(code) {
  const s = String(code ?? "").trim().toUpperCase();
  return STATES.find(state => state.code === s) ?? null;
}

function getStateName(code) {
  return getStateMeta(code)?.name ?? "";
}

/**
 * Bookkeeping account types. Accounts are a documented list per company —
 * what gets reconciled — in the same way employees are listed under a payroll
 * group. The monthly tasks are per company, not per account.
 */
const BOOKKEEPING_ACCOUNT_TYPES = ["Checking Account", "Credit Card"];

/**
 * The five service areas a company can be signed up for. `key` is what is
 * stored on the company record; `label` is what the UI shows.
 */
const SERVICES = [
  {
    key: "payroll",
    label: "Payroll",
    hint: "Payroll processing and tax payment schedules.",
  },
  {
    key: "salesTax",
    label: "Sales Tax",
    hint: "Sales tax payments and filing schedules.",
  },
  {
    key: "bookkeeping",
    label: "Bookkeeping",
    hint: "Monthly bookkeeping progress and close status.",
  },
  {
    key: "registration",
    label: "Registration",
    hint: "SOI renewal, business license renewal, and similar filings.",
  },
  {
    key: "reporting",
    label: "Reporting",
    hint: "Quarterly payroll and sales tax reporting.",
  },
];

const SERVICE_KEYS = SERVICES.map(s => s.key);

function getServiceMeta(key) {
  return SERVICES.find(s => s.key === key) ?? null;
}

function getServiceLabel(key) {
  return getServiceMeta(key)?.label ?? key;
}
