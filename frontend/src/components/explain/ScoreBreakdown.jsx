import { useChartPalette } from "../../context/ThemeContext";
import { contributions, inlineLabel, topDrivers } from "../../lib/analysis";
import { officialWeights } from "../../lib/constants";
import { formatNumber } from "../../lib/numbers";
import ContributionBar from "../charts/ContributionBar";

/** Factor-by-factor explanation of an official zone score, sized for the map side panel. */
export default function ScoreBreakdown({ zone, scoring, freshnessLabel }) {
  const palette = useChartPalette();
  const weights = officialWeights(scoring);
  const parts = contributions(zone);
  const drivers = topDrivers(zone, 2);
  const pm = parts.find((part) => part.key === "pm_stress");
  const unavailable = zone?.score_status === "insufficient_data";

  return (
    <div className="score-breakdown" data-tour="score-breakdown">
      <ContributionBar zone={zone} />
      {unavailable ? (
        <p className="score-breakdown__summary">
          The official score is unavailable because these inputs are missing or invalid: {(zone.missing_inputs || []).join(", ")}.
        </p>
      ) : (
        <p className="score-breakdown__summary">
          Main drivers: {drivers.map((driver) => `${inlineLabel(driver.label)} (${formatNumber(driver.contribution, 2)} pts)`).join(" and ")}.
          {pm?.contribution !== null && ` Regional PM stress adds ${formatNumber(pm.contribution, 2)} pts to every zone, so it does not change the order.`}
        </p>
      )}
      <table className="data-table data-table--compact breakdown-table">
        <caption className="sr-only">Score components, weights and weighted contributions</caption>
        <thead>
          <tr>
            <th scope="col">Factor (input)</th>
            <th scope="col" className="num">Component × weight</th>
            <th scope="col" className="num">Points</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((part, index) => (
            <tr key={part.key}>
              <th scope="row">
                <span className="factor-name" title={`${part.label}: ${part.formula}`}>
                  <i style={{ backgroundColor: palette.factors[index] }} aria-hidden="true" />
                  <span>
                    {part.label}
                    <small>
                      {part.inputLabel} {formatNumber(part.input, part.inputDecimals ?? 1, { suffix: part.inputUnit, signed: part.signed })}
                    </small>
                  </span>
                </span>
              </th>
              <td className="num">
                {formatNumber(part.score, 1)} × {formatNumber(weights[part.key] * 100, 0)}%
              </td>
              <td className="num"><strong>{formatNumber(part.contribution, 2)}</strong></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>Official priority score</th>
            <td className="num"><strong>{formatNumber(zone?.priority_score, 2)}</strong></td>
          </tr>
        </tfoot>
      </table>
      <p className="fine-print">
        Inputs: Sentinel-2 green cover and NDVI change ({zone?.first_year ?? "baseline"}→{zone?.latest_year ?? "latest"}, seasonal composites);
        Dynamic World built-up and tree cover; regional modelled PM stress
        {zone?.pm_stress_source === "fallback" ? " (documented fallback 60)" : freshnessLabel ? ` (${freshnessLabel.toLowerCase()})` : ""}. Component formulas are listed in
        Insights &amp; Methodology. Points may differ from the total by ±0.01 due to rounding.
      </p>
    </div>
  );
}
