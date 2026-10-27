import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useChartPalette } from "../../context/ThemeContext";
import { usePreferences } from "../../context/PreferencesContext";
import { formatNumber } from "../../lib/numbers";
import ChartTooltip from "./ChartTooltip";

function ndviDomain(series) {
  const values = series.flatMap((item) => item.points.map((point) => point.value)).filter((value) => value !== null);
  if (!values.length) return [0, 1];
  const min = Math.floor((Math.min(...values) - 0.02) * 20) / 20;
  const max = Math.ceil((Math.max(...values) + 0.02) * 20) / 20;
  return [Math.max(-1, min), Math.min(1, max)];
}

/**
 * Year-based line chart. `series`: [{ key, label, color?, emphasis, points: [{year, value}] }].
 * Context series (emphasis false) render as thin grey lines behind the emphasised ones.
 */
export default function TrendChart({ series, metric = "ndvi", height = 320, ariaLabel }) {
  const palette = useChartPalette();
  const { reducedMotion } = usePreferences();
  const isNdvi = metric === "ndvi";
  const unit = isNdvi ? "" : "%";
  const digits = isNdvi ? 3 : 1;

  const rows = useMemo(() => {
    const byYear = new Map();
    for (const item of series) {
      for (const point of item.points) {
        const row = byYear.get(point.year) || { year: point.year };
        row[item.key] = point.value;
        byYear.set(point.year, row);
      }
    }
    return [...byYear.values()].sort((a, b) => a.year - b.year);
  }, [series]);

  const ordered = [...series].sort((a, b) => Number(a.emphasis) - Number(b.emphasis));
  const contextKeys = series.filter((item) => !item.emphasis).map((item) => item.key);
  const domain = isNdvi ? ndviDomain(series) : [0, 100];
  const ticks = isNdvi ? Array.from({ length: Math.round((domain[1] - domain[0]) / 0.05) + 1 }, (_, i) => Math.round((domain[0] + i * 0.05) * 100) / 100) : [0, 25, 50, 75, 100];

  return (
    <div className="chart-frame" style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke={palette.grid} />
          <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: palette.axis }} tick={{ fill: palette.text, fontSize: 12 }} interval="preserveStartEnd" />
          <YAxis
            domain={domain}
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fill: palette.text, fontSize: 12 }}
            tickFormatter={(value) => `${formatNumber(value, isNdvi ? 2 : 0)}${unit}`}
          />
          <Tooltip
            cursor={{ stroke: palette.axis, strokeWidth: 1 }}
            allowEscapeViewBox={{ x: false, y: true }}
            wrapperStyle={{ zIndex: 5, pointerEvents: "none" }}
            isAnimationActive={false}
            content={
              <ChartTooltip
                hideKeys={contextKeys.length > 3 ? contextKeys : []}
                formatValue={(value) => (value === null || value === undefined ? "No data" : `${formatNumber(value, digits)}${unit}`)}
              />
            }
          />
          {ordered.map((item) => (
            <Line
              key={item.key}
              type="linear"
              dataKey={item.key}
              name={item.label}
              stroke={item.emphasis ? item.color || palette.primary : palette.context}
              strokeWidth={item.emphasis ? 2.5 : 1.25}
              dot={item.emphasis ? { r: 4, strokeWidth: 2, fill: palette.surface } : false}
              activeDot={item.emphasis ? { r: 5, strokeWidth: 2, stroke: palette.surface } : false}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
              animationDuration={450}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
