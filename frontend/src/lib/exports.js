import { FACTORS } from "./constants";
import { dateStamp, downloadText, EXPORT_DISCLAIMER, safeFilename, toCsv } from "./csv";

export function priorityCsv({ priority, environment, datasets }) {
  const sentinel = datasets?.sentinel2_zone_history || {};
  return toCsv({
    metadata: [
      ["GreenPulse AI", "Official zone environmental priority ranking"],
      ["Method", "Transparent rule-based weighted score, zone level (not ML)"],
      ["Vegetation data", `Sentinel-2 ${sentinel.season ?? "seasonal"} composites ${sentinel.baseline_year ?? "?"}-${sentinel.latest_year ?? "?"}; Dynamic World land cover`],
      ["PM stress", `${environment?.pm_stress_source === "modelled" ? "Modelled Open-Meteo/CAMS" : "Documented fallback 60"}; freshness=${environment?.freshness ?? "unknown"}; model time=${environment?.last_updated ?? "n/a"} (Asia/Kolkata)`],
      ["Units", "percent columns in %; NDVI unitless; scores 0-100; contributions in score points"],
      ["Exported", new Date().toISOString()],
      ["Note", EXPORT_DISCLAIMER],
    ],
    columns: [
      { key: "rank", label: "rank" },
      { key: "zone_id", label: "zone_id" },
      { key: "zone_name", label: "zone_name" },
      { key: "priority_score", label: "priority_score" },
      { key: "priority_class", label: "priority_class" },
      { key: "score_status", label: "score_status" },
      { key: "green_cover_percent", label: "green_cover_percent" },
      { key: "tree_percent", label: "tree_percent" },
      { key: "built_up_percent", label: "built_up_percent" },
      { key: "mean_ndvi", label: "mean_ndvi" },
      { key: "first_year", label: "ndvi_baseline_year" },
      { key: "latest_year", label: "ndvi_latest_year" },
      { key: "ndvi_change", label: "ndvi_change" },
      ...FACTORS.map((factor) => ({ key: factor.scoreField, label: factor.scoreField })),
      ...FACTORS.map((factor) => ({ key: factor.contributionField, label: factor.contributionField })),
      { key: "pm_stress_source", label: "pm_stress_source" },
      { key: "reason", label: "reason" },
    ],
    rows: priority,
  });
}

export function analysisSnapshot({ summary, priority, environment, scoring, datasets, spatial, landsatMeta, notes, dataIssues }) {
  const { records, ...environmentSummary } = environment || {};
  return {
    application: "GreenPulse AI",
    exported_at: new Date().toISOString(),
    disclaimer: EXPORT_DISCLAIMER,
    study_area: { name: "Thapar Institute of Engineering and Technology campus", latitude: 30.356, longitude: 76.367 },
    campus_summary: summary,
    scoring_methodology: scoring,
    official_priority: priority,
    modelled_air_quality: { ...environmentSummary, hourly_record_count: records?.length ?? 0, hourly_records: records ?? [] },
    datasets: { ...datasets, landsat_context: landsatMeta, spatial_grid: spatial },
    notes,
    data_issues: dataIssues,
  };
}

export function downloadPriorityCsv(context) {
  downloadText(safeFilename(`greenpulse-priority-ranking-${dateStamp()}`), priorityCsv(context));
}

export function downloadSnapshot(context) {
  downloadText(safeFilename(`greenpulse-analysis-snapshot-${dateStamp()}`, "json"), `${JSON.stringify(analysisSnapshot(context), null, 2)}\n`, "application/json");
}
