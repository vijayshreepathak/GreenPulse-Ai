/** Shared, deterministic helpers over the official priority rows and historical series. */
import { FACTORS } from "./constants";
import { formatNumber, percentChange, toNumber } from "./numbers";

export function scoredZones(priority) {
  return (priority || []).filter((zone) => zone?.score_status !== "insufficient_data" && toNumber(zone?.priority_score) !== null);
}

/** Lower-case a label for use mid-sentence while keeping acronyms ("NDVI decline", "PM stress"). */
export function inlineLabel(label) {
  const text = String(label || "");
  return /^[A-Z]{2}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

export function zoneLabel(zone) {
  if (!zone) return "Unknown zone";
  return zone.zone_name || zone.zone_id || "Unknown zone";
}

/** Contributions sorted largest first (official weights already applied by the backend). */
export function contributions(zone) {
  return FACTORS.map((factor) => ({
    ...factor,
    score: toNumber(zone?.[factor.scoreField]),
    contribution: toNumber(zone?.[factor.contributionField]),
    input: toNumber(zone?.[factor.inputField]),
  }));
}

export function topDrivers(zone, count = 2) {
  return contributions(zone)
    .filter((item) => item.contribution !== null && item.key !== "pm_stress")
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, count);
}

export const STABLE_THRESHOLDS = { ndvi: 0.01, green: 1 };

/** Year/value points sorted by year; values that are missing stay null (rendered as gaps). */
export function buildSeries(records, { idField, id, field }) {
  const byYear = new Map();
  for (const record of records || []) {
    if (String(record?.[idField]) !== String(id)) continue;
    const year = toNumber(record?.year);
    if (year === null) continue;
    byYear.set(Math.round(year), {
      year: Math.round(year),
      value: toNumber(record?.[field]),
      imageCount: toNumber(record?.image_count),
      season: record?.season ?? null,
      dataset: record?.dataset ?? null,
    });
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

export function summarizeSeries(points, metric = "ndvi") {
  const valid = (points || []).filter((point) => point.value !== null);
  const first = valid[0];
  const last = valid.at(-1);
  if (!first || !last || first.year === last.year) {
    return { baseline: first?.value ?? null, latest: last?.value ?? null, baselineYear: first?.year ?? null, latestYear: last?.year ?? null, change: null, percent: null, status: "Unavailable", threshold: STABLE_THRESHOLDS[metric] };
  }
  const change = last.value - first.value;
  const threshold = STABLE_THRESHOLDS[metric] ?? 0.01;
  const status = change <= -threshold ? "Declining" : change >= threshold ? "Improving" : "Stable";
  return {
    baseline: first.value,
    latest: last.value,
    baselineYear: first.year,
    latestYear: last.year,
    change,
    percent: percentChange(first.value, last.value),
    status,
    threshold,
  };
}

export function extreme(records, field, direction = "max") {
  return (records || []).reduce((best, record) => {
    const value = toNumber(record?.[field]);
    if (value === null) return best;
    if (!best) return { record, value };
    const replace = direction === "max" ? value > best.value : value < best.value;
    return replace ? { record, value } : best;
  }, null);
}

export function ndviChangeText(zone) {
  const change = toNumber(zone?.ndvi_change);
  if (change === null) return "NDVI change unavailable";
  const years = zone?.first_year && zone?.latest_year ? ` (${zone.first_year}→${zone.latest_year})` : "";
  return `${formatNumber(change, 3, { signed: true })}${years}`;
}
