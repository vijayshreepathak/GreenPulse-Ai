import { useState } from "react";
import { Clock3, Gauge, Info, RefreshCw, WifiOff, Wind } from "lucide-react";
import { useCopilotViewContext } from "../../context/CopilotContext";
import { AIR_QUALITY_LABEL } from "../../lib/constants";
import { formatNumber } from "../../lib/numbers";
import { formatDateTime } from "../../lib/time";
import { Alert, EmptyState, PageHeader, Panel, SegmentedControl, SectionTitle, Skeleton, StatTile } from "../common/Primitives";
import AirQualityChart from "../charts/AirQualityChart";

const RANGES = [
  { value: 24, label: "24H" },
  { value: 48, label: "48H" },
  { value: 168, label: "7D" },
];

export default function AirQualityView({ environment, freshness, loading, refreshing, refreshError, online, onRefresh, scoring }) {
  const [range, setRange] = useState(24);
  useCopilotViewContext("air", { range });
  const records = environment?.records || [];
  const visible = records.slice(-range);
  const current = environment?.current || {};
  const averages = environment?.averages_24h || {};
  const components = environment?.stress_components || {};
  const quality = environment?.data_quality || {};
  const pmConfig = scoring?.pm || { pm25_full_scale: 60, pm10_full_scale: 100, pm25_weight: 0.6, pm10_weight: 0.4, fallback_score: 60 };
  const currentSource = current.source === "provider_current" ? "Provider current estimate" : current.source === "latest_hourly" ? "Latest hourly value" : "Unavailable";

  return (
    <div className="view view--air">
      <PageHeader
        id="view-title"
        eyebrow="Air quality"
        title="Modelled particulate context"
        description="Regional PM2.5 and PM10 near the campus coordinates from the Open-Meteo / CAMS model, used as a shared input to the official ranking."
        actions={
          <button type="button" className="button button--primary" onClick={onRefresh} disabled={refreshing || loading}>
            <RefreshCw size={16} className={refreshing ? "is-spinning" : ""} aria-hidden="true" />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      <div className="disclaimer" role="note">
        <Info size={17} aria-hidden="true" />
        <p><strong>{AIR_QUALITY_LABEL}</strong> PM stress is a project-specific normalised score, not an official regulatory AQI.</p>
      </div>

      {!online && (
        <Alert tone="warning" title="You are offline">Background refresh is paused. The last loaded values remain visible.</Alert>
      )}
      {refreshError && (
        <Alert tone="error" title="Refresh failed">
          {refreshError} The previously loaded values are still shown with their original timestamps.
        </Alert>
      )}
      {freshness.providerError && (
        <Alert tone="warning" title={freshness.tone === "stale" ? "Provider unavailable — showing last good data" : "Provider issue"}>
          {freshness.providerError}
        </Alert>
      )}

      <Panel className="freshness-panel" aria-label="Data freshness">
        <div className={`freshness-badge freshness-badge--${freshness.tone}`}>
          {freshness.tone === "unavailable" ? <WifiOff size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}
          <div>
            <strong>{freshness.label}</strong>
            <span>{freshness.summary}</span>
          </div>
        </div>
        <dl className="freshness-panel__facts">
          <div><dt>Model time (latest value)</dt><dd>{freshness.modelTime || "Unavailable"}</dd></div>
          <div><dt>Last successful provider fetch</dt><dd>{freshness.fetched || "Never"}</dd></div>
          <div><dt>Checked by API</dt><dd>{formatDateTime(environment?.checked_at)}</dd></div>
          <div><dt>Ranking input</dt><dd>{freshness.fallback ? `Documented fallback (${formatNumber(pmConfig.fallback_score, 0)})` : "Modelled PM stress"}</dd></div>
        </dl>
      </Panel>

      <section className="stat-grid stat-grid--6" aria-label="Particulate summary">
        <StatTile icon={Wind} label="Current PM2.5" loading={loading} value={formatNumber(current.pm2_5, 1)} unit="µg/m³" context={`${currentSource}${current.time ? ` · ${formatDateTime(current.time, { year: false })}` : ""}`} />
        <StatTile icon={Wind} label="Current PM10" loading={loading} value={formatNumber(current.pm10, 1)} unit="µg/m³" context={currentSource} />
        <StatTile label="24-h mean PM2.5" loading={loading} value={formatNumber(averages.pm2_5, 1)} unit="µg/m³" context={`${averages.record_count ?? 0} complete hourly records${averages.complete === false && averages.record_count ? " (partial)" : ""}`} />
        <StatTile label="24-h mean PM10" loading={loading} value={formatNumber(averages.pm10, 1)} unit="µg/m³" context={averages.window_start ? `${formatDateTime(averages.window_start, { year: false })} – ${formatDateTime(averages.window_end, { year: false })}` : "No averaging window"} />
        <StatTile icon={Gauge} label="Regional PM stress" loading={loading} value={formatNumber(environment?.stress_score, 1)} unit="/ 100" context={freshness.fallback ? "Fallback value" : "Normalised project score"} />
        <StatTile label="Hourly records" loading={loading} value={String(records.length)} context={`${quality.forecast_records_excluded ?? 0} future hours excluded · ${quality.invalid_values ?? 0} invalid values`} />
      </section>

      <Panel aria-labelledby="pm-chart-title">
        <div className="chart-head">
          <div>
            <h2 id="pm-chart-title">PM2.5 and PM10 history</h2>
            <p>Hourly modelled concentrations, Asia/Kolkata time · forecast hours are excluded</p>
          </div>
          <SegmentedControl label="Chart range" value={range} onChange={setRange} options={RANGES} size="sm" />
        </div>
        {loading ? (
          <Skeleton className="skeleton--chart" label="Loading air-quality history" />
        ) : visible.length ? (
          <AirQualityChart records={visible} rangeHours={range} />
        ) : (
          <EmptyState title="No modelled history">The provider is unavailable and no cached response exists. The ranking uses the documented fallback PM stress.</EmptyState>
        )}
      </Panel>

      <Panel aria-labelledby="pm-method-title">
        <SectionTitle id="pm-method-title" title="How PM stress is calculated" description="From the most recent 24 complete hourly records at or before the current hour." />
        <ol className="calc-steps">
          <li>
            <span>PM2.5 score</span>
            <code>min({formatNumber(averages.pm2_5, 2)} ÷ {formatNumber(pmConfig.pm25_full_scale, 0)} × 100, 100) = {formatNumber(components.pm25_score, 1)}</code>
          </li>
          <li>
            <span>PM10 score</span>
            <code>min({formatNumber(averages.pm10, 2)} ÷ {formatNumber(pmConfig.pm10_full_scale, 0)} × 100, 100) = {formatNumber(components.pm10_score, 1)}</code>
          </li>
          <li>
            <span>PM stress</span>
            <code>{formatNumber(pmConfig.pm25_weight, 1)} × {formatNumber(components.pm25_score, 1)} + {formatNumber(pmConfig.pm10_weight, 1)} × {formatNumber(components.pm10_score, 1)} = {formatNumber(environment?.stress_score, 1)}</code>
          </li>
        </ol>
        <p className="fine-print">
          The 60 and 100 µg/m³ values are the project's normalisation caps, not regulatory standards. Because one regional value applies to every zone,
          PM stress contributes the same points to each zone total and does not change their relative order.
        </p>
      </Panel>
    </div>
  );
}
