import { describe, expect, it } from "vitest";
import { buildCopilotContext, contextChips, describeAiError, describeAiStatus, displayedModel, historyForRequest, starterQuestions } from "./copilot";
import { ApiError } from "../api";
import { FALLBACK_WEIGHTS } from "./constants";

const base = { activeLayer: "ndvi", displayedZoneId: "Z01", selectedZoneId: null, selectedCellId: null, compareIds: ["Z01", "Z05"], scenarioWeights: null, officialWeights: FALLBACK_WEIGHTS };

describe("Copilot page context", () => {
  it("shares only what is relevant to the current page", () => {
    expect(buildCopilotContext({ ...base, view: "overview" })).toEqual({ page: "overview" });
    expect(buildCopilotContext({ ...base, view: "map", selectedCellId: "C_1,2" })).toEqual({ page: "map", zone_id: "Z01", cell_id: "C_1,2", map_layer: "ndvi" });
    expect(buildCopilotContext({ ...base, view: "compare" })).toEqual({ page: "compare", compare_zone_ids: ["Z01", "Z05"] });
    expect(buildCopilotContext({ ...base, view: "air-quality", viewContext: { air: { range: 48 } } })).toEqual({ page: "air-quality", air_quality_range_hours: 48 });
    expect(buildCopilotContext({ ...base, view: "trends", selectedZoneId: "Z03", selectedCellId: "C_9,9", viewContext: { trends: { dataset: "landsat", unit: "zone", metric: "green" } } })).toEqual({
      page: "trends", zone_id: "Z03", trend_dataset: "landsat", trend_unit: "zone", trend_metric: "green",
    });
  });

  it("sends scenario weights on the Scenario Lab, and elsewhere only once they differ from official", () => {
    expect(buildCopilotContext({ ...base, view: "scenario" }).scenario_weights).toEqual({ low_green_cover: 35, ndvi_decline: 25, built_up_pressure: 20, tree_gap: 10, pm_stress: 10 });
    const official = { low_green_cover: 35, ndvi_decline: 25, built_up_pressure: 20, tree_gap: 10, pm_stress: 10 };
    expect(buildCopilotContext({ ...base, view: "overview", scenarioWeights: official }).scenario_weights).toBeUndefined();
    const changed = { ...official, pm_stress: 100 };
    expect(buildCopilotContext({ ...base, view: "insights", scenarioWeights: changed }).scenario_weights).toEqual(changed);
  });

  it("labels the context and suggests questions for the page", () => {
    const chips = contextChips({ page: "map", zone_id: "Z01", map_layer: "ndvi", scenario_weights: {} }, new Map([["Z01", "North-West Zone"]]));
    expect(chips.map((chip) => chip.label)).toEqual(["Spatial Explorer", "Z01 · North-West Zone", "Layer: NDVI", "Scenario weights (experimental)"]);
    expect(starterQuestions({ page: "map", zone_id: "Z01" })[0]).toBe("Explain the zone I have selected.");
    expect(starterQuestions({ page: "scenario" })).toContain("What changed in my Scenario Lab?");
    expect(starterQuestions({ page: "insights" })).toContain("What is the difference between NDVI and NDBI?");
    expect(starterQuestions({ page: "overview" })).toEqual([
      "Which campus zone has the highest environmental priority?",
      "Explain the current vegetation trends.",
      "Compare two campus zones.",
      "How does the environmental priority score work?",
    ]);
    for (const page of ["overview", "map", "trends", "air-quality", "compare", "scenario", "insights", "report"]) {
      expect(starterQuestions({ page })).toHaveLength(4);
    }
  });

  it("bounds history and drops errors and notices", () => {
    const messages = [
      { role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "error", content: "boom" },
      { role: "user", content: "c" }, { role: "notice", content: "stopped" }, { role: "user", content: "x".repeat(5000) },
    ];
    const history = historyForRequest(messages, 3);
    expect(history.map((item) => item.role)).toEqual(["assistant", "user", "user"]);
    expect(history[2].content).toHaveLength(4000);
    expect(historyForRequest(messages, 0)).toEqual([]);
  });

  it("displays the model that answered, or the one the next question will use", () => {
    const status = { state: "ready", data: { model: "gemini-3.5-flash-lite", fallback_model: "gemini-3.1-flash-lite", models: [{ cooldown: null }] } };
    expect(displayedModel(status, [])).toEqual({ model: "gemini-3.5-flash-lite", fallback: false });
    const paused = { ...status, data: { ...status.data, models: [{ cooldown: { category: "quota_exhausted", seconds_remaining: 60 } }] } };
    expect(displayedModel(paused, [])).toEqual({ model: "gemini-3.1-flash-lite", fallback: true });
    const messages = [{ role: "assistant", response: { model: "gemini-3.1-flash-lite", fallback_used: true } }, { role: "user", content: "next" }];
    expect(displayedModel(status, messages)).toEqual({ model: "gemini-3.1-flash-lite", fallback: true });
    expect(displayedModel({ state: "error", data: null }, [])).toBeNull();
  });

  it("describes errors and status honestly", () => {
    expect(describeAiError(new ApiError("x", { kind: "network" })).category).toBe("network");
    expect(describeAiError(new ApiError("Quota used up.", { status: 429, details: { category: "quota_exhausted", retryable: false, diagnostic: "Daily limit of 20 reached." } }))).toEqual({
      category: "quota_exhausted", message: "Quota used up.", retryable: false, diagnostic: "Daily limit of 20 reached.",
    });
    expect(describeAiError(new ApiError("bad", { status: 413 })).retryable).toBe(false);
    expect(describeAiStatus({ state: "ready", data: { enabled: true, key_configured: true, provider_status: { state: "not_checked" } } }).label).toBe("Configured · not checked yet");
    expect(describeAiStatus({ state: "ready", data: { enabled: true, key_configured: true, provider_status: { state: "connected" } } }).tone).toBe("positive");
    expect(describeAiStatus({ state: "ready", data: { enabled: true, key_configured: false } }).label).toBe("Configuration needed");
    expect(describeAiStatus({ state: "error", data: null }).label).toBe("API unreachable");
  });
});
