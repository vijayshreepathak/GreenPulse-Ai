import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../test/fixtures/analysis.json";

vi.mock("../api", async () => {
  const actual = await vi.importActual("../api");
  return {
    ...actual,
    getDashboard: vi.fn(),
    getAnalysisCurrent: vi.fn(),
    getSpatialCells: vi.fn(),
    getLandsatHistory: vi.fn(),
    getZoneGeojson: vi.fn(),
  };
});

const api = await import("../api");
const { dashboardReducer, INITIAL_STATE, useDashboardData } = await import("./useDashboardData");

const environment = (stress, freshness = "live") => ({ freshness, stress_score: stress, pm_stress_source: "modelled", records: [] });
const withStress = (stress) => fixture.priority.map((zone) => ({ ...zone, pm_stress_score: stress }));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("dashboardReducer", () => {
  const loaded = dashboardReducer(INITIAL_STATE, { type: "DASHBOARD_LOADED", token: 1, at: 1, payload: { priority: withStress(60), recent_aqi: environment(60) } });

  it("updates environment and ranking together", () => {
    const next = dashboardReducer(loaded, { type: "REFRESH_SUCCESS", token: 2, at: 2, payload: { environment: environment(100), priority: withStress(100) } });
    expect(next.live.environment.stress_score).toBe(100);
    expect(new Set(next.live.priority.map((zone) => zone.pm_stress_score))).toEqual(new Set([100]));
  });

  it("ignores responses older than the data already shown", () => {
    const newer = dashboardReducer(loaded, { type: "REFRESH_SUCCESS", token: 3, at: 3, payload: { environment: environment(100), priority: withStress(100) } });
    const stale = dashboardReducer(newer, { type: "REFRESH_SUCCESS", token: 2, at: 4, payload: { environment: environment(10), priority: withStress(10) } });
    expect(stale.live.environment.stress_score).toBe(100);
    const lateDashboard = dashboardReducer(newer, { type: "DASHBOARD_LOADED", token: 1, at: 5, payload: { priority: withStress(60), recent_aqi: environment(60), summary: { a: 1 } } });
    expect(lateDashboard.live.environment.stress_score).toBe(100);
    expect(lateDashboard.dashboard.summary).toEqual({ a: 1 });
  });

  it("keeps the last good data when a refresh fails and clears the error on recovery", () => {
    const failed = dashboardReducer(loaded, { type: "REFRESH_FAILURE", error: "down" });
    expect(failed.live.error).toBe("down");
    expect(failed.live.priority).toHaveLength(5);
    expect(failed.live.environment.stress_score).toBe(60);
    const recovered = dashboardReducer(failed, { type: "REFRESH_SUCCESS", token: 2, at: 2, payload: { environment: environment(70), priority: withStress(70) } });
    expect(recovered.live.error).toBeNull();
  });

  it("ignores a refresh failure that arrives after newer data was applied", () => {
    const newer = dashboardReducer(loaded, { type: "DASHBOARD_LOADED", token: 5, at: 5, payload: { priority: withStress(70), recent_aqi: environment(70) } });
    const late = dashboardReducer({ ...newer, live: { ...newer.live, refreshing: true } }, { type: "REFRESH_FAILURE", error: "timeout", token: 4 });
    expect(late.live.error).toBeNull();
    expect(late.live.refreshing).toBe(false);
    expect(late.live.environment.stress_score).toBe(70);
  });

  it("tracks optional sources independently", () => {
    const failedLandsat = dashboardReducer(loaded, { type: "SOURCE_FAILED", key: "landsat", error: "missing" });
    expect(failedLandsat.landsat.status).toBe("error");
    expect(failedLandsat.dashboard.status).toBe("ready");
  });
});

