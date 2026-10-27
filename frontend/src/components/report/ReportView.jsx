import { ArrowLeft, Printer } from "lucide-react";
import { buildSeries, inlineLabel, summarizeSeries, topDrivers, zoneLabel } from "../../lib/analysis";
import { AIR_QUALITY_LABEL, CAMPUS, FACTORS, officialWeights } from "../../lib/constants";
import { EXPORT_DISCLAIMER } from "../../lib/csv";
import { formatNumber, formatPercent } from "../../lib/numbers";
import { formatDateTime } from "../../lib/time";

export default function ReportView({ summary, priority, environment, freshness, scoring, datasets, spatial, zoneHistory, onBack }) {
  const weights = officialWeights(scoring);
  const sentinel = datasets?.sentinel2_zone_history || {};
  const top = priority.find((zone) => zone.rank === 1);

  return (
    <article className="view report" aria-labelledby="report-title">
      <div className="report__toolbar no-print">
        <button type="button" className="button button--ghost" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" /> Back to insights</button>
        <button type="button" className="button button--primary" onClick={() => window.print()}><Printer size={15} aria-hidden="true" /> Print or save as PDF</button>
      </div>

      <header className="report__header">
        <p className="eyebrow">GreenPulse AI · environmental decision-support summary</p>
        <h1 id="report-title" tabIndex={-1}>{CAMPUS.name} campus</h1>
        <p>{CAMPUS.city} · {CAMPUS.latitude}° N, {CAMPUS.longitude}° E · generated {formatDateTime(new Date())}</p>
        <p className="report__disclaimer">{EXPORT_DISCLAIMER}</p>
      </header>

      <section className="report__section">
        <h2>Key indicators</h2>
        <dl className="report__kpis">
          <div><dt>Campus area</dt><dd>{formatNumber(summary?.total_area_hectares, 1)} ha</dd></div>
          <div><dt>Green cover</dt><dd>{formatPercent(summary?.green_cover_percent)}</dd></div>
          <div><dt>Average NDVI</dt><dd>{formatNumber(summary?.average_ndvi, 3)}</dd></div>
          <div><dt>Analysis zones / 50 m cells</dt><dd>{priority.length} / {spatial?.cell_count ?? "N/A"}</dd></div>
          <div><dt>Sentinel-2 series</dt><dd>{sentinel.baseline_year && sentinel.latest_year ? `${sentinel.baseline_year}–${sentinel.latest_year}${sentinel.season ? ` (${sentinel.season})` : ""}` : "Unavailable"}</dd></div>
          <div><dt>Regional PM stress</dt><dd>{formatNumber(environment?.stress_score, 1)} / 100 ({freshness.fallback ? "fallback" : inlineLabel(freshness.label)})</dd></div>
        </dl>
      </section>

      <section className="report__section">
        <h2>Official zone priority ranking</h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Zone ranking table">
        <table className="data-table report__table">
          <thead>
            <tr>
              <th scope="col" className="num">Rank</th>
              <th scope="col">Zone</th>
              <th scope="col" className="num">Score</th>
              <th scope="col">Class</th>
              {FACTORS.map((factor) => <th scope="col" className="num" key={factor.key}>{factor.short} ({formatNumber(weights[factor.key] * 100, 0)}%)</th>)}
            </tr>
          </thead>
          <tbody>
            {priority.map((zone) => (
              <tr key={zone.zone_id}>
                <td className="num">{zone.rank ?? "—"}</td>
                <th scope="row">{zoneLabel(zone)}</th>
                <td className="num"><strong>{formatNumber(zone.priority_score, 2)}</strong></td>
                <td>{zone.priority_class}</td>
                {FACTORS.map((factor) => <td className="num" key={factor.key}>{formatNumber(zone[factor.contributionField], 2)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className="report__note">Factor columns show weighted points. {top ? `${zoneLabel(top)} ranks first, driven mainly by ${topDrivers(top, 2).map((driver) => inlineLabel(driver.label)).join(" and ")}.` : ""} Regional PM stress adds equal points to every zone.</p>
      </section>

      <section className="report__section">
        <h2>Vegetation change (Sentinel-2{sentinel.season ? `, ${sentinel.season}` : ""})</h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Vegetation change table">
        <table className="data-table report__table">
          <thead>
            <tr><th scope="col">Zone</th><th scope="col" className="num">Baseline NDVI</th><th scope="col" className="num">Latest NDVI</th><th scope="col" className="num">Change</th><th scope="col">Status</th></tr>
          </thead>
          <tbody>
            {priority.map((zone) => {
              const trend = summarizeSeries(buildSeries(zoneHistory, { idField: "zone_id", id: zone.zone_id, field: "mean_ndvi" }), "ndvi");
              return (
                <tr key={zone.zone_id}>
                  <th scope="row">{zoneLabel(zone)}</th>
                  <td className="num">{formatNumber(trend.baseline, 3)} ({trend.baselineYear})</td>
                  <td className="num">{formatNumber(trend.latest, 3)} ({trend.latestYear})</td>
                  <td className="num">{formatNumber(trend.change, 3, { signed: true })}</td>
                  <td>{trend.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>

      <section className="report__section">
        <h2>Modelled air quality</h2>
        <p>{AIR_QUALITY_LABEL}</p>
        <ul>
          <li>Status: {freshness.label}. Model time: {freshness.modelTime || "unavailable"}. Last provider fetch: {freshness.fetched || "never"}.</li>
          <li>24-hour mean PM2.5 {formatNumber(environment?.averages_24h?.pm2_5, 1)} µg/m³ and PM10 {formatNumber(environment?.averages_24h?.pm10, 1)} µg/m³ ({environment?.averages_24h?.record_count ?? 0} records).</li>
          <li>PM stress {formatNumber(environment?.stress_score, 1)} / 100 — a project normalisation, not an official AQI.</li>
        </ul>
      </section>

      <section className="report__section">
        <h2>Method and limitations</h2>
        <ul>
          <li>Priority = {FACTORS.map((factor) => `${formatNumber(weights[factor.key], 2)} × ${factor.label}`).join(" + ")}. Classes: ≤30 Low, ≤50 Moderate, ≤70 High, &gt;70 Urgent.</li>
          <li>NDVI thresholds are project-calibrated; Dynamic World is a supporting indicator; satellite resolution is finite.</li>
          <li>Sentinel-2 and Landsat are separate series. The official score is zone-level; 50 m cells are indicators only.</li>
          <li>Mapped plantable potential is not a validated planting site. All priorities require local ground review. No causal claims are made.</li>
        </ul>
      </section>
    </article>
  );
}
