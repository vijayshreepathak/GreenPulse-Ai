import { useChartPalette } from "../../context/ThemeContext";
import { contributions } from "../../lib/analysis";
import { formatNumber, toNumber } from "../../lib/numbers";

/** Stacked weighted-contribution bar. Full width = `scale` points (default 100). */
export default function ContributionBar({ zone, scale = 100, label, showTotal = true, height = "md", decorative = false }) {
  const palette = useChartPalette();
  // Partial contributions of an unscored zone are not a score; never draw or announce them as one.
  const scored = toNumber(zone?.priority_score) !== null;
  const parts = scored ? contributions(zone) : [];
  const name = label || zone?.zone_name || "Zone";
  const description = scored
    ? `${name}: ${parts
        .filter((part) => part.contribution !== null)
        .map((part) => `${part.label} ${formatNumber(part.contribution, 2)} points`)
        .join(", ")}. Total ${formatNumber(zone.priority_score, 2)}.`
    : `${name}: official score unavailable because required inputs are missing.`;

  return (
    <div className={`contribution-bar contribution-bar--${height}`}>
      <div
        className={`contribution-bar__track${scored ? "" : " contribution-bar__track--unavailable"}`}
        {...(decorative ? { "aria-hidden": "true" } : { role: "img", "aria-label": description })}
      >
        {parts.map((part, index) =>
          part.contribution === null || part.contribution <= 0 ? null : (
            <span
              key={part.key}
              className="contribution-bar__segment"
              style={{ width: `${(part.contribution / scale) * 100}%`, backgroundColor: palette.factors[index] }}
              title={`${part.label}: ${formatNumber(part.contribution, 2)} pts (component ${formatNumber(part.score, 1)})`}
            />
          )
        )}
      </div>
      {showTotal && <span className="contribution-bar__total">{formatNumber(zone?.priority_score, 2)}</span>}
    </div>
  );
}

export function FactorLegend({ compact = false }) {
  const palette = useChartPalette();
  return (
    <ul className={`factor-legend${compact ? " factor-legend--compact" : ""}`} aria-label="Score factor colours">
      {contributions(null).map((factor, index) => (
        <li key={factor.key}>
          <i style={{ backgroundColor: palette.factors[index] }} aria-hidden="true" />
          {factor.label}
        </li>
      ))}
    </ul>
  );
}
