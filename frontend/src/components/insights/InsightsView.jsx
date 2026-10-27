import { ArrowRight, Braces, Download, FileJson, Grid3X3, Printer, Radio, Satellite } from "lucide-react";
import { FACTORS, officialWeights } from "../../lib/constants";
import { formatNumber } from "../../lib/numbers";
import { PriorityBadge } from "../common/Badge";
import { PageHeader, Panel, SectionTitle } from "../common/Primitives";
import GuidedInsights from "./GuidedInsights";
import InsightCards from "./InsightCards";

const LIMITATIONS = [
  "NDVI thresholds (green-cover share) are project-calibrated, not universal ecological classes.",
  "Dynamic World land cover is a supporting ~10 m indicator, not building-level ground truth.",
  "Satellite datasets have finite spatial resolution; small features mix within pixels and 50 m cells.",
  "Sentinel-2 seasonal and Landsat annual series come from different sensors and are never merged.",
  "PM values are regional modelled estimates near one coordinate, not zone-specific measurements.",
  "A shared regional PM score shifts every zone total equally and does not change relative order.",
  "The official priority score is zone-level; 50 m cells show indicators only.",
  "A 50 m cell with mapped plantable potential is not a validated planting site.",
  "Suggested review priorities require local ground review before any intervention.",
  "No causal link between vegetation change and air quality is claimed.",
];

const FUTURE_SCOPE = [
  "Local PM validation with an ESP32 PM2.5 / PM10 sensor node",
  "Field, drone and phone-image validation workflows",
  "Reviewed cell-level intervention scoring",
  "Machine learning (only once labelled training data exists)",
  "Plant-species recommendation",
  "PostGIS storage and GeoTIFF tile rendering",
];

