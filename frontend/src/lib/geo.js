/** Minimal GeoJSON validation so malformed geometry never reaches Leaflet (which throws on NaN). */
function validPosition(position) {
  if (!Array.isArray(position) || position.length < 2) return false;
  const [lng, lat] = position;
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
}

function validRing(ring) {
  return Array.isArray(ring) && ring.length >= 4 && ring.every(validPosition);
}

export function isValidPolygonGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return false;
  const { type, coordinates } = geometry;
  if (type === "Polygon") return Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(validRing);
  if (type === "MultiPolygon") {
    return Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every((polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every(validRing));
  }
  return false;
}

export function validFeatureCollection(collection) {
  const features = Array.isArray(collection?.features) ? collection.features.filter((feature) => isValidPolygonGeometry(feature?.geometry)) : [];
  return { type: "FeatureCollection", features };
}

export function featureId(feature) {
  const properties = feature?.properties || {};
  return String(properties.cell_id ?? properties.zone_id ?? feature?.id ?? "");
}
