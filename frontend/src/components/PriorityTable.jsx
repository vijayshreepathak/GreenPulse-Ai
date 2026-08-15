const number = (value, digits = 1) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : "N/A";
};

export default function PriorityTable({ records, selectedZoneId, onSelectZone }) {
  if (!records?.length) {
    return <div className="empty-state">Priority table is unavailable until the required CSV files are placed in backend/data/raw.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Zone</th>
            <th>Green Cover %</th>
            <th>NDVI Change</th>
            <th>Built-up %</th>
            <th>Priority Score</th>
            <th>Priority Class</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const selected = String(record.zone_id) === String(selectedZoneId);
            return (
              <tr
                key={record.zone_id}
                className={selected ? "selected-row" : ""}
                onClick={() => onSelectZone(String(record.zone_id))}
              >
                <td>{record.rank}</td>
                <td>{record.zone_name || record.zone_id}</td>
                <td>{number(record.green_cover_percent)}</td>
                <td>{number(record.ndvi_change, 3)}</td>
                <td>{number(record.built_up_percent)}</td>
                <td>{number(record.priority_score)}</td>
                <td>
                  <span className={`class-badge ${String(record.priority_class || "").toLowerCase()}`}>
                    {record.priority_class || "N/A"}
                  </span>
                </td>
                <td>{record.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
