const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function request(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || `Request failed: ${response.status}`);
  }
  return payload;
}

export function getDashboard() {
  return request("/dashboard");
}

export function getRecentAqi() {
  return request("/aqi/open-meteo/recent");
}

export function getEnvironmentCurrent(refresh = false) {
  return request(`/api/environment/current${refresh ? "?refresh=true" : ""}`);
}

export function getAirQualityHistory(hours = 168, refresh = false) {
  const params = new URLSearchParams({ hours: String(hours) });
  if (refresh) params.set("refresh", "true");
  return request(`/api/environment/air-quality/history?${params.toString()}`);
}

export function getSpatialCells() {
  return request("/api/spatial/cells");
}

export function getCellHistory(cellId) {
  const params = new URLSearchParams({ cell_id: cellId });
  return request(`/api/spatial/cells/history?${params.toString()}`);
}

export function getLandsatHistory() {
  return request("/zones/landsat-history");
}
