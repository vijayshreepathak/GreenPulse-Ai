import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./test/fixtures/analysis.json";
import { installMatchMedia, renderWithProviders } from "./test/utils";

vi.mock("./api", async () => {
  const actual = await vi.importActual("./api");
  return {
    ...actual,
    getDashboard: vi.fn(),
    getAnalysisCurrent: vi.fn(),
    getSpatialCells: vi.fn(),
    getLandsatHistory: vi.fn(),
    getZoneGeojson: vi.fn(),
    getAiStatus: vi.fn(),
    postAiChat: vi.fn(),
    getAiProgress: vi.fn(),
    cancelAiChat: vi.fn(),
  };
});

const api = await import("./api");
const { default: App } = await import("./App");

const environment = {
  freshness: "cached",
  fetched_at: "2026-10-27T12:00:00Z",
  last_updated: "2026-10-27T17:30",
  stress_score: 60,
  pm_stress_source: "modelled",
  averages_24h: { pm2_5: 30, pm10: 50, record_count: 24, complete: true },
  stress_components: { pm25_score: 50, pm10_score: 50 },
  current: { pm2_5: 31, pm10: 52, time: "2026-10-27T17:30", source: "provider_current" },
  records: [],
  provider_status: { ok: true },
};

const dashboardPayload = {
  summary: { total_area_hectares: 99.3075, green_cover_percent: 67.43, average_ndvi: 0.3709 },
  priority: fixture.priority,
  historical_ndvi: fixture.historical,
  recent_aqi: environment,
  spatial_analysis: { cell_count: 447, latest_satellite_year: 2025, season: "Oct-Dec" },
  scoring: fixture.scoring,
  datasets: { sentinel2_zone_history: { baseline_year: 2018, latest_year: 2025, season: "Oct-Dec" } },
  notes: [],
  data_issues: [],
};

