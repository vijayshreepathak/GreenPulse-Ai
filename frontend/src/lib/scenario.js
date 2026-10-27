/**
 * Scenario Lab: sensitivity analysis over the official component scores.
 * It never recomputes component scores (those come from the backend scoring engine) and never
 * mutates the official ranking; it only re-weights the five components hypothetically.
 */
import { FACTORS } from "./constants";
import { toNumber } from "./numbers";

export const MAX_WEIGHT = 100;

export function weightsToPercent(weights) {
  return Object.fromEntries(FACTORS.map((factor) => [factor.key, Math.round((weights[factor.key] ?? 0) * 1000) / 10]));
}

/** Coerce user input into a finite weight in [0, MAX_WEIGHT]; returns null for unusable input. */
export function sanitizeWeight(value) {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return Math.min(Math.max(parsed, 0), MAX_WEIGHT);
}

export function normalizeWeights(rawWeights) {
  const cleaned = Object.fromEntries(FACTORS.map((factor) => [factor.key, sanitizeWeight(rawWeights?.[factor.key]) ?? 0]));
  const total = Object.values(cleaned).reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return { valid: false, total: 0, raw: cleaned, effective: null };
  const effective = Object.fromEntries(FACTORS.map((factor) => [factor.key, cleaned[factor.key] / total]));
  return { valid: true, total, raw: cleaned, effective };
}

// Scores closer than this are a tie (floating-point noise, not a real difference).
const TIE_TOLERANCE = 1e-9;

/**
 * Competition ranking ("1, 2, 2, 4") on unrounded scores: equal scores share a rank. Splitting a tie
 * by zone ID, or ranking on 2-decimal rounded scores, would show rank changes that no score difference
 * supports (e.g. when only the shared PM factor is re-weighted).
 */
function rankRows(rows, scoreKey) {
  return new Map(rows.map((row) => [row.zone_id, 1 + rows.filter((other) => other[scoreKey] > row[scoreKey] + TIE_TOLERANCE).length]));
}

/**
 * @returns {{valid: boolean, total: number, effective: object|null, rows: object[], excluded: object[], hasTies: boolean, allTied: boolean}}
 */
export function simulateScenario(priority, rawWeights, officialWeights) {
  const normalized = normalizeWeights(rawWeights);
  const usable = [];
  const excluded = [];
  for (const zone of priority || []) {
    const components = Object.fromEntries(FACTORS.map((factor) => [factor.key, toNumber(zone[factor.scoreField])]));
    const official = toNumber(zone.priority_score);
    if (official === null || Object.values(components).some((value) => value === null)) excluded.push(zone);
    else usable.push({ zone, components, official });
  }
  if (!normalized.valid) return { ...normalized, rows: [], excluded, hasTies: false, allTied: false };

  const rows = usable.map(({ zone, components, official }) => {
    const simulated = FACTORS.reduce((total, factor) => total + normalized.effective[factor.key] * components[factor.key], 0);
    // Official score recomputed unrounded from the same components, so both rankings use the same precision.
    const officialRaw = FACTORS.reduce((total, factor) => total + officialWeights[factor.key] * components[factor.key], 0);
    const drivers = FACTORS.map((factor) => ({
      key: factor.key,
      label: factor.label,
      delta: (normalized.effective[factor.key] - officialWeights[factor.key]) * components[factor.key],
    })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return {
      zone_id: zone.zone_id,
      zone_name: zone.zone_name || zone.zone_id,
      officialScore: official,
      simulatedScore: Math.round(simulated * 100) / 100,
      scoreDelta: Math.round((simulated - official) * 100) / 100,
      officialRaw,
      simulatedRaw: simulated,
      drivers,
    };
  });

  const officialRanks = rankRows(rows, "officialRaw");
  const simulatedRanks = rankRows(rows, "simulatedRaw");
  const withRanks = rows
    .map((row) => {
      const officialRank = officialRanks.get(row.zone_id);
      const simulatedRank = simulatedRanks.get(row.zone_id);
      const tied = rows.some((other) => other !== row && simulatedRanks.get(other.zone_id) === simulatedRank);
      return { ...row, officialRank, simulatedRank, rankChange: officialRank - simulatedRank, tied };
    })
    .sort((a, b) => a.simulatedRank - b.simulatedRank || a.officialRank - b.officialRank || String(a.zone_id).localeCompare(String(b.zone_id)));
  const distinctRanks = new Set(withRanks.map((row) => row.simulatedRank)).size;
  return { ...normalized, rows: withRanks, excluded, hasTies: distinctRanks < rows.length, allTied: rows.length > 1 && distinctRanks === 1 };
}

export function scenarioMatchesOfficial(rawWeights, officialWeights) {
  const normalized = normalizeWeights(rawWeights);
  if (!normalized.valid) return false;
  return FACTORS.every((factor) => Math.abs(normalized.effective[factor.key] - officialWeights[factor.key]) < 1e-9);
}
