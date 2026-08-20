import { useReducedMotion } from "framer-motion";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function formatTime(value, compact = false) {
  if (!value) return "N/A";
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}:00+05:30`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", compact
    ? { day: "numeric", hour: "numeric", timeZone: "Asia/Kolkata" }
    : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }
  ).format(date);
}

function AirTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <span>{formatTime(label)}</span>
      {payload.map((item) => (
        <strong key={item.dataKey} style={{ color: item.color }}>
          {item.name}: {Number(item.value).toFixed(1)} μg/m³
        </strong>
      ))}
    </div>
  );
}

export default function AQIChart({ records }) {
  const reduceMotion = useReducedMotion();
  if (!records?.length) {
    return <div className="empty-state">Modeled PM history is unavailable and no cached response could be loaded.</div>;
  }

  return (
    <div className="chart-block air-chart" aria-label="Modeled PM2.5 and PM10 history chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={records} margin={{ top: 12, right: 18, left: 0, bottom: 2 }}>
          <CartesianGrid vertical={false} stroke="#dde2dc" strokeDasharray="3 5" />
          <XAxis
            dataKey="time"
            axisLine={false}
            tickLine={false}
            minTickGap={42}
            tick={{ fill: "#667168", fontSize: 12 }}
            tickFormatter={(value) => formatTime(value, true)}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={46}
            tick={{ fill: "#667168", fontSize: 12 }}
            label={{ value: "μg/m³", angle: -90, position: "insideLeft", fill: "#667168", fontSize: 11 }}
          />
          <Tooltip content={<AirTooltip />} cursor={{ stroke: "#9da8a0", strokeDasharray: "4 4" }} />
          <Legend verticalAlign="top" align="right" height={34} iconType="line" />
          <Line type="linear" dataKey="pm2_5" name="PM2.5" stroke="#b54d32" strokeWidth={2.3} dot={false} connectNulls={false} isAnimationActive={!reduceMotion} animationDuration={550} />
          <Line type="linear" dataKey="pm10" name="PM10" stroke="#31777a" strokeWidth={2.3} dot={false} connectNulls={false} isAnimationActive={!reduceMotion} animationDuration={550} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
