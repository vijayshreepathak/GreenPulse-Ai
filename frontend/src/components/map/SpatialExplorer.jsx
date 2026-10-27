import { useId, useRef } from "react";
import { Download } from "lucide-react";
import { usePreferences } from "../../context/PreferencesContext";
import { formatNumber } from "../../lib/numbers";
import { ErrorBoundary, PageHeader, Panel, SectionTitle } from "../common/Primitives";
import { FactorLegend } from "../charts/ContributionBar";
import CampusMap from "./CampusMap";
import LayerSwitcher from "./LayerSwitcher";
import { LAYER_CONFIGS } from "./layerConfig";
import PriorityTable from "./PriorityTable";
import SelectionPanel from "./SelectionPanel";

export default function SpatialExplorer({
  priority,
  priorityByZone,
  zones,
  cells,
  activeLayer,
  onLayerChange,
  opacity,
  onOpacityChange,
  selectedZone,
  selectedCell,
  focusRequest,
  onSelectZone,
  onSelectCell,
  onViewCellHistory,
  scoring,
  freshnessLabel,
  onExportRanking,
}) {
  const opacityId = useId();
  const workspaceRef = useRef(null);
  const { reducedMotion } = usePreferences();
  const config = LAYER_CONFIGS[activeLayer] || LAYER_CONFIGS.priority;
  const cellsAvailable = Boolean(cells.data?.geojson?.features?.length);

  // The ranking sits below the map; bring the updated map and details back into view.
  const selectFromTable = (zoneId) => {
    onSelectZone(zoneId, "table");
    const workspace = workspaceRef.current;
    if (workspace && workspace.getBoundingClientRect().top < 0) {
      workspace.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
    }
  };

  return (
    <div className="view view--map">
      <PageHeader
        id="view-title"
        eyebrow="Spatial explorer"
        title="Campus environmental map"
        description="Switch between the official zone priority layer and 50 m Sentinel-2 / Dynamic World indicator layers. Select any zone or cell to inspect it."
      />

      <Panel className="map-toolbar" aria-label="Map controls">
        <LayerSwitcher activeLayer={activeLayer} onChange={onLayerChange} cellsAvailable={cellsAvailable} />
        <div className="map-toolbar__aside">
          <p className="map-toolbar__description">
            <strong>{config.label}.</strong> {config.description}
          </p>
          <label className="range-field" htmlFor={opacityId}>
            <span>Fill opacity <output>{formatNumber(opacity * 100, 0)}%</output></span>
            <input id={opacityId} type="range" min="0.3" max="1" step="0.05" value={opacity} onChange={(event) => onOpacityChange(Number(event.target.value))} />
          </label>
        </div>
      </Panel>

      <div className="map-workspace" ref={workspaceRef}>
        <ErrorBoundary label="The map" resetKey={activeLayer}>
          <CampusMap
            zoneGeojson={zones.geojson}
            zonesStatus={zones.status}
            cellGeojson={cells.data?.geojson}
            cellsStatus={cells.status}
            priorityByZone={priorityByZone}
            activeLayer={activeLayer}
            selectedZoneId={selectedZone?.zone_id}
            selectedCellId={selectedCell?.cell_id}
            focusRequest={focusRequest}
            opacity={opacity}
            onSelectZone={onSelectZone}
            onSelectCell={onSelectCell}
          />
        </ErrorBoundary>
        <Panel as="aside" className="selection-panel" aria-label="Selected area details" tabIndex={0}>
          <SelectionPanel
            zone={selectedZone}
            cell={selectedCell}
            scoring={scoring}
            freshnessLabel={freshnessLabel}
            rankedCount={priority.filter((zone) => zone.rank !== null && zone.rank !== undefined).length}
            onViewHistory={onViewCellHistory}
            onSelectZone={(zoneId) => onSelectZone(zoneId, "panel")}
          />
        </Panel>
      </div>

      <Panel aria-labelledby="ranking-title">
        <SectionTitle
          id="ranking-title"
          title="Official zone ranking"
          description="Zone-level rule-based score. Selecting a row updates the map, details and charts."
          actions={
            <button type="button" className="button button--secondary button--sm" onClick={onExportRanking} disabled={!priority.length}>
              <Download size={15} aria-hidden="true" /> Ranking CSV
            </button>
          }
        />
        <FactorLegend compact />
        <PriorityTable records={priority} selectedZoneId={selectedZone?.zone_id} onSelectZone={selectFromTable} />
      </Panel>
    </div>
  );
}
