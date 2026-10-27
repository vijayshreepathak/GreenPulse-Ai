/**
 * Deterministic insights. Every item lists the exact source fields it was derived from;
 * no causes are inferred.
 */
import { contributions, extreme, inlineLabel, scoredZones, topDrivers, zoneLabel } from "./analysis";
import { formatNumber, formatPercent, toNumber } from "./numbers";

const ZONE_SOURCE = "Official zone priority table (/dashboard)";

export function buildInsights(priority = [], cellFeatures = []) {
  const zones = scoredZones(priority);
  const cells = (cellFeatures || []).map((feature) => feature?.properties || feature).filter(Boolean);
  const insights = [];

  const top = zones[0];
  if (top) {
    const drivers = topDrivers(top, 2);
    insights.push({
      id: "highest-priority",
      title: "Highest official priority",
      value: formatNumber(top.priority_score, 2),
      unit: "/ 100",
      zoneId: top.zone_id,
      location: zoneLabel(top),
      tone: "urgent",
      detail: `${top.priority_class} class. Largest weighted contributors: ${drivers.map((driver) => `${inlineLabel(driver.label)} (${formatNumber(driver.contribution, 2)} pts)`).join(" and ")}.`,
      evidence: [`priority_score = ${formatNumber(top.priority_score, 2)}`, `rank = ${top.rank}`, ZONE_SOURCE],
    });
  }

  const decline = extreme(zones, "ndvi_change", "min");
  if (decline) {
    const declined = decline.value < 0;
    insights.push({
      id: "largest-decline",
      title: declined ? "Largest vegetation decline" : "No zone shows NDVI decline",
      value: formatNumber(decline.value, 3, { signed: true }),
      unit: "NDVI",
      zoneId: decline.record.zone_id,
      location: zoneLabel(decline.record),
      tone: decline.value <= -0.05 ? "high" : "moderate",
      detail: declined
        ? `Sentinel-2 ${decline.record.first_year}→${decline.record.latest_year} seasonal NDVI fell from ${formatNumber(decline.record.first_year_mean_ndvi, 3)} to ${formatNumber(decline.record.latest_year_mean_ndvi, 3)}. NDVI change alone does not establish a cause.`
        : `Smallest Sentinel-2 ${decline.record.first_year}→${decline.record.latest_year} change: NDVI went from ${formatNumber(decline.record.first_year_mean_ndvi, 3)} to ${formatNumber(decline.record.latest_year_mean_ndvi, 3)}; no scored zone declined.`,
      evidence: ["ndvi_change = latest − baseline mean NDVI", "Sentinel-2 seasonal composites"],
    });
  }

  const lowestGreen = extreme(zones, "green_cover_percent", "min");
  if (lowestGreen) {
    insights.push({
      id: "lowest-green",
      title: "Lowest green cover",
      value: formatPercent(lowestGreen.value),
      zoneId: lowestGreen.record.zone_id,
      location: zoneLabel(lowestGreen.record),
      tone: "moderate",
      detail: `Smallest mapped green-cover share among the ${zones.length} scored zones (campus-calibrated NDVI threshold).`,
      evidence: ["green_cover_percent", "thapar_zone_ndvi_green_cover.csv"],
    });
  }

  const highestBuilt = extreme(zones, "built_up_percent", "max");
  if (highestBuilt) {
    insights.push({
      id: "highest-built",
      title: "Highest built-up pressure",
      value: formatPercent(highestBuilt.value),
      zoneId: highestBuilt.record.zone_id,
      location: zoneLabel(highestBuilt.record),
      tone: "high",
      detail: "Largest Dynamic World built-up share. Dynamic World is a supporting ~10 m indicator, not building-level ground truth.",
      evidence: ["built_up_percent", "thapar_zone_land_cover.csv"],
    });
  }

  const stable = zones
    .map((record) => ({ record, value: toNumber(record.ndvi_change) }))
    .filter((item) => item.value !== null)
    .sort((a, b) => Math.abs(a.value) - Math.abs(b.value) || String(a.record.zone_id).localeCompare(String(b.record.zone_id)))[0];
  if (stable) {
    insights.push({
      id: "most-stable",
      title: "Most stable vegetation",
      value: formatNumber(stable.value, 3, { signed: true }),
      unit: "NDVI",
      zoneId: stable.record.zone_id,
      location: zoneLabel(stable.record),
      tone: "low",
      detail: "Baseline-to-latest NDVI change closest to zero among the zone series.",
      evidence: ["min |ndvi_change|", "Sentinel-2 seasonal composites"],
    });
  }

  const plantableCells = cells.filter((cell) => (toNumber(cell.potential_plantable_percent) ?? 0) > 0);
  if (cells.length) {
    const best = extreme(plantableCells, "potential_plantable_percent", "max");
    const zonesWithPotential = [...new Set(plantableCells.map((cell) => cell.zone_name || cell.zone_id))];
    insights.push({
      id: "plantable-potential",
      title: "Mapped plantable potential",
      value: String(plantableCells.length),
      unit: `of ${cells.length} cells`,
      zoneId: best?.record?.zone_id ?? null,
      cellId: best?.record?.cell_id ?? null,
      location: zonesWithPotential.length ? zonesWithPotential.join(", ") : "No cells with mapped potential",
      tone: "low",
      detail: best
        ? `Highest share: ${best.record.cell_id} (${formatPercent(best.value)}). Mapped potential is a land-cover indicator, not a validated planting site — field review is required.`
        : "No 50 m cell has a mapped potential-plantable share above zero.",
      evidence: ["potential_plantable_percent > 0", "thapar_50m_master_current_2025.csv"],
    });
  }

  const lowestTree = extreme(zones, "tree_percent", "min");
  if (lowestTree) {
    insights.push({
      id: "lowest-tree",
      title: "Lowest tree cover",
      value: formatPercent(lowestTree.value),
      zoneId: lowestTree.record.zone_id,
      location: zoneLabel(lowestTree.record),
      tone: "moderate",
      detail: `Tree-gap component ${formatNumber(contributions(lowestTree.record).find((item) => item.key === "tree_gap")?.score, 1)} of 100.`,
      evidence: ["tree_percent", "thapar_zone_land_cover.csv"],
    });
  }

  return insights;
}
