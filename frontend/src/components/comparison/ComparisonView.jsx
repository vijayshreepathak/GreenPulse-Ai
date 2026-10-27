import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Download, MapPin, RotateCcw } from "lucide-react";
import { useChartPalette } from "../../context/ThemeContext";
import { usePreferences } from "../../context/PreferencesContext";
import { buildSeries, zoneLabel } from "../../lib/analysis";
import { COMPARISON_METRICS, interpretComparison, MAX_COMPARE, metricSpread, toggleZone } from "../../lib/comparison";
import { dateStamp, downloadText, EXPORT_DISCLAIMER, safeFilename, toCsv } from "../../lib/csv";
import { formatNumber, toNumber } from "../../lib/numbers";
import { PriorityBadge } from "../common/Badge";
import { EmptyState, PageHeader, Panel, SectionTitle } from "../common/Primitives";
import ChartTooltip from "../charts/ChartTooltip";
import ContributionBar, { FactorLegend } from "../charts/ContributionBar";
import TrendChart from "../charts/TrendChart";

function formatMetric(metric, value) {
  if (metric.key === "rank") return value === null || value === undefined ? "—" : `#${value}`;
  return formatNumber(value, metric.digits, { suffix: metric.unit, signed: metric.signed });
}

export default function ComparisonView({ priority, compareIds, onCompareChange, zoneHistory, onFocusZone }) {
  const palette = useChartPalette();
  const { reducedMotion } = usePreferences();
  const byId = useMemo(() => new Map(priority.map((zone) => [String(zone.zone_id), zone])), [priority]);
  const selected = compareIds.map((id) => byId.get(id)).filter(Boolean);
  const colorFor = (index) => palette.compare[index % palette.compare.length];
  const enough = selected.length >= 2;
  const interpretation = enough ? interpretComparison(selected) : [];

  const barRows = ["green_cover_percent", "tree_percent", "built_up_percent"].map((key) => {
    const metric = COMPARISON_METRICS.find((item) => item.key === key);
    return { metric: metric.label, ...Object.fromEntries(selected.map((zone) => [zone.zone_id, toNumber(zone[key])])) };
  });
  const historySeries = selected.map((zone, index) => ({
    key: `z_${zone.zone_id}`,
    label: zoneLabel(zone),
    color: colorFor(index),
    emphasis: true,
    points: buildSeries(zoneHistory, { idField: "zone_id", id: zone.zone_id, field: "mean_ndvi" }),
  }));

  const reset = () => onCompareChange(priority.slice(0, 2).map((zone) => String(zone.zone_id)));

  const exportCsv = () => {
    const csv = toCsv({
      metadata: [
        ["GreenPulse AI", "Zone comparison export"],
        ["Zones", selected.map(zoneLabel).join(" vs ")],
        ["Scoring", "Official rule-based zone score (0-100)"],
        ["Exported", new Date().toISOString()],
        ["Note", EXPORT_DISCLAIMER],
      ],
      columns: [
        { key: "metric", label: "metric" },
        ...selected.map((zone) => ({ key: zone.zone_id, label: `${zone.zone_id} ${zoneLabel(zone)}` })),
        { key: "spread", label: "spread (max-min)" },
      ],
      rows: COMPARISON_METRICS.map((metric) => ({
        metric: `${metric.label}${metric.unit ? ` (${metric.unit.trim()})` : ""}`,
        ...Object.fromEntries(selected.map((zone) => [zone.zone_id, toNumber(zone[metric.key])])),
        spread: metricSpread(selected, metric.key),
      })),
    });
    downloadText(safeFilename(`greenpulse-comparison-${selected.map((zone) => zone.zone_id).join("-")}-${dateStamp()}`), csv);
  };

  return (
    <div className="view view--compare">
      <PageHeader
        id="view-title"
        eyebrow="Zone comparison"
        title="Compare campus zones"
        description="Choose two or three zones to compare their indicators and the factors behind their official scores."
        actions={
          <>
            <button type="button" className="button button--ghost" onClick={reset}><RotateCcw size={15} aria-hidden="true" /> Reset</button>
            <button type="button" className="button button--secondary" onClick={exportCsv} disabled={!enough}><Download size={15} aria-hidden="true" /> Export CSV</button>
          </>
        }
      />

      <Panel aria-label="Zone selection">
        <fieldset className="zone-picker">
          <legend>Zones to compare <span className="muted">({selected.length}/{MAX_COMPARE} selected)</span></legend>
          {priority.map((zone) => {
            const id = String(zone.zone_id);
            const index = compareIds.indexOf(id);
            const checked = index >= 0;
            const disabled = !checked && compareIds.length >= MAX_COMPARE;
            return (
              <label key={id} className={`zone-chip${checked ? " is-checked" : ""}${disabled ? " is-disabled" : ""}`}>
                <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onCompareChange(toggleZone(compareIds, id))} />
                <span className="zone-chip__swatch" style={checked ? { backgroundColor: colorFor(index) } : undefined} aria-hidden="true">{checked && <Check size={12} />}</span>
                <span>{zoneLabel(zone)}</span>
              </label>
            );
          })}
        </fieldset>
      </Panel>

      {!enough ? (
        <Panel><EmptyState title="Select at least two zones">Comparison views appear once two zones are selected.</EmptyState></Panel>
      ) : (
        <>
          <Panel aria-labelledby="interpretation-title" className="panel--accent">
            <SectionTitle id="interpretation-title" title="What the numbers show" description="Generated deterministically from the official weighted contributions." />
            <ul className="interpretation">
              {interpretation.map((sentence) => <li key={sentence}>{sentence}</li>)}
            </ul>
          </Panel>

          <Panel aria-labelledby="compare-table-title">
            <SectionTitle id="compare-table-title" title="Indicator comparison" />
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Indicator comparison table">
              <table className="data-table compare-table">
                <caption className="sr-only">Indicators for the selected zones with the spread between the highest and lowest value</caption>
                <thead>
                  <tr>
                    <th scope="col">Indicator</th>
                    {selected.map((zone, index) => (
                      <th scope="col" className="num" key={zone.zone_id}>
                        <span className="compare-head"><i style={{ backgroundColor: colorFor(index) }} aria-hidden="true" />{zoneLabel(zone)}</span>
                      </th>
                    ))}
                    <th scope="col" className="num">Spread</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Priority class</th>
                    {selected.map((zone) => <td className="num" key={zone.zone_id}><PriorityBadge priorityClass={zone.priority_class} /></td>)}
                    <td className="num muted">—</td>
                  </tr>
                  {COMPARISON_METRICS.map((metric) => (
                    <tr key={metric.key}>
                      <th scope="row">{metric.label}</th>
                      {selected.map((zone) => <td className="num" key={zone.zone_id}>{formatMetric(metric, zone[metric.key])}</td>)}
                      <td className="num muted">{metric.key === "rank" ? "—" : formatNumber(metricSpread(selected, metric.key), metric.digits, { suffix: metric.unit })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="selection__actions">
              {selected.map((zone) => (
                <button key={zone.zone_id} type="button" className="button button--ghost button--sm" onClick={() => onFocusZone(zone.zone_id)}>
                  <MapPin size={14} aria-hidden="true" /> {zoneLabel(zone)} on map
                </button>
              ))}
            </div>
          </Panel>

          <div className="two-col">
            <Panel aria-labelledby="compare-bars-title">
              <SectionTitle id="compare-bars-title" as="h3" title="Land-cover and vegetation shares" description="Percent of zone area." />
              <div className="chart-frame" style={{ height: 300 }} role="img" aria-label="Grouped bars of green cover, tree cover and built-up percentages for the selected zones">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barRows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barGap={2} barCategoryGap="24%">
                    <CartesianGrid vertical={false} stroke={palette.grid} />
                    <XAxis dataKey="metric" tickLine={false} axisLine={{ stroke: palette.axis }} tick={{ fill: palette.text, fontSize: 12 }} />
                    <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={40} tick={{ fill: palette.text, fontSize: 12 }} tickFormatter={(value) => `${value}%`} />
                    <Tooltip
                      cursor={{ fill: palette.grid, opacity: 0.5 }}
                      isAnimationActive={false}
                      wrapperStyle={{ zIndex: 5, pointerEvents: "none" }}
                      content={<ChartTooltip formatValue={(value) => (value === null || value === undefined ? "No data" : `${formatNumber(value, 1)}%`)} />}
                    />
                    <Legend verticalAlign="top" height={28} iconType="square" wrapperStyle={{ fontSize: 12, color: palette.text }} />
                    {selected.map((zone, index) => (
                      <Bar key={zone.zone_id} dataKey={zone.zone_id} name={zoneLabel(zone)} fill={colorFor(index)} radius={[4, 4, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={400} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel aria-labelledby="compare-contrib-title">
              <SectionTitle id="compare-contrib-title" as="h3" title="Score contributors" description="Weighted points per factor (bar length = official score)." />
              <FactorLegend compact />
              <ul className="contrib-list">
                {selected.map((zone, index) => (
                  <li key={zone.zone_id}>
                    <span className="compare-head"><i style={{ backgroundColor: colorFor(index) }} aria-hidden="true" />{zoneLabel(zone)}</span>
                    <ContributionBar zone={zone} />
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel aria-labelledby="compare-history-title">
            <SectionTitle id="compare-history-title" as="h3" title="Sentinel-2 NDVI history" description="Seasonal composites from the same season each year for the selected zones." />
            <ul className="chart-key" aria-label="Series key">
              {historySeries.map((item) => <li key={item.key}><i className="chart-key__line" style={{ backgroundColor: item.color }} aria-hidden="true" />{item.label}</li>)}
            </ul>
            <TrendChart series={historySeries} metric="ndvi" height={300} ariaLabel="NDVI history of the compared zones" />
          </Panel>
        </>
      )}
    </div>
  );
}
