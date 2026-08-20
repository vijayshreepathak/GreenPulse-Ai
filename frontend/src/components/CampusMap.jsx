import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import MapLegend from "./map/MapLegend";
import { formatLayerValue, layerColor, LAYER_CONFIGS } from "./map/layerConfig";

const FALLBACK_MESSAGE = "Zone map file not found. Priority table and charts are still available.";

function MapViewport({ data, selectionKey, activeLayer }) {
  const map = useMap();

  useEffect(() => {
    if (!data?.features?.length) return;
    const bounds = L.geoJSON(data).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [18, 18], animate: false });
  }, [activeLayer, data, map]);

  useEffect(() => {
    if (activeLayer === "priority" || !selectionKey || !data?.features?.length) return;
    const matching = data.features.find((feature) => {
      const properties = feature?.properties || {};
      return String(properties.cell_id || properties.zone_id) === String(selectionKey);
    });
    if (!matching) return;
    const bounds = L.geoJSON(matching).getBounds();
    if (!bounds.isValid()) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 18 });
    else map.flyToBounds(bounds, { padding: [36, 36], maxZoom: 18, duration: 0.45 });
  }, [activeLayer, data, map, selectionKey]);

  return null;
}

export default function CampusMap({
  records,
  cellGeojson,
  activeLayer,
  selectedZoneId,
  selectedCellId,
  onSelectZone,
  onSelectCell,
}) {
  const [zoneGeojson, setZoneGeojson] = useState(null);
  const [mapError, setMapError] = useState("");
  const config = LAYER_CONFIGS[activeLayer] || LAYER_CONFIGS.priority;

  useEffect(() => {
    fetch("/thapar_zones.geojson")
      .then((response) => {
        if (!response.ok) throw new Error(FALLBACK_MESSAGE);
        return response.json();
      })
      .then(setZoneGeojson)
      .catch(() => setMapError(FALLBACK_MESSAGE));
  }, []);

  const priorityByZone = useMemo(() => {
    const map = new Map();
    (records || []).forEach((record) => map.set(String(record.zone_id), record));
    return map;
  }, [records]);

  const data = config.source === "zone" ? zoneGeojson : cellGeojson;
  const selectionKey = config.source === "zone" ? selectedZoneId : selectedCellId;

  if ((config.source === "zone" && mapError) || (config.source === "zone" && !zoneGeojson)) {
    return <div className="map-fallback">{FALLBACK_MESSAGE}</div>;
  }
  if (config.source === "cell" && !cellGeojson?.features?.length) {
    return <div className="map-fallback">50 m cell polygons are not available. The priority zone layer remains available.</div>;
  }

  const getFeatureData = (feature) => {
    const properties = feature?.properties || {};
    if (config.source === "zone") return priorityByZone.get(String(properties.zone_id)) || properties;
    return properties;
  };

  const styleFeature = (feature) => {
    const properties = feature?.properties || {};
    const featureData = getFeatureData(feature);
    const featureId = properties.cell_id || properties.zone_id;
    const selected = String(featureId) === String(selectionKey);
    return {
      color: selected ? "#14251b" : config.source === "zone" ? "#fffefa" : "rgba(255, 254, 250, 0.58)",
      weight: selected ? 3 : config.source === "zone" ? 1.4 : 0.55,
      fillColor: layerColor(config, featureData?.[config.field]),
      fillOpacity: selected ? 0.9 : config.source === "zone" ? 0.7 : 0.76,
    };
  };

  return (
    <div className="map-frame">
      <MapContainer
        className="campus-map"
        center={[30.356, 76.367]}
        zoom={16}
        scrollWheelZoom
        aria-label={`Thapar campus ${config.label} map`}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <GeoJSON
          key={`${activeLayer}-${selectionKey || "none"}-${data?.features?.length || 0}`}
          data={data}
          style={styleFeature}
          onEachFeature={(feature, layer) => {
            const properties = feature?.properties || {};
            const featureData = getFeatureData(feature);
            const featureId = properties.cell_id || properties.zone_id;
            const areaName = properties.cell_id
              ? `${properties.cell_id} · ${properties.zone_name}`
              : featureData?.zone_name || properties.zone_name || `Zone ${properties.zone_id || ""}`;
            const value = formatLayerValue(config, featureData?.[config.field]);
            layer.bindTooltip(
              `<div class="map-tooltip__content"><strong>${areaName}</strong><span>${config.label}: ${value}</span></div>`,
              { sticky: true, className: "map-tooltip" }
            );
            layer.on("mouseover", () => layer.setStyle({ weight: 2.2, fillOpacity: 0.9 }));
            layer.on("mouseout", () => layer.setStyle(styleFeature(feature)));
            layer.on("click", () => {
              if (config.source === "zone") onSelectZone(String(featureId));
              else onSelectCell(String(featureId), String(properties.zone_id));
            });
          }}
        />
        <MapViewport data={data} selectionKey={selectionKey} activeLayer={activeLayer} />
      </MapContainer>
      <MapLegend config={config} />
      <div className="map-source-chip">{config.source === "zone" ? "5 zone polygons" : `${data.features.length} spatial cells`}</div>
    </div>
  );
}
