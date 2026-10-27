import { describe, expect, it } from "vitest";
import { featureId, isValidPolygonGeometry, validFeatureCollection } from "./geo";

const ring = [[76.36, 30.35], [76.37, 30.35], [76.37, 30.36], [76.36, 30.35]];

describe("GeoJSON validation", () => {
  it("accepts polygons and multipolygons with finite coordinates", () => {
    expect(isValidPolygonGeometry({ type: "Polygon", coordinates: [ring] })).toBe(true);
    expect(isValidPolygonGeometry({ type: "MultiPolygon", coordinates: [[ring], [ring]] })).toBe(true);
  });

  it.each([
    null,
    "not geometry",
    { type: "Point", coordinates: [76.36, 30.35] },
    { type: "Polygon", coordinates: [] },
    { type: "Polygon", coordinates: [[[76.36, 30.35], [76.37, 30.35]]] },
    { type: "Polygon", coordinates: [[[76.36, Number.NaN], [76.37, 30.35], [76.37, 30.36], [76.36, 30.35]]] },
    { type: "Polygon", coordinates: [[["76.36", 30.35], [76.37, 30.35], [76.37, 30.36], [76.36, 30.35]]] },
    { type: "MultiPolygon", coordinates: [[]] },
    { type: "Polygon", coordinates: [[[76.36, 95], [76.37, 95], [76.37, 95.1], [76.36, 95]]] }, // latitude out of range
    { type: "Polygon", coordinates: [[[276.36, 30.35], [276.37, 30.35], [276.37, 30.36], [276.36, 30.35]]] }, // longitude out of range
  ])("rejects malformed geometry %#", (geometry) => {
    expect(isValidPolygonGeometry(geometry)).toBe(false);
  });

  it("drops invalid features instead of crashing the map", () => {
    const collection = validFeatureCollection({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { zone_id: "Z01" }, geometry: { type: "Polygon", coordinates: [ring] } },
        { type: "Feature", properties: { zone_id: "Z02" }, geometry: null },
        null,
      ],
    });
    expect(collection.features.map(featureId)).toEqual(["Z01"]);
    expect(validFeatureCollection(null).features).toEqual([]);
  });

  it("prefers cell IDs over zone IDs for feature identity", () => {
    expect(featureId({ properties: { cell_id: "C_1", zone_id: "Z01" } })).toBe("C_1");
    expect(featureId({ id: 7, properties: {} })).toBe("7");
    expect(featureId(null)).toBe("");
  });
});
