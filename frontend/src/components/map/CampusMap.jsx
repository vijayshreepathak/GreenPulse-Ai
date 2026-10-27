import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css"; // loaded with the lazy map view, not at startup
import { MapContainer, TileLayer, ZoomControl, useMap } from "react-leaflet";
import { LocateFixed } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { usePreferences } from "../../context/PreferencesContext";
import { featureId, validFeatureCollection } from "../../lib/geo";
import { formatNumber } from "../../lib/numbers";
import { formatLayerValue, layerColor, LAYER_CONFIGS } from "./layerConfig";
import MapLegend from "./MapLegend";

const CAMPUS_CENTER = [30.356, 76.367];
const STROKES = {
  light: { zone: "#ffffff", cell: "rgba(255, 255, 255, 0.7)", selected: "#0b1a12", outline: "#1f3a2c" },
  dark: { zone: "#0d1512", cell: "rgba(10, 18, 14, 0.65)", selected: "#ffffff", outline: "#d7e6dc" },
};

function tooltipNode(title, lines) {
  const root = document.createElement("div");
  root.className = "map-tooltip__content";
  const heading = document.createElement("strong");
  heading.textContent = title;
  root.append(heading);
  for (const line of lines) {
    const row = document.createElement("span");
    row.textContent = line;
    root.append(row);
  }
  return root;
}

/** One Leaflet GeoJSON layer per data source; styles update in place. */
function FeatureLayer({ data, getStyle, getTooltip, onSelect, styleKey, selectedId }) {
  const map = useMap();
  const layerRef = useRef(null);
  const handlers = useRef({ getStyle, getTooltip, onSelect });
  // Leaflet callbacks read the latest render's handlers without recreating the layer.
  useLayoutEffect(() => {
    handlers.current = { getStyle, getTooltip, onSelect };
  });

  useEffect(() => {
    if (!data?.features?.length) return undefined;
    const layer = L.geoJSON(data, {
      style: (feature) => handlers.current.getStyle(feature),
      onEachFeature: (feature, path) => {
        path.bindTooltip(() => handlers.current.getTooltip(feature), { sticky: true, className: "map-tooltip", direction: "top", opacity: 1 });
        path.on({
          mouseover: () => {
            const base = handlers.current.getStyle(feature);
            path.setStyle({ weight: Math.max(base.weight, 2.4), fillOpacity: Math.min(1, base.fillOpacity + 0.12) });
          },
          mouseout: () => path.setStyle(handlers.current.getStyle(feature)),
          click: () => handlers.current.onSelect(feature),
        });
      },
    });
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      layer.eachLayer((path) => {
        path.off();
        path.unbindTooltip();
      });
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [data, map]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.setStyle((feature) => handlers.current.getStyle(feature));
    if (selectedId) {
      layer.eachLayer((path) => {
        if (featureId(path.feature) === String(selectedId)) path.bringToFront();
      });
    }
  }, [styleKey, selectedId]);

  return null;
}

function ZoneOutlines({ data, selectedZoneId, theme }) {
  const map = useMap();
  const layerRef = useRef(null);
  useEffect(() => {
    if (!data?.features?.length) return undefined;
    const layer = L.geoJSON(data, { interactive: false, style: { fill: false, weight: 1.4, dashArray: "4 4" } });
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [data, map]);
  useEffect(() => {
    layerRef.current?.setStyle((feature) => {
      const selected = String(feature?.properties?.zone_id) === String(selectedZoneId);
      return { color: STROKES[theme].outline, weight: selected ? 3 : 1.2, opacity: selected ? 1 : 0.75, dashArray: selected ? null : "4 4", fill: false };
    });
  }, [selectedZoneId, theme, data]);
  return null;
}

function ViewportController({ campusBounds, resetSignal, focusBounds, reducedMotion, scrollZoom }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || !campusBounds?.isValid()) return;
    map.fitBounds(campusBounds, { padding: [16, 16], animate: false });
    fitted.current = true;
  }, [campusBounds, map]);

  useEffect(() => {
    if (!resetSignal || !campusBounds?.isValid()) return;
    map.fitBounds(campusBounds, { padding: [16, 16], animate: !reducedMotion });
  }, [resetSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusBounds?.isValid() || map.getBounds().contains(focusBounds)) return;
    map.fitBounds(focusBounds, { padding: [48, 48], maxZoom: Math.max(map.getZoom(), 16), animate: !reducedMotion });
  }, [focusBounds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollZoom) map.scrollWheelZoom.enable();
    else map.scrollWheelZoom.disable();
  }, [map, scrollZoom]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

