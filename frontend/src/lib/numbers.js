/**
 * Numeric helpers that never turn missing data into a valid-looking zero.
 * `Number(null)` is 0 and `Number("")` is 0, so every display path goes through `toNumber`.
 */
export function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatNumber(value, digits = 1, { suffix = "", prefix = "", signed = false, fallback = "N/A" } = {}) {
  const parsed = toNumber(value);
  if (parsed === null) return fallback;
  let fixed = parsed.toFixed(digits);
  if (Number(fixed) === 0) fixed = (0).toFixed(digits); // avoid "-0.000"
  const sign = signed && Number(fixed) > 0 ? "+" : "";
  return `${prefix}${sign}${fixed}${suffix}`;
}

export function formatPercent(value, digits = 1, options = {}) {
  return formatNumber(value, digits, { ...options, suffix: "%" });
}

/** Percentage change relative to |baseline|; unavailable when the baseline is missing or zero. */
export function percentChange(baseline, current) {
  const from = toNumber(baseline);
  const to = toNumber(current);
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}
