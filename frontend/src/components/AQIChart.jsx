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

export default function AQIChart({ recentAqi }) {
  const records = recentAqi?.records || [];

  if (!records.length) {
    return <div className="empty-state">Recent PM chart is unavailable until Open-Meteo data or a cached CSV is available.</div>;
  }

  return (
    <div className="chart-block">
      <p className="chart-note">Modeled PM estimate near Thapar campus from Open-Meteo.</p>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={records} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" minTickGap={36} />
          <YAxis label={{ value: "ug/m3", angle: -90, position: "insideLeft" }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="pm2_5" name="PM2.5" stroke="#e03131" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="pm10" name="PM10" stroke="#1971c2" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
