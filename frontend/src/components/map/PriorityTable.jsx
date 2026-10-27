import { zoneLabel } from "../../lib/analysis";
import { formatNumber, formatPercent, toNumber } from "../../lib/numbers";
import { PriorityBadge } from "../common/Badge";
import { EmptyState } from "../common/Primitives";
import ContributionBar from "../charts/ContributionBar";

export default function PriorityTable({ records, selectedZoneId, onSelectZone }) {
  if (!records?.length) {
    return <EmptyState title="Ranking unavailable">The official ranking appears when the required zone datasets load.</EmptyState>;
  }

  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Zone ranking table">
      <table className="data-table priority-table">
        <caption className="sr-only">Official zone environmental priority ranking. Select a zone to inspect it.</caption>
        <thead>
          <tr>
            <th scope="col" className="num">Rank</th>
            <th scope="col">Zone</th>
            <th scope="col" className="num">Green cover</th>
            <th scope="col" className="num">NDVI change</th>
            <th scope="col" className="num">Built-up</th>
            <th scope="col" className="num">Tree cover</th>
            <th scope="col" className="col-bar">Weighted contributions</th>
            <th scope="col">Class</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const selected = String(record.zone_id) === String(selectedZoneId);
            const change = toNumber(record.ndvi_change);
            return (
              <tr key={record.zone_id} className={selected ? "is-selected" : undefined} onClick={() => onSelectZone(String(record.zone_id))}>
                <td className="num"><span className="rank">{record.rank ?? "—"}</span></td>
                <th scope="row">
                  <button
                    type="button"
                    className="link-button"
                    aria-pressed={selected}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectZone(String(record.zone_id));
                    }}
                  >
                    {zoneLabel(record)}
                  </button>
                  <small className="row-meta">{record.zone_id}</small>
                </th>
                <td className="num">{formatPercent(record.green_cover_percent)}</td>
                <td className={`num ${change === null ? "" : change < 0 ? "is-negative" : "is-positive"}`}>{formatNumber(change, 3, { signed: true })}</td>
                <td className="num">{formatPercent(record.built_up_percent)}</td>
                <td className="num">{formatPercent(record.tree_percent)}</td>
                <td className="col-bar"><ContributionBar zone={record} height="sm" /></td>
                <td><PriorityBadge priorityClass={record.priority_class} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
