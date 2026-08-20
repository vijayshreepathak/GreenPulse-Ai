import { Grid3X3, Map } from "lucide-react";
import Badge from "../common/Badge";
import SectionHeader from "../common/SectionHeader";
import CampusMap from "../CampusMap";
import PriorityTable from "../PriorityTable";
import ZoneDetails from "../ZoneDetails";
import LayerSwitcher from "./LayerSwitcher";

export default function SpatialIntelligence({
  priority,
  cellGeojson,
  activeLayer,
  onLayerChange,
  selectedZone,
  selectedCell,
  onSelectZone,
  onSelectCell,
  recentAqi,
}) {
  const cellsAvailable = Boolean(cellGeojson?.features?.length);
  const setLayer = (nextLayer) => {
    onLayerChange(nextLayer);
    if (nextLayer === "priority" && selectedCell) onSelectZone(String(selectedCell.zone_id));
  };

  const selectRankedZone = (zoneId) => {
    onLayerChange("priority");
    onSelectZone(zoneId);
  };

  return (
    <section id="spatial-intelligence" className="product-section section-anchor" aria-labelledby="spatial-title">
      <SectionHeader
        id="spatial-title"
        eyebrow="Spatial intelligence"
        title="Campus intervention landscape"
        description="Move between the five-zone priority model and the 50 m satellite analysis grid."
        action={<Badge tone="forest"><Grid3X3 size={14} />{cellGeojson?.features?.length || 0} cells</Badge>}
      />

      <LayerSwitcher activeLayer={activeLayer} onChange={setLayer} cellsAvailable={cellsAvailable} />

      <div className="spatial-workspace">
        <div className="map-surface">
          <CampusMap
            records={priority}
            cellGeojson={cellGeojson}
            activeLayer={activeLayer}
            selectedZoneId={selectedZone?.zone_id}
            selectedCellId={selectedCell?.cell_id}
            onSelectZone={onSelectZone}
            onSelectCell={onSelectCell}
          />
        </div>
        <aside className="details-surface" aria-label="Selected area details">
          <ZoneDetails zone={selectedZone} cell={selectedCell} recentAqi={recentAqi} />
        </aside>
      </div>

      <div className="ranking-surface">
        <div className="ranking-surface__header">
          <div>
            <p className="eyebrow">Explainable ranking</p>
            <h3><Map size={18} />Zone environmental priority</h3>
          </div>
          <span>Score combines green cover, NDVI decline, built-up pressure, tree gap, and modeled PM stress.</span>
        </div>
        <PriorityTable records={priority} selectedZoneId={selectedZone?.zone_id} onSelectZone={selectRankedZone} />
      </div>
    </section>
  );
}
