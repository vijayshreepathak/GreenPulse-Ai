import { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, FlaskConical, Minus, RotateCcw } from "lucide-react";
import { useChartPalette } from "../../context/ThemeContext";
import { inlineLabel } from "../../lib/analysis";
import { FACTORS, officialWeights } from "../../lib/constants";
import { dateStamp, downloadText, safeFilename, toCsv } from "../../lib/csv";
import { formatNumber } from "../../lib/numbers";
import { MAX_WEIGHT, sanitizeWeight, scenarioMatchesOfficial, simulateScenario, weightsToPercent } from "../../lib/scenario";
import { Alert, EmptyState, PageHeader, Panel, SectionTitle } from "../common/Primitives";

export const SCENARIO_LABEL = "Experimental scenario — not the official priority ranking";

function WeightControl({ factor, color, value, effective, onChange }) {
  const id = useId();
  const [draft, setDraft] = useState(null);
  const commit = (raw) => {
    const sanitized = sanitizeWeight(raw);
    setDraft(null);
    if (sanitized !== null) onChange(Math.round(sanitized));
  };
  return (
    <div className="weight-control">
      <div className="weight-control__head">
        <label htmlFor={id}>
          <i style={{ backgroundColor: color }} aria-hidden="true" />
          {factor.label}
        </label>
        <span className="weight-control__effective" title="Effective weight after normalisation">{effective === null ? "—" : `${formatNumber(effective * 100, 1)}%`}</span>
      </div>
      <div className="weight-control__inputs">
        <input
          id={id}
          type="range"
          min="0"
          max={MAX_WEIGHT}
          step="1"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-describedby={`${id}-hint`}
          aria-valuetext={`raw weight ${value}${effective === null ? "" : `, ${formatNumber(effective * 100, 1)}% effective`}`}
        />
        <input
          className="input input--number"
          type="number"
          min="0"
          max={MAX_WEIGHT}
          step="1"
          inputMode="numeric"
          aria-label={`${factor.label} raw weight`}
          value={draft ?? value}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && commit(event.currentTarget.value)}
        />
      </div>
      <small id={`${id}-hint`} className="muted">{factor.formula}</small>
    </div>
  );
}

function RankChange({ change, allTied }) {
  if (allTied) return <span className="rank-change rank-change--same"><Minus size={13} aria-hidden="true" />All tied</span>;
  if (!change) return <span className="rank-change rank-change--same"><Minus size={13} aria-hidden="true" />No change</span>;
  const up = change > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`rank-change rank-change--${up ? "up" : "down"}`}>
      <Icon size={13} aria-hidden="true" />
      {up ? "Up" : "Down"} {Math.abs(change)}
    </span>
  );
}

