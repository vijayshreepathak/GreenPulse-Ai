import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useChartPalette } from "../../context/ThemeContext";
import { usePreferences } from "../../context/PreferencesContext";
import { formatNumber } from "../../lib/numbers";
import { formatChartTick, formatDateTime } from "../../lib/time";
import ChartTooltip from "./ChartTooltip";

export default function AirQualityChart({ records, rangeHours = 24, height = 320 }) {
  const palette = useChartPalette();
  const { reducedMotion } = usePreferences();
  return (
    <div className="chart-frame" style={{ height }} role="img" aria-label={`Modelled PM2.5 and PM10, last ${rangeHours} hours, micrograms per cubic metre`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={records} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke={palette.grid} />
          <XAxis
            dataKey="time"
            tickLine={false}
            axisLine={{ stroke: palette.axis }}
            minTickGap={36}
            tick={{ fill: palette.text, fontSize: 12 }}
            tickFormatter={(value) => formatChartTick(value, rangeHours)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            tick={{ fill: palette.text, fontSize: 12 }}
            tickFormatter={(value) => formatNumber(value, 0)}
            label={{ value: "µg/m³", angle: -90, position: "insideLeft", offset: 12, fill: palette.text, fontSize: 12 }}
          />
          <Tooltip
            cursor={{ stroke: palette.axis, strokeWidth: 1 }}
            allowEscapeViewBox={{ x: false, y: true }}
            wrapperStyle={{ zIndex: 5, pointerEvents: "none" }}
            isAnimationActive={false}
            content={
              <ChartTooltip
                formatLabel={(value) => formatDateTime(value)}
                formatValue={(value) => (value === null || value === undefined ? "No data" : `${formatNumber(value, 1)} µg/m³`)}
              />
            }
          />
          <Legend verticalAlign="top" align="right" height={30} iconType="plainline" wrapperStyle={{ fontSize: 12, color: palette.text }} />
          <Line type="linear" dataKey="pm2_5" name="PM2.5" stroke={palette.pm25} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={!reducedMotion} animationDuration={400} />
          <Line type="linear" dataKey="pm10" name="PM10" stroke={palette.pm10} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={!reducedMotion} animationDuration={400} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