export default function InsightsView({ insights, assistantContext, scoring, datasets, landsatMeta, spatial, notes, dataIssues, loading, onOpenZone, onExportRanking, onExportSnapshot, onNavigate }) {
  const weights = officialWeights(scoring);
  const sentinel = datasets?.sentinel2_zone_history || {};
  const classes = scoring?.classes || [];

  return (
    <div className="view view--insights">
      <PageHeader
        id="view-title"
        eyebrow="Insights & methodology"
        title="Evidence, explanations and limits"
        description="Deterministic findings from the loaded datasets, a rule-based question guide, and the full scoring method."
      />

      <Panel aria-labelledby="insights-title">
        <SectionTitle id="insights-title" title="Data-grounded insights" description="Each card lists the fields and files it was calculated from." />
        <InsightCards insights={insights} loading={loading} onOpenZone={onOpenZone} showEvidence />
      </Panel>

      <Panel aria-labelledby="assistant-title">
        <SectionTitle id="assistant-title" title="Guided insights" description="A data-grounded, rule-based insight assistant. Pick a question; answers come only from loaded data and documented methodology." />
        <GuidedInsights context={assistantContext} onOpenZone={onOpenZone} />
      </Panel>

      <Panel aria-labelledby="method-title">
        <SectionTitle id="method-title" title="Official scoring method" description={scoring?.method || "Transparent rule-based weighted score (not machine learning)."} />
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Scoring method table">
          <table className="data-table">
            <caption className="sr-only">Score factors, formulas, weights and sources</caption>
            <thead>
              <tr><th scope="col">Factor</th><th scope="col">Component formula (0–100)</th><th scope="col" className="num">Weight</th><th scope="col">Source</th></tr>
            </thead>
            <tbody>
              {FACTORS.map((factor) => (
                <tr key={factor.key}>
                  <th scope="row">{factor.label}</th>
                  <td><code>{factor.formula}</code></td>
                  <td className="num">{formatNumber(weights[factor.key] * 100, 0)}%</td>
                  <td>{factor.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="method-grid">
          <div>
            <h3>Priority classes</h3>
            <ul className="class-list">
              {(classes.length ? classes : [{ label: "Low", max: 30 }, { label: "Moderate", max: 50 }, { label: "High", max: 70 }, { label: "Urgent", max: 100 }]).map((item) => (
                <li key={item.label}><PriorityBadge priorityClass={item.label} /><span>{item.label === "Urgent" ? "> 70" : `≤ ${item.max}`}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Rules</h3>
            <ul className="plain-list">
              <li>NDVI change = latest − baseline Sentinel-2 season ({sentinel.baseline_year ?? "baseline"}→{sentinel.latest_year ?? "latest"}, {sentinel.season || "Oct–Dec"}).</li>
              <li>PM stress uses the latest {scoring?.pm?.averaging_records ?? 24} complete hourly records at or before the current hour; fallback {formatNumber(scoring?.pm?.fallback_score ?? 60, 0)} without usable data.</li>
              <li>Zones with missing required inputs are shown as “Unavailable”, never scored as zero.</li>
              <li>Ties are ranked by zone ID so results are deterministic.</li>
            </ul>
          </div>
        </div>
      </Panel>

      <div className="two-col">
        <Panel aria-labelledby="sources-title">
          <SectionTitle id="sources-title" as="h3" title="Data sources" />
          <ul className="source-list">
            <li><Satellite size={16} aria-hidden="true" /><div><strong>Sentinel-2 (primary)</strong><span>Zone and 50 m cell NDVI, {sentinel.baseline_year ?? "?"}–{sentinel.latest_year ?? "?"} {sentinel.season || ""} composites; NDBI, NDWI.</span></div></li>
            <li><Satellite size={16} aria-hidden="true" /><div><strong>Landsat (context)</strong><span>{landsatMeta?.baseline_year ? `${landsatMeta.baseline_year}–${landsatMeta.latest_year} annual composites, shown separately.` : "Not loaded."}</span></div></li>
            <li><Grid3X3 size={16} aria-hidden="true" /><div><strong>Dynamic World</strong><span>Tree, built-up and potential-plantable shares (supporting indicator).</span></div></li>
            <li><Grid3X3 size={16} aria-hidden="true" /><div><strong>Spatial grid</strong><span>{spatial?.cell_count ?? "?"} usable 50 m cells across 5 analysis zones.</span></div></li>
            <li><Radio size={16} aria-hidden="true" /><div><strong>Open-Meteo / CAMS</strong><span>Modelled hourly PM2.5 and PM10 near 30.356° N, 76.367° E. 10-minute cache.</span></div></li>
            <li><Braces size={16} aria-hidden="true" /><div><strong>Scoring engine</strong><span>FastAPI backend, deterministic and versioned with the code.</span></div></li>
          </ul>
        </Panel>
        <Panel aria-labelledby="limits-title">
          <SectionTitle id="limits-title" as="h3" title="Interpretation limits" />
          <ul className="plain-list plain-list--limits">
            {LIMITATIONS.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Panel>
      </div>

      <div className="two-col">
        <Panel aria-labelledby="future-title">
          <SectionTitle id="future-title" as="h3" title="Future scope (not implemented)" description="Listed for context only. None of these modules exist in this application." />
          <ul className="plain-list plain-list--future">
            {FUTURE_SCOPE.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Panel>
        <Panel aria-labelledby="exports-title">
          <SectionTitle id="exports-title" as="h3" title="Reports and exports" description="Local downloads with sources, units and dates. Not validated intervention recommendations." />
          <div className="export-actions">
            <button type="button" className="button button--secondary" onClick={onExportRanking}><Download size={15} aria-hidden="true" /> Priority ranking (CSV)</button>
            <button type="button" className="button button--secondary" onClick={onExportSnapshot}><FileJson size={15} aria-hidden="true" /> Analysis snapshot (JSON)</button>
            <button type="button" className="button button--primary" onClick={() => onNavigate("report")}><Printer size={15} aria-hidden="true" /> Printable report <ArrowRight size={14} aria-hidden="true" /></button>
          </div>
          {(dataIssues?.length > 0 || notes?.length > 5) && (
            <div className="notes-block">
              <h4>Data notes from the API</h4>
              <ul className="plain-list">
                {[...(notes || []).slice(5), ...(dataIssues || [])].map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
