/** Date primitives — local time throughout, so there's no timezone drift. */

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Monday-first, for lists of days a person reads ("Fri, Sat, Sun"). */
const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** [5, 6, 0] → "Fri, Sat, Sun". */
function formatWeekdayList(weekdays) {
  const set = new Set(weekdays);
  return WEEKDAY_DISPLAY_ORDER.filter(d => set.has(d)).map(d => WEEKDAY_SHORT[d]).join(", ");
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmd(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  // setFullYear, not the constructor: new Date(26, …) means 1926.
  const date = new Date(2000, 0, 1);
  date.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Typing into a date box, the browser takes the year digit by digit — "26"
 * lands as 0026. Any year under 100 is read as 20xx.
 */
function fixTwoDigitYear(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!m || Number(m[1]) >= 100) return String(value ?? "");
  return `${2000 + Number(m[1])}-${m[2]}-${m[3]}`;
}

/** A year anyone would mean: 1900–2100. Catches half-typed years like 0202. */
function isPlausibleYmd(value) {
  const year = Number(String(value ?? "").slice(0, 4));
  return Boolean(parseYmd(value)) && year >= 1900 && year <= 2100;
}

/** "2026-10-28" → "10/28/26"; "" for no date. */
function formatMdy(value) {
  const m = /^\d{2}(\d{2})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/**
 * A typed or pasted date → "YYYY-MM-DD"; "" when blank; null when it isn't
 * a date. Takes 10/28/26, 10/28/2026, 10-28-26, 10.28.26, 2026-10-28,
 * 10/28 (this year), and the same as bare digits: 1028, 102826, 10282026.
 */
function parseDateText(text) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  let y, mo, d;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    [y, mo, d] = [m[1], m[2], m[3]].map(Number);
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s)) ||
             (m = /^(\d{2})(\d{2})(\d{2}|\d{4})?$/.exec(s))) {
    [mo, d] = [m[1], m[2]].map(Number);
    y = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const value = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const date = parseYmd(value);
  // Reject 2/30 and the like, which Date would roll into March.
  if (!date || date.getMonth() !== mo - 1 || date.getDate() !== d || !isPlausibleYmd(value)) return null;
  return value;
}

/**
 * Every date box in the app: when you leave it, a two-digit year becomes
 * 20xx. Runs before the field's own handlers (capture phase), so forms read
 * the corrected value when they save.
 */
document.addEventListener("focusout", e => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.type !== "date" || !input.value) return;
  const fixed = fixTwoDigitYear(input.value);
  if (fixed === input.value) return;
  input.value = fixed;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, true);

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

/** Whole days from a to b — both "YYYY-MM-DD". */
function daysBetween(aYmd, bYmd) {
  const a = parseYmd(aYmd);
  const b = parseYmd(bYmd);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * The dates a range is actually "on": every day from startDate to endDate,
 * or only the listed weekdays when `weekdays` is non-empty.
 */
function isActiveDay({ startDate, endDate, weekdays }, dayYmd) {
  if (!startDate || dayYmd < startDate || dayYmd > (endDate || startDate)) return false;
  if (!weekdays?.length) return true;
  return weekdays.includes(parseYmd(dayYmd).getDay());
}

function listActiveDays(range) {
  const start = parseYmd(range.startDate);
  if (!start) return [];
  const total = daysBetween(range.startDate, range.endDate || range.startDate) + 1;
  const days = [];
  for (let i = 0; i < total; i++) {
    const day = ymd(addDays(start, i));
    if (isActiveDay(range, day)) days.push(day);
  }
  return days;
}

function countActiveDays(range) {
  return listActiveDays(range).length;
}

function todayYmd() {
  return ymd(new Date());
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Human-facing date, e.g. "Fri, Mar 14". */
function formatTaskDate(value) {
  const date = typeof value === "string" ? parseYmd(value) : value;
  if (!date) return EMPTY_DISPLAY;
  return `${WEEKDAY_SHORT[date.getDay()]}, ${date.toLocaleString(undefined, { month: "short" })} ${date.getDate()}`;
}

/**
 * Compact form for task cards, e.g. "3/14 Fri" — the number first, since
 * that's what you scan for, with the weekday trailing as context.
 */
function formatTaskDateShort(value) {
  const date = typeof value === "string" ? parseYmd(value) : value;
  if (!date) return EMPTY_DISPLAY;
  return `${date.getMonth() + 1}/${date.getDate()} ${WEEKDAY_SHORT[date.getDay()]}`;
}

/** "Mar 14, 2026" — for table cells, where the year matters. */
function formatLongDate(value) {
  const date = typeof value === "string" ? parseYmd(value) : value;
  if (!date) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * A short range for email copy, no year: "Oct 14–17", "Oct 30 – Nov 2",
 * "Oct 14". Month names are always English, since the copy is.
 */
function formatShortDateRange(startYmd, endYmd) {
  const start = parseYmd(startYmd);
  const end = parseYmd(endYmd);
  if (!start) return "";
  const month = d => d.toLocaleString("en-US", { month: "short" });
  const left = `${month(start)} ${start.getDate()}`;
  if (!end || startYmd === endYmd) return left;
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${left}–${end.getDate()}`;
  }
  return `${left} – ${month(end)} ${end.getDate()}`;
}

/**
 * A date range, collapsing whatever the two ends share:
 * "Oct 13 – 16, 2026", "Oct 30 – Nov 2, 2026", "Dec 30, 2026 – Jan 2, 2027".
 */
function formatDateRange(startYmd, endYmd) {
  const start = parseYmd(startYmd);
  const end = parseYmd(endYmd);
  if (!start) return "";
  if (!end || startYmd === endYmd) return formatLongDate(start);

  const month = d => d.toLocaleString(undefined, { month: "short" });
  if (start.getFullYear() !== end.getFullYear()) {
    return `${formatLongDate(start)} – ${formatLongDate(end)}`;
  }
  const right = start.getMonth() === end.getMonth()
    ? `${end.getDate()}`
    : `${month(end)} ${end.getDate()}`;
  return `${month(start)} ${start.getDate()} – ${right}, ${end.getFullYear()}`;
}
