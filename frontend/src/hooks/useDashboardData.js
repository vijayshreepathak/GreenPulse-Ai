import { useCallback, useEffect, useReducer, useRef } from "react";
import { getAnalysisCurrent, getDashboard, getLandsatHistory, getSpatialCells, getZoneGeojson, isAbortError } from "../api";

export const REFRESH_INTERVAL_MS = 12 * 60 * 1000;
const SCHEDULER_TICK_MS = 60 * 1000;

const source = (extra = {}) => ({ status: "loading", error: null, ...extra });

export const INITIAL_STATE = {
  dashboard: source({ summary: {}, historical: [], spatial: {}, scoring: null, datasets: {}, notes: [], dataIssues: [], generatedAt: null }),
  // Environment and priority always change together (same PM stress input).
  live: { environment: null, priority: [], token: 0, refreshing: false, error: null, lastSuccessAt: null, lastAttemptAt: null },
  cells: source({ data: null }),
  landsat: source({ records: [], metadata: null }),
  zones: source({ geojson: null }),
};

export function dashboardReducer(state, action) {
  switch (action.type) {
    case "LOAD_START":
      return { ...INITIAL_STATE, live: { ...INITIAL_STATE.live, token: state.live.token } };
    case "DASHBOARD_LOADED": {
      const payload = action.payload || {};
      const dashboard = {
        status: "ready",
        error: null,
        summary: payload.summary || {},
        historical: payload.historical_ndvi || [],
        spatial: payload.spatial_analysis || {},
        scoring: payload.scoring || null,
        datasets: payload.datasets || {},
        notes: payload.notes || [],
        dataIssues: payload.data_issues || [],
        generatedAt: payload.generated_at || null,
      };
      if (action.token < state.live.token) return { ...state, dashboard };
      return {
        ...state,
        dashboard,
        live: { ...state.live, environment: payload.recent_aqi || null, priority: payload.priority || [], token: action.token, lastSuccessAt: action.at },
      };
    }
    case "DASHBOARD_FAILED":
      return { ...state, dashboard: { ...state.dashboard, status: "error", error: action.error } };
    case "REFRESH_START":
      return { ...state, live: { ...state.live, refreshing: true, lastAttemptAt: action.at } };
    case "REFRESH_SUCCESS": {
      if (action.token < state.live.token) return { ...state, live: { ...state.live, refreshing: false } };
      const payload = action.payload || {};
      return {
        ...state,
        dashboard: payload.scoring ? { ...state.dashboard, scoring: payload.scoring, dataIssues: payload.data_issues || state.dashboard.dataIssues } : state.dashboard,
        live: {
          ...state.live,
          environment: payload.environment || state.live.environment,
          priority: Array.isArray(payload.priority) ? payload.priority : state.live.priority,
          token: action.token,
          refreshing: false,
          error: null,
          lastSuccessAt: action.at,
        },
      };
    }
    case "REFRESH_FAILURE":
      // A failure that arrives after newer data was applied must not label that data as failed.
      if (action.token < state.live.token) return { ...state, live: { ...state.live, refreshing: false } };
      return { ...state, live: { ...state.live, refreshing: false, error: action.error } };
    case "SOURCE_LOADED":
      return { ...state, [action.key]: { ...state[action.key], ...action.value, status: "ready", error: null } };
    case "SOURCE_FAILED":
      return { ...state, [action.key]: { ...state[action.key], status: "error", error: action.error } };
    default:
      return state;
  }
}

function canRunInBackground() {
  const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  return visible && online;
}

export function useDashboardData({ backgroundRefresh = true } = {}) {
  const [state, dispatch] = useReducer(dashboardReducer, INITIAL_STATE);
  const tokenRef = useRef(0);
  const inFlightRef = useRef(null);
  const liveControllerRef = useRef(null);
  const loadControllerRef = useRef(null);
  const lastAttemptRef = useRef(0); // set by load()/refresh() before the scheduler can run

  const load = useCallback(() => {
    loadControllerRef.current?.abort();
    // A full reload supersedes any pending refresh (its result would be older than the reload).
    liveControllerRef.current?.abort();
    inFlightRef.current = null;
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const { signal } = controller;
    const token = ++tokenRef.current;
    lastAttemptRef.current = Date.now();
    dispatch({ type: "LOAD_START" });

    getDashboard({ signal })
      .then((payload) => dispatch({ type: "DASHBOARD_LOADED", payload, token, at: Date.now() }))
      .catch((error) => !isAbortError(error) && dispatch({ type: "DASHBOARD_FAILED", error: error.message }));
    getSpatialCells({ signal })
      .then((payload) => dispatch({ type: "SOURCE_LOADED", key: "cells", value: { data: payload } }))
      .catch((error) => !isAbortError(error) && dispatch({ type: "SOURCE_FAILED", key: "cells", error: error.message }));
    getLandsatHistory({ signal })
      .then((payload) => dispatch({ type: "SOURCE_LOADED", key: "landsat", value: { records: payload.records || [], metadata: payload.metadata || null } }))
      .catch((error) => !isAbortError(error) && dispatch({ type: "SOURCE_FAILED", key: "landsat", error: error.message }));
    getZoneGeojson({ signal })
      .then((geojson) => dispatch({ type: "SOURCE_LOADED", key: "zones", value: { geojson } }))
      .catch((error) => !isAbortError(error) && dispatch({ type: "SOURCE_FAILED", key: "zones", error: error.message }));
  }, []);

  /** Refresh modelled PM and the official ranking together. Concurrent calls share one request. */
  const refresh = useCallback((force = false) => {
    if (inFlightRef.current) return inFlightRef.current;
    const controller = new AbortController();
    liveControllerRef.current = controller;
    const token = ++tokenRef.current;
    lastAttemptRef.current = Date.now();
    dispatch({ type: "REFRESH_START", at: Date.now() });

    const promise = getAnalysisCurrent({ refresh: force, signal: controller.signal })
      .then((payload) => dispatch({ type: "REFRESH_SUCCESS", payload, token, at: Date.now() }))
      .catch((error) => {
        if (!isAbortError(error)) dispatch({ type: "REFRESH_FAILURE", error: error.message, token });
      })
      .finally(() => {
        if (inFlightRef.current === promise) inFlightRef.current = null;
      });
    inFlightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    load();
    return () => {
      loadControllerRef.current?.abort();
      liveControllerRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!backgroundRefresh) return undefined;
    const runIfDue = () => {
      if (!canRunInBackground() || inFlightRef.current) return;
      if (Date.now() - lastAttemptRef.current >= REFRESH_INTERVAL_MS) refresh(false);
    };
    const interval = window.setInterval(runIfDue, SCHEDULER_TICK_MS);
    document.addEventListener("visibilitychange", runIfDue);
    window.addEventListener("online", runIfDue);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", runIfDue);
      window.removeEventListener("online", runIfDue);
    };
  }, [backgroundRefresh, refresh]);

  return { state, refresh, reload: load };
}
