/**
 * Timestamp parsing and formatting.
 * Provider timestamps without an offset are documented as Asia/Kolkata local time (UTC+05:30).
 */
export const CAMPUS_TIMEZONE = "Asia/Kolkata";
const NAIVE_OFFSET = "+05:30";
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function parseTimestamp(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (!ISO_PATTERN.test(text)) return null;
  text = text.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text = `${text}T00:00`;
  if (!HAS_OFFSET.test(text)) text = `${text}${NAIVE_OFFSET}`;
  text = text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const formatters = new Map();
function formatter(options) {
  const key = JSON.stringify(options);
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.DateTimeFormat("en-IN", { timeZone: CAMPUS_TIMEZONE, ...options }));
  }
  return formatters.get(key);
}

/** "27 Oct 2026, 5:30 pm IST" */
export function formatDateTime(value, { fallback = "Unavailable", year = true } = {}) {
  const date = parseTimestamp(value);
  if (!date) return fallback;
  const text = formatter({
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${text} IST`;
}

/** Compact axis tick: hour for short ranges, date for multi-day ranges. */
export function formatChartTick(value, rangeHours = 24) {
  const date = parseTimestamp(value);
  if (!date) return "";
  if (rangeHours <= 48) {
    return formatter({ hour: "numeric", hour12: true, ...(rangeHours > 24 ? { day: "numeric" } : {}) }).format(date);
  }
  return formatter({ day: "numeric", month: "short" }).format(date);
}

export function formatRelative(value, now = Date.now()) {
  const date = parseTimestamp(value);
  if (!date) return null;
  const seconds = Math.round((now - date.getTime()) / 1000);
  if (seconds < -60) return "in the future";
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
