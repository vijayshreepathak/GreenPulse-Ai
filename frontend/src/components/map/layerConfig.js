import { NO_DATA_COLOR, PRIORITY_COLORS } from "../../lib/palette";
import { formatNumber, toNumber } from "../../lib/numbers";

// Single-hue sequential ramps (ColorBrewer Greens / Oranges / Blues) and a diverging
// brown-teal ramp (BrBG) with a neutral midpoint for signed NDVI change.
const GREENS = ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"];
const ORANGES = ["#feedde", "#fdbe85", "#fd8d3c", "#e6550d", "#a63603"];
const BLUES = ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"];
const DIVERGING = ["#a6611a", "#dfc27d", "#d9d9d4", "#80cdc1", "#018571"];

const bins = (ramp, edges, labels) => ramp.map((color, index) => ({ max: edges[index], label: labels[index], color }));

const percentBins = (ramp) => bins(ramp, [20, 40, 60, 80, Infinity], ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"]);
const sparsePercentBins = (ramp) => bins(ramp, [0, 25, 50, 75, Infinity], ["0%", "0–25%", "25–50%", "50–75%", "75–100%"]);

export const LAYER_GROUPS = [
  { id: "score", label: "Zone score" },
  { id: "vegetation", label: "Vegetation" },
  { id: "pressure", label: "Land pressure" },
  { id: "water", label: "Moisture" },
];

export const LAYER_CONFIGS = {
  priority: {
    id: "priority",
    label: "Priority",
    group: "score",
    source: "zone",
    field: "priority_class",
    description: "Official zone-level priority class (rule-based score).",
    sourceLabel: "Official rule-based score",
    legend: Object.entries(PRIORITY_COLORS).map(([label, color]) => ({ label, color })),
  },
  ndvi: {
    id: "ndvi",
    label: "NDVI",
    group: "vegetation",
    source: "cell",
    field: "mean_ndvi",
    decimals: 3,
    description: "Mean NDVI per 50 m cell. Higher values indicate denser green vegetation.",
    sourceLabel: "Sentinel-2 · current composite",
    legend: bins(GREENS, [0.2, 0.3, 0.4, 0.5, Infinity], ["≤ 0.20", "0.20–0.30", "0.30–0.40", "0.40–0.50", "> 0.50"]),
  },
  green_cover: {
    id: "green_cover",
    label: "Green cover",
    group: "vegetation",
    source: "cell",
    field: "green_cover_percent",
    unit: "%",
    decimals: 1,
    description: "Share of the cell above the project-calibrated NDVI green threshold.",
    sourceLabel: "Sentinel-2 · current composite",
    legend: percentBins(GREENS),
  },
  tree_cover: {
    id: "tree_cover",
    label: "Tree cover",
    group: "vegetation",
    source: "cell",
    field: "tree_percent",
    unit: "%",
    decimals: 1,
    description: "Dynamic World tree class share (supporting ~10 m indicator).",
    sourceLabel: "Dynamic World",
    legend: sparsePercentBins(GREENS),
  },
  decline: {
    id: "decline",
    label: "NDVI change",
    group: "vegetation",
    source: "cell",
    field: "ndvi_change",
    decimals: 3,
    signed: true,
    description: "Latest minus baseline Sentinel-2 seasonal NDVI. Brown = decline, teal = gain.",
    sourceLabel: "Sentinel-2 · seasonal composites",
    legend: bins(DIVERGING, [-0.1, -0.02, 0.02, 0.1, Infinity], ["≤ −0.10", "−0.10 to −0.02", "−0.02 to +0.02", "+0.02 to +0.10", "> +0.10"]),
  },
  built_up: {
    id: "built_up",
    label: "Built-up",
    group: "pressure",
    source: "cell",
    field: "built_up_percent",
    unit: "%",
    decimals: 1,
    description: "Dynamic World built-up class share (supporting indicator, not building footprints).",
    sourceLabel: "Dynamic World",
    legend: percentBins(ORANGES),
  },
  ndbi: {
    id: "ndbi",
    label: "NDBI",
    group: "pressure",
    source: "cell",
    field: "mean_ndbi",
    decimals: 3,
    signed: true,
    description: "Normalized difference built-up index. Higher values suggest more built surfaces.",
    sourceLabel: "Sentinel-2 · current composite",
    legend: bins(ORANGES, [-0.15, -0.05, 0.05, 0.1, Infinity], ["≤ −0.15", "−0.15 to −0.05", "−0.05 to 0.05", "0.05–0.10", "> 0.10"]),
  },
  plantable: {
    id: "plantable",
    label: "Plantable potential",
    group: "pressure",
    source: "cell",
    field: "potential_plantable_percent",
    unit: "%",
    decimals: 1,
    description: "Mapped potential-plantable land-cover share. Not a validated planting site; needs ground review.",
    sourceLabel: "Dynamic World-derived",
    legend: sparsePercentBins(GREENS),
  },
  ndwi: {
    id: "ndwi",
    label: "NDWI",
    group: "water",
    source: "cell",
    field: "mean_ndwi",
    decimals: 3,
    signed: true,
    description: "Normalized difference water index. Higher values indicate more surface moisture.",
    sourceLabel: "Sentinel-2 · current composite",
    legend: bins(BLUES, [-0.5, -0.4, -0.3, -0.2, Infinity], ["≤ −0.50", "−0.50 to −0.40", "−0.40 to −0.30", "−0.30 to −0.20", "> −0.20"]),
  },
};

export const LAYER_IDS = Object.keys(LAYER_CONFIGS);
export const NO_DATA_LEGEND = { label: "No data", color: NO_DATA_COLOR };

export function layerColor(config, value) {
  if (!config) return NO_DATA_COLOR;
  if (config.id === "priority") return PRIORITY_COLORS[value] || NO_DATA_COLOR;
  const numeric = toNumber(value);
  if (numeric === null) return NO_DATA_COLOR;
  return config.legend.find((item) => numeric <= item.max)?.color || NO_DATA_COLOR;
}

export function formatLayerValue(config, value) {
  if (config?.id === "priority") return value || "Not ranked";
  return formatNumber(value, config?.decimals ?? 1, { suffix: config?.unit || "", signed: Boolean(config?.signed) });
}
