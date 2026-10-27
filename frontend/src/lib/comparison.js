/** Zone comparison rows and a deterministic, numbers-only interpretation. */
import { contributions, inlineLabel, zoneLabel } from "./analysis";
import { FACTORS } from "./constants";
import { formatNumber, toNumber } from "./numbers";

export const MAX_COMPARE = 3;

export const COMPARISON_METRICS = [
  { key: "priority_score", label: "Official priority score", digits: 2, unit: "" },
  { key: "rank", label: "Official rank", digits: 0, unit: "", lowerIsHigher: true },
  { key: "green_cover_percent", label: "Green cover", digits: 1, unit: "%" },
  { key: "tree_percent", label: "Tree cover", digits: 1, unit: "%" },
  { key: "built_up_percent", label: "Built-up", digits: 1, unit: "%" },
  { key: "mean_ndvi", label: "Mean NDVI (current)", digits: 3, unit: "" },
  { key: "ndvi_change", label: "NDVI change", digits: 3, unit: "", signed: true },
  { key: "potential_plantable_percent", label: "Plantable potential", digits: 1, unit: "%" },
  { key: "zone_area_hectares", label: "Zone area", digits: 1, unit: " ha" },
];

/** Toggle a zone in an ordered selection, keeping survivors in place (stable colour slots). */
export function toggleZone(selection, zoneId, max = MAX_COMPARE) {
  const id = String(zoneId);
  if (selection.includes(id)) return selection.filter((item) => item !== id);
  if (selection.length >= max) return selection;
  return [...selection, id];
}

export function metricSpread(zones, key) {
  const values = zones.map((zone) => toNumber(zone?.[key])).filter((value) => value !== null);
  if (values.length < 2) return null;
  return Math.max(...values) - Math.min(...values);
}

/** Pairwise explanation of adjacent zones (by official score). */
export function interpretComparison(zones) {
  const valid = zones.filter((zone) => toNumber(zone?.priority_score) !== null);
  const missing = zones.filter((zone) => toNumber(zone?.priority_score) === null);
  const sentences = [];
  if (missing.length) {
    sentences.push(`${missing.map(zoneLabel).join(", ")} ${missing.length > 1 ? "have" : "has"} no official score because required inputs are unavailable.`);
  }
  if (valid.length < 2) return sentences;

  const ordered = [...valid].sort((a, b) => b.priority_score - a.priority_score);
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const higher = ordered[index];
    const lower = ordered[index + 1];
    const gap = higher.priority_score - lower.priority_score;
    if (Math.abs(gap) < 0.005) {
      sentences.push(`${zoneLabel(higher)} and ${zoneLabel(lower)} have the same official score (${formatNumber(higher.priority_score, 2)}).`);
      continue;
    }
    const higherParts = contributions(higher);
    const lowerParts = contributions(lower);
    const deltas = FACTORS.map((factor, i) => ({
      label: inlineLabel(factor.label),
      key: factor.key,
      delta: (higherParts[i].contribution ?? 0) - (lowerParts[i].contribution ?? 0),
    })).filter((item) => item.key !== "pm_stress");
    const pushes = deltas.filter((item) => item.delta > 0.005).sort((a, b) => b.delta - a.delta);
    const offsets = deltas.filter((item) => item.delta < -0.005).sort((a, b) => a.delta - b.delta);
    let sentence = `${zoneLabel(higher)} scores ${formatNumber(gap, 2)} points above ${zoneLabel(lower)}`;
    if (pushes.length) {
      sentence += `, mainly from ${pushes.slice(0, 2).map((item) => `${item.label} (+${formatNumber(item.delta, 2)})`).join(" and ")}`;
    }
    if (offsets.length) {
      sentence += `; partly offset by ${offsets.slice(0, 2).map((item) => `${item.label} (${formatNumber(item.delta, 2)})`).join(" and ")}`;
    }
    sentences.push(`${sentence}.`);
  }
  const pm = toNumber(valid[0]?.contribution_pm_stress);
  if (pm !== null) {
    sentences.push(`Regional PM stress adds the same ${formatNumber(pm, 2)} points to every zone, so it does not change their relative order.`);
  }
  return sentences;
}