describe("useDashboardData", () => {
  beforeEach(() => {
    vi.mocked(api.getDashboard).mockResolvedValue({ priority: withStress(60), recent_aqi: environment(60), summary: {} });
    vi.mocked(api.getSpatialCells).mockResolvedValue({ available: false, geojson: { features: [] } });
    vi.mocked(api.getLandsatHistory).mockRejectedValue(new api.ApiError("Landsat missing"));
    vi.mocked(api.getZoneGeojson).mockResolvedValue({ type: "FeatureCollection", features: [] });
  });

  it("loads sources independently so an optional failure does not block the dashboard", async () => {
    const { result } = renderHook(() => useDashboardData({ backgroundRefresh: false }));
    await waitFor(() => expect(result.current.state.dashboard.status).toBe("ready"));
    await waitFor(() => expect(result.current.state.landsat.status).toBe("error"));
    expect(result.current.state.live.priority).toHaveLength(5);
  });

  it("shares one request between overlapping refreshes", async () => {
    const pending = deferred();
    vi.mocked(api.getAnalysisCurrent).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useDashboardData({ backgroundRefresh: false }));
    await waitFor(() => expect(result.current.state.dashboard.status).toBe("ready"));
    let first;
    let second;
    act(() => {
      first = result.current.refresh(true);
      second = result.current.refresh(true);
    });
    expect(first).toBe(second);
    expect(api.getAnalysisCurrent).toHaveBeenCalledTimes(1);
    expect(result.current.state.live.refreshing).toBe(true);
    await act(async () => {
      pending.resolve({ environment: environment(100), priority: withStress(100) });
      await first;
    });
    expect(result.current.state.live.environment.stress_score).toBe(100);
    expect(result.current.state.live.refreshing).toBe(false);
  });

  it("preserves data and reports the error when refresh fails", async () => {
    vi.mocked(api.getAnalysisCurrent).mockRejectedValue(new api.ApiError("Could not reach the GreenPulse API."));
    const { result } = renderHook(() => useDashboardData({ backgroundRefresh: false }));
    await waitFor(() => expect(result.current.state.dashboard.status).toBe("ready"));
    await act(() => result.current.refresh(true));
    expect(result.current.state.live.error).toMatch(/Could not reach/);
    expect(result.current.state.live.priority).toHaveLength(5);
  });

  it("lets a reload supersede a pending refresh and start a fresh one afterwards", async () => {
    const signals = [];
    vi.mocked(api.getAnalysisCurrent).mockImplementation((options) => {
      signals.push(options.signal);
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new api.ApiError("cancelled", { kind: "aborted" }))));
    });
    const { result } = renderHook(() => useDashboardData({ backgroundRefresh: false }));
    await waitFor(() => expect(result.current.state.dashboard.status).toBe("ready"));
    let first;
    act(() => {
      first = result.current.refresh(false);
    });
    act(() => result.current.reload());
    await act(async () => {
      await first;
    });
    expect(signals[0].aborted).toBe(true);
    await waitFor(() => expect(result.current.state.dashboard.status).toBe("ready"));
    expect(result.current.state.live.error).toBeNull();
    let second;
    act(() => {
      second = result.current.refresh(true);
    });
    expect(second).not.toBe(first);
    expect(api.getAnalysisCurrent).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
  });

  it("aborts in-flight requests on unmount", async () => {
    let signal;
    vi.mocked(api.getDashboard).mockImplementation((options) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const { unmount } = renderHook(() => useDashboardData({ backgroundRefresh: false }));
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});

describe("api.request", () => {
  it("maps network failures, HTTP errors and timeouts to readable errors", async () => {
    await expect(api.request("/x", { fetchImpl: () => Promise.reject(new TypeError("fail")) })).rejects.toMatchObject({ kind: "network" });
    await expect(
      api.request("/x", { fetchImpl: () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ detail: "Dataset validation failed" }) }) })
    ).rejects.toMatchObject({ kind: "http", status: 503, message: "Dataset validation failed" });
    const hanging = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    await expect(api.request("/x", { fetchImpl: hanging, timeoutMs: 10 })).rejects.toMatchObject({ kind: "timeout" });
    const controller = new AbortController();
    const cancelled = api.request("/x", { fetchImpl: hanging, signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ kind: "aborted" });
  });

  it("reports a timeout while the body is streaming as a timeout, not a bad response", async () => {
    const slowBody = (_url, { signal }) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      });
    await expect(api.request("/x", { fetchImpl: slowBody, timeoutMs: 10 })).rejects.toMatchObject({ kind: "timeout" });
  });
});
