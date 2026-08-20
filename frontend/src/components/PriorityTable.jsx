import { ArrowDown, MapPin } from "lucide-react";
import Badge from "./common/Badge";

const number = (value, digits = 1) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : "N/A";
};

function tone(priorityClass) {
  return String(priorityClass || "neutral").toLowerCase();
}

function selectFromKeyboard(event, record, onSelectZone) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelectZone(String(record.zone_id));
  }
}

export default function PriorityTable({ records, selectedZoneId, onSelectZone }) {
  if (!records?.length) {
    return <div className="empty-state empty-state--compact">Priority ranking is unavailable until the required zone datasets load.</div>;
  }

  return (
    <>
      <div className="priority-table-wrap">
        <table className="priority-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Zone</th>
              <th>Green cover</th>
              <th>NDVI change</th>
              <th>Built-up</th>
              <th>Priority score</th>
              <th>Status</th>
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
                  onKeyDown={(event) => selectFromKeyboard(event, record, onSelectZone)}
                  tabIndex={0}
                  aria-selected={selected}
                >
                  <td><span className="rank-number">{record.rank}</span></td>
                  <td><strong>{record.zone_name || record.zone_id}</strong></td>
                  <td>{number(record.green_cover_percent)}%</td>
                  <td className={Number(record.ndvi_change) < 0 ? "metric-negative" : "metric-positive"}>
                    {Number(record.ndvi_change) > 0 ? "+" : ""}{number(record.ndvi_change, 3)}
                  </td>
                  <td>{number(record.built_up_percent)}%</td>
                  <td><strong>{number(record.priority_score)}</strong></td>
                  <td><Badge tone={tone(record.priority_class)}>{record.priority_class || "N/A"}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="priority-cards" aria-label="Zone priority ranking">
        {records.map((record) => {
          const selected = String(record.zone_id) === String(selectedZoneId);
          return (
            <button
              type="button"
              key={record.zone_id}
              className={`priority-card${selected ? " is-selected" : ""}`}
              onClick={() => onSelectZone(String(record.zone_id))}
            >
              <span className="priority-card__rank">#{record.rank}</span>
              <span className="priority-card__name"><MapPin size={15} />{record.zone_name}</span>
              <Badge tone={tone(record.priority_class)}>{record.priority_class}</Badge>
              <strong>{number(record.priority_score)}</strong>
              <span className="priority-card__trend"><ArrowDown size={14} /> NDVI {number(record.ndvi_change, 3)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
