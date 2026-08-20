import { useReducedMotion } from "framer-motion";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function TrendTooltip({ active, payload, label, metric, unit }) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value);
  return (
    <div className="chart-tooltip">
      <span>{label}</span>
      <strong>{metric}: {Number.isFinite(value) ? value.toFixed(metric === "NDVI" ? 3 : 1) : "N/A"}{unit}</strong>
    </div>
  );
}

export default function NDVITrendChart({ data, metric = "NDVI", seriesName }) {
  const reduceMotion = useReducedMotion();
  if (!data?.length) {
    return <div className="empty-state">No historical records are available for this selection.</div>;
  }

  const isNdvi = metric === "NDVI";
  const unit = isNdvi ? "" : "%";

  return (
    <div className="chart-block trend-chart" aria-label={`${seriesName} ${metric} historical chart`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 14, right: 18, left: 4, bottom: 2 }}>
          <CartesianGrid vertical={false} stroke="#dde2dc" strokeDasharray="3 5" />
          <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: "#667168", fontSize: 12 }} />
          <YAxis
            domain={isNdvi ? ["dataMin - 0.04", "dataMax + 0.04"] : [0, 100]}
            axisLine={false}
            tickLine={false}
            width={46}
            tick={{ fill: "#667168", fontSize: 12 }}
            tickFormatter={(value) => `${Number(value).toFixed(isNdvi ? 2 : 0)}${unit}`}
          />
          <Tooltip content={<TrendTooltip metric={metric} unit={unit} />} cursor={{ stroke: "#9da8a0", strokeDasharray: "4 4" }} />
          <Line
            type="linear"
            dataKey="value"
            name={seriesName}
            stroke="#246447"
            strokeWidth={2.5}
            dot={{ r: 3.5, fill: "#fffefa", strokeWidth: 2 }}
            activeDot={{ r: 5, fill: "#246447" }}
            connectNulls={false}
            isAnimationActive={!reduceMotion}
            animationDuration={600}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