export default function CampusMap({
  zoneGeojson,
  zonesStatus,
  cellGeojson,
  cellsStatus,
  priorityByZone,
  activeLayer,
  selectedZoneId,
  selectedCellId,
  focusRequest,
  opacity = 0.75,
  onSelectZone,
  onSelectCell,
}) {
  const { resolvedTheme } = useTheme();
  const { reducedMotion, preferences } = usePreferences();
  const [resetSignal, setResetSignal] = useState(0);
  const config = LAYER_CONFIGS[activeLayer] || LAYER_CONFIGS.priority;
  const isZone = config.source === "zone";

  const zones = useMemo(() => (zoneGeojson ? validFeatureCollection(zoneGeojson) : null), [zoneGeojson]);
  const cells = useMemo(() => (cellGeojson ? validFeatureCollection(cellGeojson) : null), [cellGeojson]);
  const data = isZone ? zones : cells;
  const campusBounds = useMemo(() => {
    const source = zones?.features?.length ? zones : cells;
    return source?.features?.length ? L.geoJSON(source).getBounds() : null;
  }, [zones, cells]);

  const selectedId = isZone ? selectedZoneId : selectedCellId;
  const focusBounds = useMemo(() => {
    if (!focusRequest || focusRequest.origin === "map") return null;
    const collection = focusRequest.cellId ? cells : zones;
    const id = focusRequest.cellId || focusRequest.zoneId;
    const feature = collection?.features?.find((item) => featureId(item) === String(id));
    return feature ? L.geoJSON(feature).getBounds() : null;
  }, [focusRequest, cells, zones]);

  const strokes = STROKES[resolvedTheme] || STROKES.light;
  const getStyle = (feature) => {
    const properties = feature?.properties || {};
    const id = featureId(feature);
    const value = isZone ? priorityByZone.get(String(properties.zone_id))?.priority_class : properties[config.field];
    const selected = selectedId !== null && selectedId !== undefined && id === String(selectedId);
    return {
      color: selected ? strokes.selected : isZone ? strokes.zone : strokes.cell,
      weight: selected ? 3 : isZone ? 1.6 : 0.6,
      opacity: 1,
      fillColor: layerColor(config, value),
      fillOpacity: Math.min(1, selected ? opacity + 0.15 : opacity),
    };
  };

  const getTooltip = (feature) => {
    const properties = feature?.properties || {};
    if (isZone) {
      const zone = priorityByZone.get(String(properties.zone_id));
      const name = zone?.zone_name || properties.zone_name || `Zone ${properties.zone_id ?? ""}`;
      return tooltipNode(name, [
        `Priority: ${zone?.priority_class || "Unavailable"}`,
        `Score: ${formatNumber(zone?.priority_score, 2)} / 100`,
        "Click for the score breakdown",
      ]);
    }
    return tooltipNode(`${properties.cell_id ?? "Cell"} · ${properties.zone_name ?? ""}`, [
      `${config.label}: ${formatLayerValue(config, properties[config.field])}`,
      "50 m cell indicator (not a priority score)",
    ]);
  };

  const onSelect = (feature) => {
    const properties = feature?.properties || {};
    if (isZone) onSelectZone(String(properties.zone_id), "map");
    else onSelectCell(String(properties.cell_id), String(properties.zone_id), "map");
  };

  let fallback = null;
  if (isZone && zonesStatus === "error") fallback = "Zone map file not found. The priority table, cell layers and charts are still available.";
  else if (isZone && zonesStatus === "ready" && !zones?.features?.length) fallback = "The zone map file has no valid polygons. The priority table, cell layers and charts are still available.";
  else if (!isZone && cellsStatus === "error") fallback = "50 m cell polygons could not be loaded. The zone priority layer remains available.";
  else if (!isZone && cellsStatus === "ready" && !cells?.features?.length) fallback = "The optional 50 m cell dataset is not available.";
  const loading = !fallback && !data?.features?.length;

  return (
    <div className="map-frame" data-tour="map">
      <MapContainer className="campus-map" center={CAMPUS_CENTER} zoom={16} zoomSnap={0.25} zoomDelta={0.5} zoomControl={false} scrollWheelZoom={preferences.mapScrollZoom} attributionControl>
        <ZoomControl position="topright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {!fallback && data?.features?.length > 0 && (
          <FeatureLayer
            key={config.source}
            data={data}
            getStyle={getStyle}
            getTooltip={getTooltip}
            onSelect={onSelect}
            selectedId={selectedId}
            styleKey={`${config.id}|${selectedId}|${opacity}|${resolvedTheme}|${priorityByZone.size}|${[...priorityByZone.values()].map((zone) => zone.priority_class).join()}`}
          />
        )}
        {!isZone && zones?.features?.length > 0 && <ZoneOutlines data={zones} selectedZoneId={selectedZoneId} theme={resolvedTheme} />}
        <ViewportController
          campusBounds={campusBounds}
          resetSignal={resetSignal}
          focusBounds={focusBounds}
          reducedMotion={reducedMotion}
          scrollZoom={preferences.mapScrollZoom}
        />
      </MapContainer>

      <div className="map-chip" aria-live="polite">
        <strong>{config.label}</strong>
        <span>{isZone ? `${zones?.features?.length ?? 0} analysis zones` : `${cells?.features?.length ?? 0} cells · 50 m`}</span>
        <span>{config.sourceLabel}</span>
      </div>
      <button className="map-reset" type="button" onClick={() => setResetSignal((value) => value + 1)} aria-label="Reset map view to the full campus" title="Fit to campus">
        <LocateFixed size={17} aria-hidden="true" />
      </button>
      {(fallback || loading) && (
        <div className="map-message" role="status">
          {fallback || "Loading map layer…"}
        </div>
      )}
      <MapLegend config={config} />
    </div>
  );
}
