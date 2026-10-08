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
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

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
