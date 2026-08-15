import { useEffect, useMemo, useState } from "react";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";

const FALLBACK_MESSAGE = "Zone map file not found. Priority table and charts are still available.";

const colors = {
  Low: "#2f9e44",
  Moderate: "#f2c94c",
  High: "#f08c00",
  Urgent: "#e03131",
};

export default function CampusMap({ records, selectedZoneId, onSelectZone }) {
  const [geojson, setGeojson] = useState(null);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    fetch("/thapar_zones.geojson")
      .then((response) => {
        if (!response.ok) throw new Error(FALLBACK_MESSAGE);
        return response.json();
      })
      .then(setGeojson)
      .catch(() => setMapError(FALLBACK_MESSAGE));
  }, []);

  const priorityByZone = useMemo(() => {
    const map = new Map();
    (records || []).forEach((record) => map.set(String(record.zone_id), record));
    return map;
  }, [records]);

  if (mapError || !geojson) {
    return <div className="map-fallback">{FALLBACK_MESSAGE}</div>;
  }

  return (
    <MapContainer className="campus-map" center={[30.356, 76.367]} zoom={16} scrollWheelZoom={false}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <GeoJSON
        key={`${selectedZoneId}-${records?.length || 0}`}
        data={geojson}
        style={(feature) => {
          const zoneId = feature?.properties?.zone_id;
          const record = priorityByZone.get(String(zoneId));
          const selected = String(zoneId) === String(selectedZoneId);
          return {
            color: selected ? "#0f172a" : "#ffffff",
            weight: selected ? 3 : 1.5,
            fillColor: colors[record?.priority_class] || "#94a3b8",
            fillOpacity: selected ? 0.78 : 0.58,
          };
        }}
        onEachFeature={(feature, layer) => {
          const zoneId = feature?.properties?.zone_id;
          const record = priorityByZone.get(String(zoneId));
          layer.bindTooltip(record?.zone_name || feature?.properties?.zone_name || `Zone ${zoneId || ""}`);
          layer.on("click", () => {
            if (zoneId !== undefined && zoneId !== null) onSelectZone(String(zoneId));
          });
        }}
      />
    </MapContainer>
  );
}
