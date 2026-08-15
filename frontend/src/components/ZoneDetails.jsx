const number = (value, digits = 1) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : "N/A";
};

export default function ZoneDetails({ zone }) {
  if (!zone) {
    return <div className="empty-state">Select a zone after the priority table loads.</div>;
  }

  const rows = [
    ["Priority score", number(zone.priority_score)],
    ["Priority class", zone.priority_class || "N/A"],
    ["Mean NDVI", number(zone.mean_ndvi, 3)],
    ["Green cover", `${number(zone.green_cover_percent)}%`],
    ["Tree cover", `${number(zone.tree_percent)}%`],
    ["Built-up", `${number(zone.built_up_percent)}%`],
    ["NDVI change", number(zone.ndvi_change, 3)],
    ["AQI stress", number(zone.aqi_stress_score)],
  ];

  return (
    <div className="zone-detail">
      <h3>{zone.zone_name || zone.zone_id}</h3>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="reason">{zone.reason}</p>
    </div>
  );
}