export default function ScenarioLab({ priority, scoring, weights, onWeightsChange }) {
  const palette = useChartPalette();
  const official = officialWeights(scoring);
  const officialPercent = useMemo(() => weightsToPercent(official), [official]);
  const result = useMemo(() => simulateScenario(priority, weights, official), [priority, weights, official]);
  const isOfficial = scenarioMatchesOfficial(weights, official);
  const changed = result.rows.filter((row) => row.rankChange !== 0);
  const summary = result.allTied
    ? "Every zone has the same scenario score, so this weighting cannot distinguish zones."
    : changed.length
      ? `${changed.length} zone${changed.length > 1 ? "s" : ""} change rank under this scenario.`
      : "Zone order is unchanged under this scenario.";
  const maxScore = Math.max(100, ...result.rows.map((row) => Math.max(row.officialScore, row.simulatedScore)));

  const setWeight = (key, value) => onWeightsChange({ ...weights, [key]: value });
  const reset = () => onWeightsChange(officialPercent);
  const equal = () => onWeightsChange(Object.fromEntries(FACTORS.map((factor) => [factor.key, 20])));

  const exportCsv = () => {
    const csv = toCsv({
      metadata: [
        ["GreenPulse AI", SCENARIO_LABEL],
        ["Raw weights", FACTORS.map((factor) => `${factor.label}=${weights[factor.key]}`).join("; ")],
        ["Effective weights", result.effective ? FACTORS.map((factor) => `${factor.label}=${formatNumber(result.effective[factor.key] * 100, 1)}%`).join("; ") : "invalid"],
        ["Exported", new Date().toISOString()],
        ["Note", "Sensitivity analysis only. Not a prediction, forecast or validated scoring model. Equal scenario scores share a rank."],
        ["Excluded (no official score)", result.excluded.map((zone) => zone.zone_id).join("; ") || "none"],
      ],
      columns: [
        { key: "result_type", label: "result_type", value: () => "hypothetical scenario" },
        { key: "zone_id", label: "zone_id" },
        { key: "zone_name", label: "zone_name" },
        { key: "officialRank", label: "official_rank" },
        { key: "officialScore", label: "official_score" },
        { key: "simulatedRank", label: "scenario_rank" },
        { key: "simulatedScore", label: "scenario_score" },
        { key: "scoreDelta", label: "score_change" },
        { key: "rankChange", label: "rank_change (positive = moved up)" },
        { key: "tied", label: "scenario_tied" },
      ],
      rows: result.rows,
    });
    downloadText(safeFilename(`greenpulse-experimental-scenario-${dateStamp()}`), csv);
  };

  return (
    <div className="view view--scenario">
      <PageHeader
        id="view-title"
        eyebrow="Scenario Lab"
        title="What-if priority analysis"
        description="Adjust the five factor weights to see how sensitive the zone order is to the weighting choice. The official ranking is never modified."
        actions={<button type="button" className="button button--secondary" onClick={exportCsv} disabled={!result.valid || !result.rows.length}><Download size={15} aria-hidden="true" /> Export scenario</button>}
      />

      <div className="experimental-banner" role="note">
        <FlaskConical size={18} aria-hidden="true" />
        <div>
          <strong>{SCENARIO_LABEL}</strong>
          <p>An interactive sensitivity analysis — not a machine-learning prediction, an intervention forecast or a validated scoring model. Scenarios are kept only for this session.</p>
        </div>
      </div>

      <div className="scenario-layout">
        <Panel aria-labelledby="weights-title" data-tour="scenario-weights">
          <SectionTitle
            id="weights-title"
            title="Factor weights"
            description="Raw weights (0–100) are normalised so the effective weights always total 100%."
          />
          <div className="weight-presets" role="group" aria-label="Weight presets">
            <button type="button" className="button button--secondary button--sm" onClick={reset} disabled={isOfficial}>
              <RotateCcw size={14} aria-hidden="true" /> Reset to official weights
            </button>
            <button type="button" className="button button--ghost button--sm" onClick={equal}>Equal weights</button>
          </div>
          <div className="weight-list">
            {FACTORS.map((factor, index) => (
              <WeightControl
                key={factor.key}
                factor={factor}
                color={palette.factors[index]}
                value={weights[factor.key] ?? 0}
                effective={result.effective ? result.effective[factor.key] : null}
                onChange={(value) => setWeight(factor.key, value)}
              />
            ))}
          </div>
          <p className={`weight-total${result.valid ? "" : " is-invalid"}`} aria-live="polite">
            Raw total <strong>{formatNumber(result.total, 0)}</strong> → effective total <strong>{result.valid ? "100%" : "—"}</strong>
            {isOfficial && <span className="badge badge--low">Official weights</span>}
          </p>
          <p className="fine-print">Official: {FACTORS.map((factor) => `${factor.label} ${formatNumber(officialPercent[factor.key], 0)}%`).join(" · ")}.</p>
        </Panel>

        <Panel aria-labelledby="scenario-results-title" className="scenario-results">
          <SectionTitle id="scenario-results-title" title="Official vs experimental ranking" description={summary} />
          {!result.valid ? (
            <Alert tone="error" title="No valid scenario">Set at least one weight above zero. Weights must be finite numbers between 0 and 100.</Alert>
          ) : !result.rows.length ? (
            <EmptyState title="No scored zones">Scenario analysis needs the official component scores.</EmptyState>
          ) : (
            <>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Scenario results table">
                <table className="data-table scenario-table">
                  <caption className="sr-only">{SCENARIO_LABEL}. Official and scenario scores and ranks for each zone.</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="num">Rank</th>
                      <th scope="col">Zone</th>
                      <th scope="col" className="col-bar">Official → scenario score</th>
                      <th scope="col" className="num">Change</th>
                      <th scope="col">vs official</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.zone_id} className={row.rankChange ? "is-changed" : undefined}>
                        <td className="num"><span className="rank">{row.simulatedRank}</span></td>
                        <th scope="row">{row.zone_name}<small className="row-meta">Official #{row.officialRank}</small></th>
                        <td className="col-bar">
                          <div className="dual-bar" aria-hidden="true">
                            <span className="dual-bar__official" style={{ width: `${(row.officialScore / maxScore) * 100}%` }} />
                            <span className="dual-bar__scenario" style={{ width: `${(row.simulatedScore / maxScore) * 100}%` }} />
                          </div>
                          <span className="dual-bar__values">{formatNumber(row.officialScore, 2)} → <strong>{formatNumber(row.simulatedScore, 2)}</strong></span>
                        </td>
                        <td className="num">{formatNumber(row.scoreDelta, 2, { signed: true })}</td>
                        <td><RankChange change={row.rankChange} allTied={result.allTied} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="chart-key" aria-label="Bar key">
                <li><i className="chart-key__swatch chart-key__swatch--official" aria-hidden="true" />Official score</li>
                <li><i className="chart-key__swatch chart-key__swatch--scenario" aria-hidden="true" />Scenario score</li>
              </ul>
              <SectionTitle as="h3" title="Why scores moved" />
              <ul className="interpretation">
                {isOfficial && <li>These are the official weights, so scenario scores equal the official scores.</li>}
                {!isOfficial && result.rows.map((row) => {
                  const lead = row.drivers[0];
                  return (
                    <li key={row.zone_id}>
                      <strong>{row.zone_name}</strong>: {formatNumber(row.scoreDelta, 2, { signed: true })} points, largest effect from {inlineLabel(lead.label)} ({formatNumber(lead.delta, 2, { signed: true })}).
                    </li>
                  );
                })}
                <li className="muted">Regional PM stress is identical for every zone. Raising its weight only rescales the other factors down; it cannot reorder zones by itself.</li>
              </ul>
              {result.hasTies && <p className="fine-print">Zones with identical scenario scores share a rank.</p>}
              {result.excluded.length > 0 && <p className="fine-print">Excluded (no official score): {result.excluded.map((zone) => zone.zone_name || zone.zone_id).join(", ")}.</p>}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
