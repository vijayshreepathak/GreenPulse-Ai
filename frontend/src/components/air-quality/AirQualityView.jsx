import { RefreshCw, Wind } from "lucide-react";
import Badge from "../common/Badge";
import MetricCard from "../common/MetricCard";
import SectionHeader from "../common/SectionHeader";
import AQIChart from "../AQIChart";

function latestRecord(records = []) {
  return [...records].reverse().find((record) => record?.pm2_5 != null || record?.pm10 != null) || {};
}

function formatTimestamp(value) {
  if (!value) return "Unavailable";
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}:00+05:30`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export default function AirQualityView({ recentAqi, loading, updating, onRefresh, range, onRangeChange }) {
  const records = recentAqi?.records || [];
  const latest = latestRecord(records);
  const current = recentAqi?.current || latest;
  const averages = recentAqi?.averages_24h || {};
  const visibleRecords = records.slice(-range);
  const freshness = recentAqi?.freshness || (recentAqi?.served_from_cache ? "cached" : "live");
  const live = freshness === "live";
  const timestamp = recentAqi?.last_updated || current?.time;
  const metrics = [
    { label: "Current PM2.5", value: current?.pm2_5, decimals: 1, suffix: " μg/m³", context: "Current modeled estimate" },
    { label: "Current PM10", value: current?.pm10, decimals: 1, suffix: " μg/m³", context: "Current modeled estimate" },
    { label: "24h PM2.5 average", value: averages?.pm2_5, decimals: 1, suffix: " μg/m³", context: "Last 24 hourly values" },
    { label: "24h PM10 average", value: averages?.pm10, decimals: 1, suffix: " μg/m³", context: "Last 24 hourly values" },
    { label: "PM stress", value: recentAqi?.stress_score, decimals: 1, context: "Explainable normalized score" },
    { label: "Last updated", displayValue: formatTimestamp(timestamp), context: live ? "Live modeled conditions" : "Last good cached response" },
  ];

  return (
    <section id="air-quality" className="product-section section-anchor" aria-labelledby="air-title">
      <SectionHeader
        id="air-title"
        eyebrow="Air quality"
        title="Live modeled conditions"
        description="Regional particulate-matter context near the Thapar campus coordinates."
        action={
          <div className="air-header-actions">
            <Badge tone={live ? "forest" : "cached"}>{live ? "Live modeled" : "Cached response"}</Badge>
            <button
              className="icon-button"
              type="button"
              onClick={onRefresh}
              disabled={updating}
              aria-label="Refresh modeled air-quality data"
              title="Refresh modeled air-quality data"
            >
              <RefreshCw size={17} className={updating ? "is-spinning" : ""} />
            </button>
          </div>
        }
      />

      <div className="air-metric-grid">
        {metrics.map((metric, index) => <MetricCard key={metric.label} {...metric} icon={Wind} loading={loading} index={index} />)}
      </div>

      <div className="air-chart-surface">
        <div className="chart-title-row">
          <div><strong>PM2.5 / PM10 modeled history</strong><span>Open-Meteo / CAMS modeled estimate near Thapar campus</span></div>
          <div className="segmented-control range-control" aria-label="Air-quality chart range">
            {[24, 48, 168].map((hours) => (
              <button type="button" key={hours} className={range === hours ? "is-active" : ""} onClick={() => onRangeChange(hours)}>
                {hours === 168 ? "7D" : `${hours}H`}
              </button>
            ))}
          </div>
        </div>
        <AQIChart records={visibleRecords} />
        <p className="source-note">
          Air-quality values provide regional environmental context. They are not direct zone-level measurements.
        </p>
      </div>
    </section>
  );
}
