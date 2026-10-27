import { Grid3X3, LineChart, MapPin, Sprout } from "lucide-react";
import { ndviChangeText, zoneLabel } from "../../lib/analysis";
import { formatNumber, formatPercent, toNumber } from "../../lib/numbers";
import { PriorityBadge } from "../common/Badge";
import { EmptyState } from "../common/Primitives";
import ScoreBreakdown from "../explain/ScoreBreakdown";

function Metric({ label, value, hint }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{value}{hint && <small>{hint}</small>}</dd>
    </div>
  );
}

function Meter({ label, value }) {
  const numeric = toNumber(value);
  return (
    <div className="meter">
      <div className="meter__row"><span>{label}</span><strong>{formatPercent(value)}</strong></div>
      <span className="meter__track" aria-hidden="true">
        {numeric !== null && <span className="meter__fill" style={{ width: `${Math.min(Math.max(numeric, 0), 100)}%` }} />}
      </span>
    </div>
  );
}

function CellDetails({ cell, zone, onViewHistory, onSelectZone }) {
  const plantable = toNumber(cell.potential_plantable_percent);
  return (
    <>
      <header className="selection__header">
        <div>
          <p className="eyebrow"><Grid3X3 size={13} aria-hidden="true" /> 50 m analysis cell</p>
          <h2 className="selection__title">{cell.cell_id}</h2>
          <p className="selection__subtitle">{cell.zone_name || cell.zone_id}</p>
        </div>
      </header>
      <p className="note-box">
        Cell-level environmental indicators. The official priority score is calculated per zone, not per cell.
      </p>
      <dl className="kv-grid">
        <Metric label="Mean NDVI" value={formatNumber(cell.mean_ndvi, 3)} />
        <Metric label={`NDVI change ${cell.baseline_year ?? ""}→${cell.latest_year ?? ""}`} value={formatNumber(cell.ndvi_change, 3, { signed: true })} />
        <Metric label="Mean NDBI" value={formatNumber(cell.mean_ndbi, 3, { signed: true })} />
        <Metric label="Mean NDWI" value={formatNumber(cell.mean_ndwi, 3, { signed: true })} />
      </dl>
      <div className="meter-list">
        <Meter label="Green cover" value={cell.green_cover_percent} />
        <Meter label="Tree cover" value={cell.tree_percent} />
        <Meter label="Built-up" value={cell.built_up_percent} />
        <Meter label="Plantable potential" value={cell.potential_plantable_percent} />
      </div>
      {plantable !== null && plantable > 0 && (
        <p className="note-box note-box--accent">
          <Sprout size={15} aria-hidden="true" /> Mapped plantable potential is a land-cover indicator, not a validated planting site. Local ground review is required.
        </p>
      )}
      <dl className="kv-grid">
        <Metric label="Cell area in campus" value={formatNumber(cell.cell_area_m2, 0, { suffix: " m²" })} />
        <Metric label="Overlap with zone" value={formatPercent(cell.zone_overlap_percent)} />
      </dl>
      <div className="selection__actions">
        <button className="button button--secondary" type="button" onClick={onViewHistory}>
          <LineChart size={15} aria-hidden="true" /> Cell NDVI history
        </button>
        {zone && (
          <button className="button button--ghost" type="button" onClick={() => onSelectZone(zone.zone_id)}>
            <MapPin size={15} aria-hidden="true" /> Parent zone score
          </button>
        )}
      </div>
      {zone && (
        <p className="fine-print">
          Parent zone ({zoneLabel(zone)}) official priority: {formatNumber(zone.priority_score, 2)} · {zone.priority_class}. This zone-level score is not a property of the cell.
        </p>
      )}
    </>
  );
}

export default function SelectionPanel({ zone, cell, scoring, freshnessLabel, rankedCount, onViewHistory, onSelectZone }) {
  if (!zone && !cell) {
    return <EmptyState title="Nothing selected">Select a zone or a 50 m cell on the map, or a row in the ranking.</EmptyState>;
  }

  return (
    // Keyed so the short CSS entrance animation replays per selection (disabled under reduced motion).
    <div className="selection" key={cell ? cell.cell_id : zone.zone_id} aria-live="polite">
      {cell ? (
        <CellDetails cell={cell} zone={zone} onViewHistory={onViewHistory} onSelectZone={onSelectZone} />
      ) : (
        <>
          <header className="selection__header">
            <div>
              <p className="eyebrow"><MapPin size={13} aria-hidden="true" /> Zone · rank {zone.rank ?? "—"}{rankedCount ? ` of ${rankedCount}` : ""}</p>
              <h2 className="selection__title">{zoneLabel(zone)}</h2>
              <p className="selection__subtitle">{zone.zone_id} · {formatNumber(zone.zone_area_hectares, 1, { suffix: " ha" })}</p>
            </div>
            <div className="selection__score">
              <PriorityBadge priorityClass={zone.priority_class} />
              <strong>{formatNumber(zone.priority_score, 2)}</strong>
              <small>official score / 100</small>
            </div>
          </header>
          <ScoreBreakdown zone={zone} scoring={scoring} freshnessLabel={freshnessLabel} />
          <dl className="kv-grid">
            <Metric label="Mean NDVI (current)" value={formatNumber(zone.mean_ndvi, 3)} />
            <Metric label="NDVI change" value={ndviChangeText(zone)} />
          </dl>
          <div className="meter-list">
            <Meter label="Green cover" value={zone.green_cover_percent} />
            <Meter label="Tree cover" value={zone.tree_percent} />
            <Meter label="Built-up" value={zone.built_up_percent} />
            <Meter label="Plantable potential" value={zone.potential_plantable_percent} />
          </div>
        </>
      )}
    </div>
  );
}
