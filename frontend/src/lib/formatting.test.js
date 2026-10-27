import { describe, expect, it } from "vitest";
import { formatNumber, formatPercent, percentChange, toNumber } from "./numbers";
import { formatChartTick, formatDateTime, formatRelative, parseTimestamp } from "./time";

describe("toNumber / formatNumber", () => {
  it.each([
    [null, null],
    [undefined, null],
    ["", null],
    ["   ", null],
    [Number.NaN, null],
    [Infinity, null],
    [-Infinity, null],
    ["abc", null],
    ["1.5x", null],
    [true, null],
    [{}, null],
  ])("treats %p as unavailable", (input, expected) => {
    expect(toNumber(input)).toBe(expected);
    expect(formatNumber(input)).toBe("N/A");
  });

  it("keeps a genuine zero and negative values", () => {
    expect(toNumber(0)).toBe(0);
    expect(toNumber("0")).toBe(0);
    expect(formatNumber(0, 1)).toBe("0.0");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatNumber(-0.0883, 3)).toBe("-0.088");
    expect(formatNumber(" 42.5 ", 1)).toBe("42.5");
  });

  it("signs positive values only and never prints negative zero", () => {
    expect(formatNumber(0.022, 3, { signed: true })).toBe("+0.022");
    expect(formatNumber(-0.0001, 3, { signed: true })).toBe("0.000");
    expect(formatNumber(0, 2, { signed: true })).toBe("0.00");
  });

  it("supports a custom fallback", () => {
    expect(formatNumber(null, 1, { fallback: "—" })).toBe("—");
  });

  it("calculates percentage change only with a non-zero baseline", () => {
    expect(percentChange(0.443, 0.355)).toBeCloseTo(-19.86, 1);
    expect(percentChange(0, 0.2)).toBeNull();
    expect(percentChange(null, 0.2)).toBeNull();
  });
});

describe("timestamps", () => {
  it("interprets naive provider timestamps as Asia/Kolkata", () => {
    expect(parseTimestamp("2026-10-27T16:00").toISOString()).toBe("2026-10-27T10:30:00.000Z");
    expect(parseTimestamp("2026-10-27T16:00:30").toISOString()).toBe("2026-10-27T10:30:30.000Z");
    expect(parseTimestamp("2026-10-27").toISOString()).toBe("2026-10-26T18:30:00.000Z");
  });

  it("respects UTC suffixes and explicit offsets", () => {
    expect(parseTimestamp("2026-10-27T10:30:00Z").toISOString()).toBe("2026-10-27T10:30:00.000Z");
    expect(parseTimestamp("2026-10-27T12:01:20.003181+00:00").toISOString()).toBe("2026-10-27T12:01:20.003Z");
    expect(parseTimestamp("2026-10-27T16:00+0530").toISOString()).toBe("2026-10-27T10:30:00.000Z");
  });

  it.each([null, "", "not a date", "2026-13-01T00:00", "27/10/2026", 12345])("returns null for invalid value %p", (value) => {
    expect(parseTimestamp(value)).toBeNull();
  });

  it("formats consistently in IST and never shows Invalid Date", () => {
    expect(formatDateTime("2026-10-27T17:30")).toBe("27 Oct 2026, 5:30 pm IST");
    expect(formatDateTime("2026-10-27T12:00:00Z")).toBe("27 Oct 2026, 5:30 pm IST");
    expect(formatDateTime("garbage")).toBe("Unavailable");
    expect(formatDateTime(null, { fallback: "—" })).toBe("—");
    expect(formatChartTick("garbage")).toBe("");
  });

  it("formats relative ages", () => {
    const now = Date.parse("2026-10-27T12:10:00Z");
    expect(formatRelative("2026-10-27T12:09:30Z", now)).toBe("just now");
    expect(formatRelative("2026-10-27T12:00:00Z", now)).toBe("10 min ago");
    expect(formatRelative("2026-10-27T09:10:00Z", now)).toBe("3 h ago");
    expect(formatRelative("bad", now)).toBeNull();
  });
});
