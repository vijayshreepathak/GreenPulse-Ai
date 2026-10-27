import { describe, expect, it } from "vitest";
import { dateStamp, escapeCell, safeFilename, toCsv } from "./csv";
import { analysisSnapshot, priorityCsv } from "./exports";
import fixture from "../test/fixtures/analysis.json";

/** Minimal RFC 4180 parser used to read exports back. */
function parseCsv(text) {
  const rows = [[]];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { rows.at(-1).push(field); field = ""; }
    else if (char === "\r" && text[index + 1] === "\n") { rows.at(-1).push(field); field = ""; rows.push([]); index += 1; }
    else field += char;
  }
  if (field || rows.at(-1).length) rows.at(-1).push(field);
  return rows.filter((row) => row.length);
}

describe("CSV export", () => {
  it("escapes delimiters, quotes and newlines", () => {
    expect(escapeCell('a,"b"')).toBe('"a,""b"""');
    expect(escapeCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCell(" padded ")).toBe('" padded "');
  });

  it("neutralises spreadsheet formulas but keeps numbers intact", () => {
    expect(escapeCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(escapeCell("+cmd")).toBe("'+cmd");
    expect(escapeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCell("-2+3")).toBe("'-2+3");
    expect(escapeCell(-0.0883)).toBe("-0.0883");
    expect(escapeCell("-0.088")).toBe("-0.088");
  });

  it("writes missing values as empty cells, never zero", () => {
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(undefined)).toBe("");
    expect(escapeCell(Number.NaN)).toBe("");
    expect(escapeCell(0)).toBe("0");
    expect(escapeCell(["a", "b"])).toBe("a; b");
  });

  it("prefixes metadata rows and uses CRLF with a UTF-8 BOM", () => {
    const csv = toCsv({ metadata: [["Source", "Sentinel-2"]], columns: [{ key: "a", label: "a" }], rows: [{ a: 1 }, { a: null }] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")).toEqual(["# Source: Sentinel-2", "a", "1", "", ""]);
  });

  it("builds a priority ranking export with sources and units", () => {
    const csv = priorityCsv({ priority: fixture.priority, environment: { pm_stress_source: "fallback", freshness: "unavailable" }, datasets: { sentinel2_zone_history: { baseline_year: 2018, latest_year: 2025, season: "Jan-Mar" } } });
    expect(csv).toContain("# Vegetation data: Sentinel-2 Jan-Mar composites 2018-2025");
    expect(csv).toContain("Documented fallback 60");
    const header = csv.split("\r\n").find((line) => line.startsWith("rank,"));
    expect(header).toContain("contribution_ndvi_decline");
    expect(csv).toContain("1,Z01,North-West Zone,63.43,High");
  });

  it("round-trips the ranking CSV back to the official values", () => {
    const unavailable = { zone_id: "Z06", zone_name: '=Annex, "B"', rank: null, priority_score: null, priority_class: "Unavailable", score_status: "insufficient_data", ndvi_change: -0.0412 };
    const csv = priorityCsv({ priority: [...fixture.priority, unavailable], environment: { pm_stress_source: "modelled", freshness: "live" }, datasets: {} });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = parseCsv(csv.slice(1)).filter((row) => !row[0].startsWith("# "));
    const [header, ...rows] = lines.filter((row) => row.length > 1);
    const records = rows.map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])));
    expect(records).toHaveLength(fixture.priority.length + 1);
    fixture.priority.forEach((zone, index) => {
      expect(records[index].zone_id).toBe(zone.zone_id);
      expect(Number(records[index].priority_score)).toBe(zone.priority_score);
      expect(Number(records[index].ndvi_change)).toBe(zone.ndvi_change);
      expect(Number(records[index].contribution_pm_stress)).toBe(zone.contribution_pm_stress);
    });
    const annex = records.at(-1);
    expect(annex.rank).toBe("");
    expect(annex.priority_score).toBe("");
    expect(annex.zone_name).toBe(`'=Annex, "B"`); // formula neutralised, quoting survives
    expect(annex.ndvi_change).toBe("-0.0412");
  });

  it("exports a JSON snapshot without NaN or Infinity", () => {
    const environment = { freshness: "stale", stress_score: Number.NaN, averages_24h: { pm2_5: Infinity }, records: [{ time: "2026-10-27T10:00", pm2_5: 12.5 }] };
    const snapshot = JSON.parse(JSON.stringify(analysisSnapshot({ priority: fixture.priority, environment, scoring: fixture.scoring })));
    expect(snapshot.official_priority).toEqual(fixture.priority);
    expect(snapshot.modelled_air_quality.stress_score).toBeNull();
    expect(snapshot.modelled_air_quality.averages_24h.pm2_5).toBeNull();
    expect(snapshot.modelled_air_quality.hourly_record_count).toBe(1);
    expect(snapshot.scoring_methodology.weights).toEqual(fixture.scoring.weights);
  });

  it("stamps filenames with the local calendar date", () => {
    expect(dateStamp(new Date(2026, 0, 2, 0, 30))).toBe("2026-01-02");
  });

  it("creates safe filenames", () => {
    expect(safeFilename("GreenPulse trend: North-West/Zone 2026")).toBe("greenpulse-trend-north-west-zone-2026.csv");
    expect(safeFilename("../../etc/passwd", "json")).toBe("etc-passwd.json");
    expect(safeFilename("")).toBe("greenpulse-export.csv");
  });
});
