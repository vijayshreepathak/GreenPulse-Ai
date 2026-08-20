import { Activity, Grid3X3, LandPlot, Leaf, MapPinned, Wind } from "lucide-react";
import MetricCard from "../common/MetricCard";

function firstValue(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key];
  }
  return null;
}

export default function MetricGrid({ summary, priority, recentAqi, spatialAnalysis, loading }) {
  const topZone = priority?.[0];
  const metrics = [
    {
      label: "Campus area",
      value: firstValue(summary, ["total_area_hectares", "campus_area_hectares", "area_hectares"]),
      decimals: 1,
      suffix: " ha",
      context: "Mapped study boundary",
      icon: LandPlot,
      tone: "terrain",
    },
    {
      label: "Spatial cells analysed",
      value: spatialAnalysis?.cell_count,
      context: "Usable 50 m grid cells",
      icon: Grid3X3,
      tone: "teal",
    },
    {
      label: "Green cover",
      value: firstValue(summary, ["green_cover_percent", "campus_green_cover_percent"]),
      decimals: 1,
      suffix: "%",
      context: "Current satellite season",
      icon: Leaf,
      tone: "forest",
    },
    {
      label: "Average NDVI",
      value: firstValue(summary, ["average_ndvi", "mean_ndvi", "campus_mean_ndvi"]),
      decimals: 3,
      context: "Campus vegetation signal",
      icon: Activity,
      tone: "lime",
    },
    {
      label: "Highest-priority zone",
      displayValue: topZone?.zone_name || topZone?.zone_id || "N/A",
      context: topZone ? `${Number(topZone.priority_score).toFixed(1)} priority score` : "Awaiting zone analysis",
      icon: MapPinned,
      tone: "amber",
    },
    {
      label: "Current PM stress",
      value: recentAqi?.stress_score,
      decimals: 1,
      context: "Modeled regional context",
      icon: Wind,
      tone: "sky",
    },
  ];

  return (
    <section className="metric-grid" aria-label="Campus environmental summary">
      {metrics.map((metric, index) => (
        <MetricCard key={metric.label} {...metric} loading={loading} index={index} />
      ))}
    </section>
  );
}
