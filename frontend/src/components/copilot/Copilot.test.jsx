import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../test/fixtures/analysis.json";
import { installMatchMedia, renderWithProviders } from "../../test/utils";

vi.mock("../../api", async () => {
  const actual = await vi.importActual("../../api");
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

const api = await import("../../api");
const { default: App } = await import("../../App");

const environment = {
  freshness: "cached",
  fetched_at: "2026-10-27T12:00:00Z",
  stress_score: 60,
  pm_stress_source: "modelled",
  averages_24h: { pm2_5: 30, pm10: 50, record_count: 24, complete: true },
  stress_components: { pm25_score: 50, pm10_score: 50 },
  current: { pm2_5: 31, pm10: 52, time: "2026-10-27T17:30", source: "provider_current" },
  records: [],
  provider_status: { ok: true },
};

const READY = {
  enabled: true,
  key_configured: true,
  available: true,
  model: "gemini-3.5-flash-lite",
  provider_status: { state: "not_checked", category: null },
  message: "Configured. The Gemini connection has not been checked yet.",
  data_use: "Questions and a short page context are sent to Google Gemini.",
  limits: { max_history_messages: 12, timeout_seconds: 30, max_tool_calls: 4, max_message_chars: 2000 },
};

const ANSWER = {
  request_id: "r1",
  answer: "**North-West Zone** (Z01) has the highest official priority.\n\n- Score 63.43\n- Class High\n\n<img src=x onerror=alert(1)> [map](javascript:alert(1))",
  evidence: [{ id: "official-ranking", label: "Official priority ranking", source: "GreenPulse rule-based score", detail: "PM stress 60 (fallback)", as_of: null }],
  facts: [{ label: "Top priority · Z01", value: "63.43", unit: "/100", detail: "North-West Zone · High", source: "Official score" }],
  visual: { type: "table", title: "Official priority ranking", columns: ["Rank", "Zone", "Score", "Class"], rows: [["1", "Z01 · North-West Zone", "63.43", "High"]], source: "Official rule-based score" },
  follow_ups: ["Why is Z01 ranked highest?"],
  tools_used: [{ name: "get_zone_rankings", label: "Fetching the official zone ranking", status: "ok", detail: null }],
  context_used: { page: "overview" },
  context_notes: [],
  verification: { status: "verified", checked: 1, unverified: [] },
  model: "gemini-3.5-flash-lite",
  created_at: "2026-10-28T00:00:00Z",
};

/** postAiChat that stays pending until resolved, and rejects like the real client when aborted. */
function pendingChat() {
  const handle = {};
  vi.mocked(api.postAiChat).mockImplementation(
    (body, { signal } = {}) =>
      new Promise((resolve, reject) => {
        handle.body = body;
        handle.signal = signal;
        handle.resolve = resolve;
        handle.reject = reject;
        signal?.addEventListener("abort", () => reject(new api.ApiError("The request was cancelled.", { kind: "aborted" })));
      })
  );
  return handle;
}

async function openCopilot() {
  renderWithProviders(<App />);
  await screen.findByText("99.3");
  fireEvent.click(await screen.findByRole("button", { name: "Ask Copilot" }));
  return screen.findByRole("dialog", { name: "GreenPulse AI Copilot" });
}

function composer() {
  return screen.getByRole("textbox", { name: "Message GreenPulse AI Copilot" });
}

function navigate(hash) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

describe("GreenPulse AI Copilot", () => {
  beforeEach(() => {
    installMatchMedia();
    window.location.hash = "#/overview";
    vi.mocked(api.getDashboard).mockResolvedValue({
      summary: { total_area_hectares: 99.3075, green_cover_percent: 67.43, average_ndvi: 0.3709 },
      priority: fixture.priority,
      historical_ndvi: fixture.historical,
      recent_aqi: environment,
      spatial_analysis: { cell_count: 447, latest_satellite_year: 2025, season: "Oct-Dec" },
      scoring: fixture.scoring,
      datasets: { sentinel2_zone_history: { baseline_year: 2018, latest_year: 2025, season: "Oct-Dec" } },
      notes: [],
      data_issues: [],
    });
    vi.mocked(api.getSpatialCells).mockResolvedValue({ available: false, geojson: { type: "FeatureCollection", features: [] } });
    vi.mocked(api.getLandsatHistory).mockRejectedValue(new api.ApiError("Landsat history unavailable"));
    vi.mocked(api.getZoneGeojson).mockRejectedValue(new api.ApiError("Zone map file not found."));
    vi.mocked(api.getAnalysisCurrent).mockResolvedValue({ environment, priority: fixture.priority });
    vi.mocked(api.getAiStatus).mockResolvedValue(READY);
    vi.mocked(api.getAiProgress).mockRejectedValue(new api.ApiError("No request with this ID", { status: 404 }));
    vi.mocked(api.cancelAiChat).mockResolvedValue({ cancelled: true });
    vi.mocked(api.postAiChat).mockResolvedValue(ANSWER);
  });

  it("opens from the launcher with context-aware starter questions and closes back to the launcher", async () => {
    const panel = await openCopilot();
    expect(within(panel).getByRole("heading", { name: "Ask about GreenPulse data" })).toBeInTheDocument();
    expect(within(panel).getByText("Google Gemini · gemini-3.5-flash-lite")).toBeInTheDocument();
    const starters = within(panel).getByRole("list", { name: "Suggested questions" });
    expect(within(starters).getAllByRole("button")).toHaveLength(4);
    expect(within(starters).getByRole("button", { name: "Which campus zone has the highest environmental priority?" })).toBeInTheDocument();
    expect(within(panel).getByText("Overview", { selector: ".copilot-chip" })).toBeInTheDocument();
    await waitFor(() => expect(composer()).toHaveFocus());

    fireEvent.keyDown(composer(), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "GreenPulse AI Copilot" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask Copilot" })).toHaveFocus());
  });

  it("sends a question with the page context and renders a grounded, safe answer", async () => {
    const chat = pendingChat();
    const panel = await openCopilot();
    fireEvent.change(composer(), { target: { value: "Which zone has the highest priority?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    expect(within(panel).getByText("Which zone has the highest priority?")).toBeInTheDocument();
    expect(within(panel).getByRole("status")).toHaveTextContent("Preparing context");
    expect(composer()).toHaveValue("");
    expect(chat.body).toMatchObject({ message: "Which zone has the highest priority?", history: [], context: { page: "overview" } });
    expect(chat.body.request_id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    // The launcher is hidden while the panel is open but still reflects the running answer.
    const launcher = document.querySelector(".copilot-launcher");
    expect(launcher).toHaveAttribute("aria-label", "Ask Copilot, answer in progress");
    expect(launcher).toHaveClass("is-busy");

    await act(async () => chat.resolve(ANSWER));
    const answer = await within(panel).findByText("North-West Zone", { selector: "strong" });
    const message = answer.closest(".copilot-msg");
    expect(within(message).getByText("Score 63.43")).toBeInTheDocument();
    // Raw HTML and link syntax from the model stay text: no image, no anchor.
    expect(message.querySelector("img")).toBeNull();
    expect(message.querySelector("a")).toBeNull();
    expect(within(message).getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    // KPI cards and the table come from server data.
    const facts = within(message).getByLabelText("Key figures from GreenPulse data");
    expect(within(facts).getByText("63.43")).toBeInTheDocument();
    expect(within(facts).getByText("Top priority · Z01")).toBeInTheDocument();
    expect(within(message).getByRole("region", { name: "Official priority ranking" })).toBeInTheDocument();
    expect(within(within(message).getByRole("list", { name: "Sources used" })).getByText("Official priority ranking")).toBeInTheDocument();
    expect(within(panel).queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows real server progress, then asks a follow-up with bounded history", async () => {
    const chat = pendingChat();
    vi.mocked(api.getAiProgress).mockResolvedValue({
      request_id: "x",
      stage: "tool",
      label: "Fetching the official zone ranking",
      steps: [{ tool: "get_zone_rankings", label: "Fetching the official zone ranking", status: "running" }],
      done: false,
    });
    const panel = await openCopilot();
    fireEvent.click(within(panel).getByRole("button", { name: "Which campus zone has the highest environmental priority?" }));
    expect(await within(panel).findByText("Fetching the official zone ranking", { selector: ".copilot-progress__label" })).toBeInTheDocument();
    expect(within(within(panel).getByRole("list", { name: "Data tools" })).getByText("Fetching the official zone ranking")).toBeInTheDocument();

    await act(async () => chat.resolve(ANSWER));
    const followUp = await within(panel).findByRole("button", { name: "Why is Z01 ranked highest?" });
    fireEvent.click(followUp);
    expect(chat.body.message).toBe("Why is Z01 ranked highest?");
    expect(chat.body.history).toEqual([
      { role: "user", content: "Which campus zone has the highest environmental priority?" },
      { role: "assistant", content: ANSWER.answer },
    ]);
  });

  it("keeps Shift+Enter as a new line and refuses empty questions", async () => {
    await openCopilot();
    fireEvent.change(composer(), { target: { value: "first line" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(api.postAiChat).not.toHaveBeenCalled();
    fireEvent.change(composer(), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(api.postAiChat).not.toHaveBeenCalled();
  });

  it("shows a categorised error and retries without duplicating the question", async () => {
    vi.mocked(api.postAiChat)
      .mockRejectedValueOnce(new api.ApiError("Gemini is temporarily unavailable. Please try again.", { status: 502, details: { category: "provider_unavailable", retryable: true } }))
      .mockResolvedValueOnce(ANSWER);
    const panel = await openCopilot();
    fireEvent.change(composer(), { target: { value: "Which zone has the highest priority?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    const alert = await within(panel).findByRole("alert");
    expect(alert).toHaveTextContent("Gemini is temporarily unavailable. Please try again.");

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await within(panel).findByText("North-West Zone", { selector: "strong" });
    expect(api.postAiChat).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.postAiChat).mock.calls[1][0]).toMatchObject({ message: "Which zone has the highest priority?", history: [] });
    expect(within(panel).getAllByText("Which zone has the highest priority?")).toHaveLength(1);
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not offer Retry for a quota or configuration failure", async () => {
    vi.mocked(api.postAiChat).mockRejectedValue(new api.ApiError("The Gemini quota for this API key is used up.", { status: 429, details: { category: "quota_exhausted", retryable: false } }));
    const panel = await openCopilot();
    fireEvent.change(composer(), { target: { value: "Hi" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    const alert = await within(panel).findByRole("alert");
    expect(alert).toHaveTextContent("quota");
    expect(within(alert).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("re-reads the provider status after a failed answer so the header never stays 'connected'", async () => {
    vi.mocked(api.getAiStatus)
      .mockResolvedValueOnce({ ...READY, provider_status: { state: "connected", category: null } })
      .mockResolvedValue({ ...READY, provider_status: { state: "error", category: "invalid_key" }, message: "Your Gemini API configuration needs attention. Gemini rejected the API key." });
    vi.mocked(api.postAiChat).mockRejectedValue(new api.ApiError("Your Gemini API configuration needs attention. Gemini rejected the API key.", { status: 503, details: { category: "invalid_key", retryable: false } }));
    const panel = await openCopilot();
    await waitFor(() => expect(within(panel).getByText(/status: Connected/)).toBeInTheDocument());
    fireEvent.change(composer(), { target: { value: "Hi" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await within(panel).findByRole("alert");
    await waitFor(() => expect(within(panel).getByText(/status: Needs attention/)).toBeInTheDocument());
    expect(api.getAiStatus).toHaveBeenCalledTimes(2);
  });

  it("shows the model that actually answered, including a fallback and why", async () => {
    vi.mocked(api.getAiStatus).mockResolvedValue({ ...READY, fallback_model: "gemini-3.1-flash-lite" });
    vi.mocked(api.postAiChat).mockResolvedValue({ ...ANSWER, model: "gemini-3.1-flash-lite", primary_model: "gemini-3.5-flash-lite", fallback_used: true, fallback_reason: "quota_exhausted" });
    const panel = await openCopilot();
    expect(await within(panel).findByText("Google Gemini · gemini-3.5-flash-lite")).toBeInTheDocument();
    fireEvent.change(composer(), { target: { value: "Which zone?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(await within(panel).findByText("Answered by gemini-3.1-flash-lite · fallback because the primary model's quota is used up")).toBeInTheDocument();
    expect(within(panel).getByText("Google Gemini · gemini-3.1-flash-lite (fallback)")).toBeInTheDocument();
  });

  it("shows the fallback as the active model while the primary is paused, and quota details on errors", async () => {
    vi.mocked(api.getAiStatus).mockResolvedValue({
      ...READY,
      fallback_model: "gemini-3.1-flash-lite",
      models: [{ model: "gemini-3.5-flash-lite", role: "primary", cooldown: { category: "quota_exhausted", seconds_remaining: 600 } }, { model: "gemini-3.1-flash-lite", role: "fallback", cooldown: null }],
    });
    vi.mocked(api.postAiChat).mockRejectedValue(new api.ApiError("The Gemini quota for this API key is used up.", {
      status: 429,
      details: { category: "quota_exhausted", retryable: false, diagnostic: "Daily free-tier request limit of 20 for gemini-3.5-flash-lite reached." },
    }));
    const panel = await openCopilot();
    expect(await within(panel).findByText("Google Gemini · gemini-3.1-flash-lite (fallback)")).toBeInTheDocument();
    fireEvent.change(composer(), { target: { value: "Hi" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    const alert = await within(panel).findByRole("alert");
    expect(alert).toHaveTextContent("Daily free-tier request limit of 20 for gemini-3.5-flash-lite reached.");
  });

  it("stops a running answer, tells the server, and allows a retry", async () => {
    const chat = pendingChat();
    const panel = await openCopilot();
    fireEvent.change(composer(), { target: { value: "Compare Z01 and Z05" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Stop answer" }));

    expect(chat.signal.aborted).toBe(true);
    expect(api.cancelAiChat).toHaveBeenCalledWith(chat.body.request_id);
    const notice = await within(panel).findByText("You stopped this answer.");
    expect(within(notice.closest(".copilot-msg")).getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(within(panel).queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send question" })).toBeInTheDocument();
  });

  it("New chat keeps the draft; Clear chat removes it too; late answers are ignored", async () => {
    const chat = pendingChat();
    const panel = await openCopilot();
    fireEvent.change(composer(), { target: { value: "Explain NDVI" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    fireEvent.change(composer(), { target: { value: "draft text" } });

    fireEvent.click(within(panel).getByRole("button", { name: "New chat" }));
    expect(chat.signal.aborted).toBe(true);
    await act(async () => chat.resolve(ANSWER)); // arrives after the reset: must not appear
    expect(within(panel).queryByText("Explain NDVI")).not.toBeInTheDocument();
    expect(within(panel).queryByText("North-West Zone", { selector: "strong" })).not.toBeInTheDocument();
    expect(within(panel).queryByText("You stopped this answer.")).not.toBeInTheDocument();
    expect(composer()).toHaveValue("draft text");
    expect(within(panel).getByRole("heading", { name: "Ask about GreenPulse data" })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Clear chat" }));
    expect(composer()).toHaveValue("");
  });

  it("follows navigation while open and keeps the conversation", async () => {
    const panel = await openCopilot();
    fireEvent.change(composer(), { target: { value: "Hi" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await within(panel).findByText("North-West Zone", { selector: "strong" });

    navigate("#/scenario");
    await screen.findByRole("heading", { name: "What-if priority analysis" });
    expect(screen.getByRole("dialog", { name: "GreenPulse AI Copilot" })).toBe(panel);
    expect(within(panel).getByText("Scenario Lab", { selector: ".copilot-chip" })).toBeInTheDocument();
    expect(within(panel).getByText("Scenario weights (experimental)")).toBeInTheDocument();
    expect(within(panel).getByText("Asked on Overview")).toBeInTheDocument(); // history keeps its own context

    fireEvent.change(composer(), { target: { value: "What changed in my Scenario Lab?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(api.postAiChat).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.postAiChat).mock.calls[1][0].context).toEqual({
      page: "scenario",
      scenario_weights: { low_green_cover: 35, ndvi_decline: 25, built_up_pressure: 20, tree_gap: 10, pm_stress: 10 },
    });
  });

  it("disabling in Settings hides the launcher, cancels the request and persists", async () => {
    const chat = pendingChat();
    await openCopilot();
    fireEvent.change(composer(), { target: { value: "Which zone?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    const settings = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(settings).getByText("gemini-3.5-flash-lite")).toBeInTheDocument();
    const toggle = within(settings).getByRole("switch", { name: /Enable AI Copilot/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    expect(chat.signal.aborted).toBe(true);
    expect(api.cancelAiChat).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "GreenPulse AI Copilot" })).not.toBeInTheDocument();
    expect(document.querySelector(".copilot-launcher")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("greenpulse:preferences")).aiAssistant).toBe(false);
    expect(within(settings).getByText(/no questions or page context are sent/)).toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(document.querySelector(".copilot-launcher")).not.toBeNull());
    expect(document.querySelector(".copilot-launcher")).not.toHaveAttribute("hidden");
  });

  it("stays hidden and silent when disabled before load", async () => {
    window.localStorage.setItem("greenpulse:preferences", JSON.stringify({ aiAssistant: false }));
    renderWithProviders(<App />);
    await screen.findByText("99.3");
    expect(document.querySelector(".copilot-launcher")).toBeNull();
    expect(api.getAiStatus).not.toHaveBeenCalled();
  });

  it("explains a missing key and disables the composer", async () => {
    vi.mocked(api.getAiStatus).mockResolvedValue({ ...READY, key_configured: false, available: false, message: "Your Gemini API configuration needs attention: GEMINI_API_KEY is not set in backend/.env." });
    const panel = await openCopilot();
    expect(await within(panel).findByText(/configuration needs attention/)).toBeInTheDocument();
    expect(composer()).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Which campus zone has the highest environmental priority?" })).toBeDisabled();
  });

  it("hides the launcher when the server disables the assistant", async () => {
    vi.mocked(api.getAiStatus).mockResolvedValue({ ...READY, enabled: false, available: false });
    renderWithProviders(<App />);
    await screen.findByText("99.3");
    await waitFor(() => expect(api.getAiStatus).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector(".copilot-launcher")).toBeNull());
  });

  it("flags figures the server could not verify and keeps working in dark mode", async () => {
    vi.mocked(api.postAiChat).mockResolvedValue({ ...ANSWER, verification: { status: "unverified_figures", checked: 2, unverified: ["71.20"] } });
    const panel = await openCopilot();
    fireEvent.click(screen.getByRole("button", { name: "Dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("dialog", { name: "GreenPulse AI Copilot" })).toBe(panel);
    fireEvent.change(composer(), { target: { value: "Which zone?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(await within(panel).findByText(/Not found in the retrieved data: 71.20/)).toBeInTheDocument();
  });

  it("shares the selected zone and active layer from the Spatial Explorer", async () => {
    window.location.hash = "#/map?zone=Z05&layer=ndvi";
    renderWithProviders(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Copilot" }));
    const panel = await screen.findByRole("dialog", { name: "GreenPulse AI Copilot" });
    expect(await within(panel).findByText("Z05 · South-West Zone")).toBeInTheDocument();
    expect(within(panel).getByText("Layer: NDVI")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Explain the zone I have selected." })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Explain the zone I have selected." }));
    await waitFor(() => expect(api.postAiChat).toHaveBeenCalled());
    expect(vi.mocked(api.postAiChat).mock.calls[0][0].context).toEqual({ page: "map", zone_id: "Z05", map_layer: "ndvi" });
  });
});
