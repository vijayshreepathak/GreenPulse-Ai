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

const palette = ["#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#e03131", "#0f766e"];

export default function NDVITrendChart({ records, selectedZone }) {
  if (!records?.length) {
    return <div className="empty-state">Historical NDVI chart is unavailable until the required CSV is placed in backend/data/raw.</div>;
  }

  const selectedZoneId = selectedZone?.zone_id;
  const filtered = selectedZoneId
    ? records.filter((record) => String(record.zone_id) === String(selectedZoneId))
    : records;

  const zones = [...new Map(filtered.map((record) => [String(record.zone_id), record.zone_name || record.zone_id])).entries()];
  const years = [...new Set(filtered.map((record) => record.year))].sort();
  const data = years.map((year) => {
    const row = { year };
    zones.forEach(([zoneId, zoneName]) => {
      const match = filtered.find((record) => String(record.zone_id) === zoneId && String(record.year) === String(year));
      row[zoneName] = match ? Number(match.mean_ndvi) : null;
    });
    return row;
  });

  return (
    <div className="chart-block">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="year" />
          <YAxis domain={["auto", "auto"]} />
          <Tooltip />
          <Legend />
          {zones.map(([, zoneName], index) => (
            <Line
              key={zoneName}
              type="monotone"
              dataKey={zoneName}
              stroke={palette[index % palette.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
