const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, { kind = "http", status = null, details = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    // Structured error info from the AI endpoints: { category, retryable, retry_after }.
    this.details = details;
  }
}

export function isAbortError(error) {
  return error?.kind === "aborted" || error?.name === "AbortError";
}

/**
 * Fetch JSON with a timeout (GET by default; POST sends `body` as JSON). An external AbortSignal
 * (e.g. component unmount) cancels the request and rejects with kind "aborted", which callers ignore.
 */
export async function request(path, { signal, timeoutMs = 20000, fetchImpl = globalThis.fetch, method = "GET", body } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    let response;
    try {
      const init = { method, signal: controller.signal, headers: { Accept: "application/json" } };
      if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      response = await fetchImpl(`${API_BASE_URL}${path}`, init);
    } catch {
      if (timedOut) throw new ApiError("The request timed out. The API may be slow or unavailable.", { kind: "timeout" });
      if (signal?.aborted) throw new ApiError("The request was cancelled.", { kind: "aborted" });
      throw new ApiError("Could not reach the GreenPulse API. Check that the backend is running.", { kind: "network" });
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // The timer or the caller can abort while the body is still streaming.
      if (timedOut) throw new ApiError("The request timed out. The API may be slow or unavailable.", { kind: "timeout" });
      if (signal?.aborted) throw new ApiError("The request was cancelled.", { kind: "aborted" });
      payload = null;
    }
    if (!response.ok) {
      const detail = typeof payload?.detail === "string" ? payload.detail : null;
      const details = payload?.error && typeof payload.error === "object" ? payload.error : null;
      throw new ApiError(detail || `The API returned HTTP ${response.status}.`, { kind: "http", status: response.status, details });
    }
    if (payload === null || typeof payload !== "object") {
      throw new ApiError("The API returned an unreadable response.", { kind: "parse" });
    }
    return payload;
  } catch (error) {
    if (signal?.aborted && !(error instanceof ApiError && error.kind === "aborted")) {
      throw new ApiError("The request was cancelled.", { kind: "aborted" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

export function getDashboard(options) {
  return request("/dashboard", { timeoutMs: 45000, ...options });
}

export function getAnalysisCurrent({ refresh = false, ...options } = {}) {
  return request(`/api/analysis/current${refresh ? "?refresh=true" : ""}`, { timeoutMs: 45000, ...options });
}

export function getSpatialCells(options) {
  return request("/api/spatial/cells", options);
}

export function getCellHistory(cellId, options) {
  const params = new URLSearchParams({ cell_id: cellId });
  return request(`/api/spatial/cells/history?${params.toString()}`, options);
}

export function getLandsatHistory(options) {
  return request("/zones/landsat-history", options);
}

// ---- AI Copilot (the Gemini key never reaches the browser; the backend calls Gemini) ----

export function getAiStatus({ verify = false, ...options } = {}) {
  return request(`/api/ai/status${verify ? "?verify=true" : ""}`, { timeoutMs: 20000, ...options });
}

export function postAiChat(body, options) {
  return request("/api/ai/chat", { method: "POST", body, timeoutMs: 60000, ...options });
}

export function getAiProgress(requestId, options) {
  return request(`/api/ai/chat/${encodeURIComponent(requestId)}/progress`, { timeoutMs: 5000, ...options });
}

export function cancelAiChat(requestId, options) {
  return request(`/api/ai/chat/${encodeURIComponent(requestId)}/cancel`, { method: "POST", body: {}, timeoutMs: 5000, ...options });
}

export async function getZoneGeojson({ signal, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(`${import.meta.env.BASE_URL || "/"}thapar_zones.geojson`, { signal });
  if (!response.ok) throw new ApiError("Zone map file not found.", { kind: "http", status: response.status });
  const payload = await response.json();
  if (payload?.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new ApiError("Zone map file is not a GeoJSON FeatureCollection.", { kind: "parse" });
  }
  return payload;
}
