function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extreme(records, field, direction = "max") {
  return (records || []).reduce((best, record) => {
    const value = finite(record?.[field]);
    if (value === null) return best;
    if (!best) return { record, value };
    const replace = direction === "max" ? value > best.value : value < best.value;
    return replace ? { record, value } : best;
  }, null);
}

export function buildInsights(priority = [], cellFeatures = []) {
  const cells = cellFeatures.map((feature) => feature?.properties || feature).filter(Boolean);
  const highestPriority = priority[0] ? { record: priority[0], value: finite(priority[0].priority_score) } : null;
  const largestDecline = extreme(priority, "ndvi_change", "min");
  const lowestGreen = extreme(priority, "green_cover_percent", "min");
  const highestBuilt = extreme(priority, "built_up_percent", "max");
  const mostStable = [...priority]
    .map((record) => ({ record, value: finite(record.ndvi_change) }))
    .filter((item) => item.value !== null)
    .sort((a, b) => Math.abs(a.value) - Math.abs(b.value))[0];
  const highestPlantable = extreme(cells, "potential_plantable_percent", "max");

  const insights = [];
  if (highestPriority) {
    insights.push({
      id: "highest-priority",
      title: "Highest intervention priority",
      value: highestPriority.value?.toFixed(1) ?? "N/A",
      location: highestPriority.record.zone_name,
      interpretation: `${highestPriority.record.priority_class} priority reflects the strongest combined pressure across the current zone ranking.`,
      tone: "high",
    });
  }
  if (largestDecline) {
    insights.push({
      id: "largest-decline",
      title: "Largest vegetation decline",
      value: largestDecline.value.toFixed(3),
      location: largestDecline.record.zone_name,
      interpretation: "This zone shows the largest Sentinel-2 NDVI reduction from the baseline to the latest season.",
      tone: largestDecline.value < -0.05 ? "high" : "moderate",
    });
  }
  if (lowestGreen) {
    insights.push({
      id: "lowest-green",
      title: "Lowest green cover",
      value: `${lowestGreen.value.toFixed(1)}%`,
      location: lowestGreen.record.zone_name,
      interpretation: "The smallest mapped green-cover share increases the need for local ground validation and planning attention.",
      tone: "moderate",
    });
  }
  if (highestBuilt) {
    insights.push({
      id: "highest-built",
      title: "Highest built-up pressure",
      value: `${highestBuilt.value.toFixed(1)}%`,
      location: highestBuilt.record.zone_name,
      interpretation: "Dynamic World indicates the strongest built-up land-cover pressure among the five campus zones.",
      tone: "high",
    });
  }
  if (mostStable) {
    insights.push({
      id: "most-stable",
      title: "Most stable vegetation",
      value: mostStable.value >= 0 ? `+${mostStable.value.toFixed(3)}` : mostStable.value.toFixed(3),
      location: mostStable.record.zone_name,
      interpretation: "Its baseline-to-latest NDVI change is closest to zero among the zone-level series.",
      tone: "stable",
    });
  }
  if (highestPlantable && highestPlantable.value > 0) {
    insights.push({
      id: "plantable-potential",
      title: "Highest plantable potential",
      value: `${highestPlantable.value.toFixed(1)}%`,
      location: `${highestPlantable.record.cell_id} · ${highestPlantable.record.zone_name}`,
      interpretation: "This 50 m analysis cell has the largest mapped potential-plantable share and should be field-checked before action.",
      tone: "stable",
    });
  }
  return insights;
}
