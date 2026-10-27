import { describe, expect, it } from "vitest";
import fixture from "../test/fixtures/analysis.json";
import { buildSeries, inlineLabel, summarizeSeries } from "./analysis";
import { answerQuestion, QUESTIONS } from "./assistant";
import { interpretComparison, toggleZone } from "./comparison";
import { buildInsights } from "./insights";
import { normalizeWeights, sanitizeWeight, scenarioMatchesOfficial, simulateScenario, weightsToPercent } from "./scenario";

const { priority, scoring, historical } = fixture;
const official = scoring.weights;

describe("Scenario Lab maths", () => {
  it("normalises raw weights to 100% and rejects unusable input", () => {
    const result = normalizeWeights({ low_green_cover: 50, ndvi_decline: 50, built_up_pressure: 0, tree_gap: 0, pm_stress: 0 });
    expect(result.valid).toBe(true);
    expect(result.effective.low_green_cover).toBe(0.5);
    expect(Object.values(result.effective).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(sanitizeWeight(-5)).toBe(0);
    expect(sanitizeWeight(250)).toBe(100);
    expect(sanitizeWeight("abc")).toBeNull();
    expect(sanitizeWeight(Infinity)).toBeNull();
  });

  it("refuses an all-zero scenario instead of dividing by zero", () => {
    const zero = { low_green_cover: 0, ndvi_decline: 0, built_up_pressure: 0, tree_gap: 0, pm_stress: 0 };
    const result = simulateScenario(priority, zero, official);
    expect(result.valid).toBe(false);
    expect(result.rows).toEqual([]);
  });

  it("reproduces the official scores with the official weights", () => {
    const weights = weightsToPercent(official);
    expect(weights).toEqual({ low_green_cover: 35, ndvi_decline: 25, built_up_pressure: 20, tree_gap: 10, pm_stress: 10 });
    expect(scenarioMatchesOfficial(weights, official)).toBe(true);
    const result = simulateScenario(priority, weights, official);
    for (const row of result.rows) {
      expect(row.simulatedScore).toBeCloseTo(row.officialScore, 1);
      expect(row.rankChange).toBe(0);
    }
  });

  it("changes hypothetical ranks without mutating the official rows", () => {
    const snapshot = JSON.stringify(priority);
    const result = simulateScenario(priority, { low_green_cover: 0, ndvi_decline: 0, built_up_pressure: 0, tree_gap: 100, pm_stress: 0 }, official);
    expect(JSON.stringify(priority)).toBe(snapshot);
    expect(result.rows[0].zone_id).toBe("Z03"); // lowest tree cover
    expect(result.rows.some((row) => row.rankChange !== 0)).toBe(true);
    const z03 = result.rows.find((row) => row.zone_id === "Z03");
    expect(z03.drivers[0].key).toBe("tree_gap");
  });

  it("treats a PM-only scenario as a full tie instead of reordering zones by ID", () => {
    const result = simulateScenario(priority, { low_green_cover: 0, ndvi_decline: 0, built_up_pressure: 0, tree_gap: 0, pm_stress: 100 }, official);
    expect(result.allTied).toBe(true);
    expect(new Set(result.rows.map((row) => row.simulatedScore)).size).toBe(1);
    expect(result.rows.every((row) => row.simulatedRank === 1)).toBe(true);
    // Shared rank 1, listed in official order.
    expect(result.rows.map((row) => row.zone_id)).toEqual(["Z01", "Z05", "Z03", "Z04", "Z02"]);
  });

  it("keeps the official order when only the shared PM weight changes", () => {
    const pm = priority[0].pm_stress_score;
    for (const pmWeight of [0, 5, 10, 40, 90]) {
      const weights = { low_green_cover: 35, ndvi_decline: 25, built_up_pressure: 20, tree_gap: 10, pm_stress: pmWeight };
      const result = simulateScenario(priority, weights, official);
      expect(result.allTied).toBe(false);
      expect(result.rows.map((row) => row.zone_id)).toEqual(["Z01", "Z05", "Z03", "Z04", "Z02"]);
      expect(result.rows.every((row) => row.rankChange === 0)).toBe(true);
      // Score = (1 - p) x (non-PM part rescaled) + p x common PM, i.e. a monotone transform of the official score.
      const p = pmWeight / (90 + pmWeight);
      for (const row of result.rows) {
        const nonPm = (row.officialScore - 0.1 * pm) / 0.9;
        expect(row.simulatedScore).toBeCloseTo((1 - p) * nonPm + p * pm, 1);
      }
    }
  });

  it("does not let 2-decimal rounding turn a near-tie into a PM-driven rank change", () => {
    const zone = (id, lowGreen, score) => ({
      zone_id: id, zone_name: id, priority_score: score, low_green_cover_score: lowGreen, ndvi_decline_score: 0,
      built_up_pressure_score: 30, tree_gap_score: 50, pm_stress_score: 60,
    });
    const input = [zone("ZA", 20, 24.0), zone("ZB", 19.97, 23.99)];
    const result = simulateScenario(input, { low_green_cover: 35, ndvi_decline: 25, built_up_pressure: 20, tree_gap: 10, pm_stress: 100 }, official);
    expect(result.rows.map((row) => row.simulatedScore)).toEqual([41.05, 41.05]); // equal once rounded for display
    expect(result.rows.map((row) => [row.zone_id, row.simulatedRank, row.rankChange])).toEqual([["ZA", 1, 0], ["ZB", 2, 0]]);
    expect(result.hasTies).toBe(false);
  });

  it("gives equal scenario scores a shared rank and is deterministic", () => {
    const twin = { ...priority[3], zone_id: "Z09", zone_name: "Twin of Z04" };
    const input = [...priority, twin];
    const first = simulateScenario(input, weightsToPercent(official), official);
    const second = simulateScenario([...input].reverse(), weightsToPercent(official), official);
    expect(first.rows).toEqual(second.rows);
    expect(first.hasTies).toBe(true);
    const ranks = Object.fromEntries(first.rows.map((row) => [row.zone_id, row.simulatedRank]));
    expect(ranks.Z04).toBe(ranks.Z09);
    expect(ranks.Z02).toBe(6);
    expect(first.rows.every((row) => row.rankChange === 0)).toBe(true);
  });

  it("handles extreme and non-finite raw weights safely", () => {
    const result = simulateScenario(priority, { low_green_cover: 1e9, ndvi_decline: "NaN", built_up_pressure: -50, tree_gap: Infinity, pm_stress: "" }, official);
    expect(result.valid).toBe(true);
    expect(result.raw).toEqual({ low_green_cover: 100, ndvi_decline: 0, built_up_pressure: 0, tree_gap: 0, pm_stress: 0 });
    expect(result.effective.low_green_cover).toBe(1);
    for (const row of result.rows) expect(Number.isFinite(row.simulatedScore)).toBe(true);
  });

  it("excludes zones without an official score", () => {
    const withMissing = [...priority, { zone_id: "Z99", zone_name: "Missing", priority_score: null, score_status: "insufficient_data" }];
    expect(simulateScenario(withMissing, weightsToPercent(official), official).excluded).toHaveLength(1);
  });
});

describe("insights, comparison and guided answers", () => {
  it("derives deterministic insights from the official rows", () => {
    const insights = buildInsights(priority, [{ properties: { cell_id: "C_1", zone_id: "Z01", zone_name: "North-West Zone", potential_plantable_percent: 100 } }, { properties: { cell_id: "C_2", zone_id: "Z02", potential_plantable_percent: 0 } }]);
    const byId = Object.fromEntries(insights.map((item) => [item.id, item]));
    expect(byId["highest-priority"].location).toBe("North-West Zone");
    expect(byId["largest-decline"].value).toBe("-0.088");
    expect(byId["lowest-green"].location).toBe("Central Zone");
    expect(byId["highest-built"].value).toBe("98.6%");
    expect(byId["most-stable"].location).toBe("Central Zone");
    expect(byId["plantable-potential"].value).toBe("1");
    expect(byId["highest-priority"].detail).toContain("NDVI decline");
    for (const insight of insights) expect(insight.evidence.length).toBeGreaterThan(0);
  });

  it("returns no insights rather than invented ones when data is missing", () => {
    expect(buildInsights([], [])).toEqual([]);
  });

  it("keeps comparison selections stable and capped", () => {
    expect(toggleZone(["Z01", "Z02"], "Z03")).toEqual(["Z01", "Z02", "Z03"]);
    expect(toggleZone(["Z01", "Z02", "Z03"], "Z04")).toEqual(["Z01", "Z02", "Z03"]);
    expect(toggleZone(["Z01", "Z02", "Z03"], "Z02")).toEqual(["Z01", "Z03"]);
  });

  it("explains a comparison from the weighted contributions", () => {
    const [z01, z05] = priority;
    const sentences = interpretComparison([z05, z01]);
    expect(sentences[0]).toMatch(/^North-West Zone scores 2\.32 points above South-West Zone, mainly from NDVI decline/);
    expect(sentences.at(-1)).toContain("does not change their relative order");
    expect(interpretComparison([z01, { ...z05, priority_score: null, zone_name: "X" }])[0]).toContain("no official score");
  });

  it("answers every guided question or reports it as unavailable", () => {
    const context = { priority, scoring, environment: null, cells: [] };
    for (const question of QUESTIONS) {
      const answer = answerQuestion(question.id, context);
      expect(answer.title).toBe(question.text);
      expect(["answered", "unavailable"]).toContain(answer.status);
    }
    expect(answerQuestion("top-zone", context).summary).toContain("North-West Zone");
    expect(answerQuestion("plantable", context).status).toBe("unavailable");
    expect(answerQuestion("top-zone", { priority: [] }).status).toBe("unavailable");
    expect(answerQuestion("sensors", context).summary).toMatch(/^No\./);
  });

  it("refuses out-of-scope questions instead of inventing an answer", () => {
    const context = { priority, scoring, environment: { stress_score: 100, pm_stress_source: "modelled" }, cells: [] };
    for (const id of ["species", "forecast", "not-a-question"]) {
      const answer = answerQuestion(id, context);
      expect(answer.status).toBe("unavailable");
      expect(answer.zoneId ?? null).toBeNull();
      // No figures that could be mistaken for results: no 2-decimal scores, no echoed PM stress.
      expect(JSON.stringify(answer)).not.toMatch(/\d+\.\d{2}/);
      expect(JSON.stringify(answer)).not.toContain("100");
    }
    expect(answerQuestion("species", context).summary).toMatch(/^Not answered/);
    expect(answerQuestion("forecast", context).summary).toMatch(/does not forecast/);
  });

  it("summarises vegetation series with explicit thresholds", () => {
    const series = buildSeries(historical, { idField: "zone_id", id: "Z01", field: "mean_ndvi" });
    expect(series).toHaveLength(8);
    const summary = summarizeSeries(series, "ndvi");
    expect([summary.baselineYear, summary.latestYear]).toEqual([2018, 2025]);
    expect(summary.change).toBeCloseTo(-0.0883, 4);
    expect(summary.status).toBe("Declining");
    expect(summarizeSeries(buildSeries(historical, { idField: "zone_id", id: "Z03", field: "mean_ndvi" }), "ndvi").status).toBe("Stable");
    expect(summarizeSeries([{ year: 2020, value: null }], "ndvi").status).toBe("Unavailable");
  });

  it("keeps acronyms when inlining labels", () => {
    expect(inlineLabel("NDVI decline")).toBe("NDVI decline");
    expect(inlineLabel("Low green cover")).toBe("low green cover");
  });
});
