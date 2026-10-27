/** Human-readable freshness for the modelled air-quality payload. */
import { formatDateTime, formatRelative } from "./time";

const STATES = {
  live: { tone: "live", label: "Fresh fetch", summary: "Fetched from Open-Meteo for this update." },
  cached: { tone: "cached", label: "Cached", summary: "Served from the 10-minute local cache." },
  stale: { tone: "stale", label: "Stale (last good)", summary: "The provider is unavailable; showing the last good response." },
  unavailable: { tone: "unavailable", label: "Unavailable", summary: "No modelled PM data; ranking uses the documented fallback stress of 60." },
};

export function describeAirQuality(environment, { refreshError = null, now = Date.now() } = {}) {
  if (!environment || !environment.freshness) {
    return { ...STATES.unavailable, label: "Not loaded", fetched: null, modelTime: null, fallback: true, refreshError };
  }
  const state = STATES[environment.freshness] || STATES.unavailable;
  const fetchedRelative = formatRelative(environment.fetched_at, now);
  return {
    ...state,
    fetched: environment.fetched_at ? `${formatDateTime(environment.fetched_at)}${fetchedRelative ? ` (${fetchedRelative})` : ""}` : null,
    fetchedRelative,
    modelTime: environment.last_updated ? formatDateTime(environment.last_updated) : null,
    fallback: environment.pm_stress_source !== "modelled",
    providerError: environment.provider_status?.ok === false ? environment.provider_status.message : null,
    refreshError,
  };
}