describe("App", () => {
  beforeEach(() => {
    installMatchMedia();
    window.location.hash = "#/overview";
    vi.mocked(api.getDashboard).mockResolvedValue(dashboardPayload);
    vi.mocked(api.getSpatialCells).mockResolvedValue({ available: false, geojson: { type: "FeatureCollection", features: [] } });
    vi.mocked(api.getLandsatHistory).mockRejectedValue(new api.ApiError("Landsat history unavailable"));
    vi.mocked(api.getZoneGeojson).mockRejectedValue(new api.ApiError("Zone map file not found."));
    vi.mocked(api.getAnalysisCurrent).mockResolvedValue({ environment: { ...environment, freshness: "live", stress_score: 100 }, priority: fixture.priority.map((zone) => ({ ...zone, pm_stress_score: 100 })) });
    vi.mocked(api.getAiStatus).mockResolvedValue({ enabled: true, key_configured: true, available: true, model: "gemini-3.5-flash-lite", provider_status: { state: "not_checked" }, limits: { max_history_messages: 12, timeout_seconds: 30 } });
    vi.mocked(api.getAiProgress).mockRejectedValue(new api.ApiError("not found", { status: 404 }));
    vi.mocked(api.cancelAiChat).mockResolvedValue({ cancelled: true });
  });

  it("renders the overview even when optional sources fail", async () => {
    renderWithProviders(<App />);
    expect(await screen.findByText("99.3")).toBeInTheDocument();
    const kpis = screen.getByRole("region", { name: "Key indicators" });
    expect(within(kpis).getByText("67.4%")).toBeInTheDocument();
    expect(within(kpis).getByText("447")).toBeInTheDocument();
    expect(screen.getAllByText("North-West Zone").length).toBeGreaterThan(0);
    expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument();
  });

  it("shows a recoverable error when the dashboard API is unreachable", async () => {
    vi.mocked(api.getDashboard).mockRejectedValueOnce(new api.ApiError("Could not reach the GreenPulse API. Check that the backend is running.", { kind: "network" }));
    renderWithProviders(<App />);
    expect(await screen.findByText("The dashboard could not load")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("99.3")).toBeInTheDocument();
  });

  it("toggles dark mode with one click from the header", async () => {
    renderWithProviders(<App />);
    await screen.findByText("99.3");
    fireEvent.click(screen.getByRole("button", { name: "Dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("refresh updates the PM stress and the ranking together", async () => {
    renderWithProviders(<App />);
    await screen.findByText("99.3");
    fireEvent.click(screen.getByRole("button", { name: "Refresh modelled air quality and ranking" }));
    await waitFor(() => expect(api.getAnalysisCurrent).toHaveBeenCalledWith(expect.objectContaining({ refresh: true })));
    const kpis = screen.getByRole("region", { name: "Key indicators" });
    await waitFor(() => expect(within(kpis).getByText("100.0")).toBeInTheDocument());
  });

  it("navigates with hash routes and supports the comparison workspace", async () => {
    renderWithProviders(<App />);
    await screen.findByText("99.3");
    window.location.hash = "#/compare";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByRole("heading", { name: "Compare campus zones" })).toBeInTheDocument();
    expect(screen.getByText(/North-West Zone scores 2\.32 points above South-West Zone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Central Zone" }));
    expect(screen.getByText("Zones to compare")).toHaveTextContent("3/3");
    expect(screen.getByRole("checkbox", { name: "North-East Zone" })).toBeDisabled();
  });

  it("keeps Scenario Lab results separate from the official ranking", async () => {
    window.location.hash = "#/scenario";
    renderWithProviders(<App />);
    expect(await screen.findByRole("heading", { name: "What-if priority analysis" })).toBeInTheDocument();
    expect(screen.getByText("Experimental scenario — not the official priority ranking")).toBeInTheDocument();
    const treeInput = screen.getByRole("spinbutton", { name: "Tree gap raw weight" });
    fireEvent.change(treeInput, { target: { value: "100" } });
    fireEvent.blur(treeInput);
    expect(await screen.findByText(/change rank under this scenario/)).toBeInTheDocument();
    // Leave the scenario changed and check the official ranking shown elsewhere is untouched.
    window.location.hash = "#/overview";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const focus = await screen.findByRole("complementary", { name: "Highest official priority" });
    expect(within(focus).getByText("63.43")).toBeInTheDocument();
    expect(within(focus).getByText("North-West Zone")).toBeInTheDocument();
    window.location.hash = "#/scenario";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByText(/change rank under this scenario/)).toBeInTheDocument(); // kept for the session
    fireEvent.click(screen.getByRole("button", { name: "Reset to official weights" }));
    expect(await screen.findByText("Zone order is unchanged under this scenario.")).toBeInTheDocument();
  });

  it("shows an unscorable zone as Unavailable without breaking other views", async () => {
    const unavailable = {
      zone_id: "Z06",
      zone_name: "Annex Zone",
      rank: null,
      priority_score: null,
      priority_class: "Unavailable",
      score_status: "insufficient_data",
      missing_inputs: ["built_up_percent", "tree_percent"],
      green_cover_percent: 40,
      ndvi_change: null,
    };
    vi.mocked(api.getDashboard).mockResolvedValue({ ...dashboardPayload, priority: [...fixture.priority, unavailable] });
    renderWithProviders(<App />);
    await screen.findByText("99.3");
    const annexRow = screen.getByText("Annex Zone").closest("button");
    expect(within(annexRow).getByText("—")).toBeInTheDocument(); // no invented rank
    expect(within(annexRow).getByText("Unavailable")).toBeInTheDocument();
    expect(annexRow.querySelector(".contribution-bar__segment")).toBeNull(); // partial inputs are not drawn as a score
    expect(annexRow.querySelector(".contribution-bar__track--unavailable")).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "Key indicators" })).getByText("5 with an official score")).toBeInTheDocument();
    window.location.hash = "#/scenario";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByText(/Excluded \(no official score\): Annex Zone/)).toBeInTheDocument();
  });

  it("stays usable when no zone can be ranked", async () => {
    vi.mocked(api.getDashboard).mockResolvedValue({ ...dashboardPayload, priority: [] });
    renderWithProviders(<App />);
    expect(await screen.findByText("No zone could be scored with the loaded data.")).toBeInTheDocument();
    for (const [hash, text] of [["#/scenario", "No scored zones"], ["#/compare", "Select at least two zones"], ["#/insights", "Insights appear when the zone ranking loads."]]) {
      window.location.hash = hash;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
  });

  it("shows a failed refresh on the overview and in the header while keeping the last good values", async () => {
    vi.mocked(api.getAnalysisCurrent).mockRejectedValueOnce(new api.ApiError("Could not reach the GreenPulse API.", { kind: "network" }));
    renderWithProviders(<App />);
    await screen.findByText("99.3");
    fireEvent.click(screen.getByRole("button", { name: "Refresh modelled air quality and ranking" }));
    expect(await screen.findByText(/Refresh failed: Could not reach the GreenPulse API\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PM refresh failed/ })).toBeInTheDocument();
    expect(screen.getByText(/Refresh failed\. Could not reach the GreenPulse API\. Previously loaded values remain visible\./)).toBeInTheDocument();
    const kpis = screen.getByRole("region", { name: "Key indicators" });
    expect(within(kpis).getByText("60.0")).toBeInTheDocument(); // last good PM stress, not a blank or a fake value
  });

  it("adopts a deep link pasted into an already open tab", async () => {
    renderWithProviders(<App />);
    await screen.findByText("99.3");
    window.location.hash = "#/trends?zone=Z03";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const select = await screen.findByRole("combobox", { name: /zone/i });
    expect(select).toHaveValue("Z03");
    window.location.hash = "#/trends?zone=Z05";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect(screen.getByRole("combobox", { name: /zone/i })).toHaveValue("Z05"));
  });

  it("returns focus after the tour and lets Escape close only the export menu", async () => {
    renderWithProviders(<App />);
    await screen.findByText("99.3");
    const tourButton = screen.getByRole("button", { name: "Start guided tour" });
    tourButton.focus();
    fireEvent.click(tourButton);
    expect(await screen.findByRole("dialog", { name: "Campus overview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export analysis" }));
    const menuItem = await screen.findByRole("menuitem", { name: /Priority ranking/ });
    fireEvent.keyDown(menuItem, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Campus overview" })).toBeInTheDocument();
    const skip = screen.getByRole("button", { name: "Skip tour" });
    skip.focus(); // a keyboard user tabs into the tour panel
    expect(document.activeElement).toBe(skip);
    fireEvent.click(skip);
    expect(screen.queryByRole("dialog", { name: "Campus overview" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(tourButton);
  });

  it("opens and closes settings with keyboard support", async () => {
    renderWithProviders(<App />);
    await screen.findByText("99.3");
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });
});
