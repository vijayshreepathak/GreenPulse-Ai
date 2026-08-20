export const PRIORITY_COLORS = {
  Low: "#2d6a4f",
  Moderate: "#d5a72f",
  High: "#d97824",
  Urgent: "#b8403a",
};

const percentGreen = [
  { max: 20, label: "0-20%", color: "#a84c3d" },
  { max: 40, label: "20-40%", color: "#d88a3d" },
  { max: 60, label: "40-60%", color: "#ddc96b" },
  { max: 80, label: "60-80%", color: "#79a66c" },
  { max: Infinity, label: "80-100%", color: "#276449" },
];

const percentPressure = [
  { max: 20, label: "0-20%", color: "#2d6a4f" },
  { max: 40, label: "20-40%", color: "#75a66b" },
  { max: 60, label: "40-60%", color: "#ddc96b" },
  { max: 80, label: "60-80%", color: "#db8b3d" },
  { max: Infinity, label: "80-100%", color: "#a94339" },
];

export const LAYER_CONFIGS = {
  priority: {
    id: "priority",
    label: "Priority",
    source: "zone",
    field: "priority_class",
    description: "Explainable zone intervention score",
    legend: Object.entries(PRIORITY_COLORS).map(([label, color]) => ({ label, color })),
  },
  ndvi: {
    id: "ndvi",
    label: "NDVI",
    source: "cell",
    field: "mean_ndvi",
    decimals: 3,
    description: "Current 50 m vegetation signal",
    legend: [
      { max: 0.2, label: "≤ 0.20", color: "#a84c3d" },
      { max: 0.3, label: "0.20-0.30", color: "#d88a3d" },
      { max: 0.4, label: "0.30-0.40", color: "#ddc96b" },
      { max: 0.5, label: "0.40-0.50", color: "#79a66c" },
      { max: Infinity, label: "> 0.50", color: "#276449" },
    ],
  },
  green_cover: { id: "green_cover", label: "Green cover", source: "cell", field: "green_cover_percent", unit: "%", decimals: 1, description: "Cell-level green-cover share", legend: percentGreen },
  built_up: { id: "built_up", label: "Built-up pressure", source: "cell", field: "built_up_percent", unit: "%", decimals: 1, description: "Dynamic World built-up indicator", legend: percentPressure },
  tree_cover: { id: "tree_cover", label: "Tree cover", source: "cell", field: "tree_percent", unit: "%", decimals: 1, description: "Cell-level tree-cover share", legend: percentGreen },
  ndbi: {
    id: "ndbi",
    label: "NDBI",
    source: "cell",
    field: "mean_ndbi",
    decimals: 3,
    description: "Normalized built-up index",
    legend: [
      { max: -0.15, label: "≤ -0.15", color: "#276449" },
      { max: -0.05, label: "-0.15 to -0.05", color: "#79a66c" },
      { max: 0.05, label: "-0.05 to 0.05", color: "#ddc96b" },
      { max: 0.1, label: "0.05-0.10", color: "#d88a3d" },
      { max: Infinity, label: "> 0.10", color: "#a84c3d" },
    ],
  },
  ndwi: {
    id: "ndwi",
    label: "NDWI",
    source: "cell",
    field: "mean_ndwi",
    decimals: 3,
    description: "Normalized water/moisture index",
    legend: [
      { max: -0.5, label: "≤ -0.50", color: "#9a5940" },
      { max: -0.4, label: "-0.50 to -0.40", color: "#c68a4c" },
      { max: -0.3, label: "-0.40 to -0.30", color: "#a9b96f" },
      { max: -0.2, label: "-0.30 to -0.20", color: "#4e9489" },
      { max: Infinity, label: "> -0.20", color: "#326c8d" },
    ],
  },
  plantable: { id: "plantable", label: "Plantable potential", source: "cell", field: "potential_plantable_percent", unit: "%", decimals: 1, description: "Candidate land-cover indicator", legend: percentGreen },
  decline: {
    id: "decline",
    label: "Historical decline",
    source: "cell",
    field: "ndvi_change",
    decimals: 3,
    description: "Sentinel-2 NDVI change, 2018-2025",
    legend: [
      { max: -0.1, label: "≤ -0.10", color: "#a94339" },
      { max: -0.05, label: "-0.10 to -0.05", color: "#db8b3d" },
      { max: 0, label: "-0.05 to 0", color: "#ddc96b" },
      { max: 0.05, label: "0 to 0.05", color: "#79a66c" },
      { max: Infinity, label: "> 0.05", color: "#276449" },
    ],
  },
};

export function layerColor(config, value) {
  if (!config) return "#8b948d";
  if (config.id === "priority") return PRIORITY_COLORS[value] || "#8b948d";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "#8b948d";
  return config.legend.find((item) => numeric <= item.max)?.color || "#8b948d";
}

export function formatLayerValue(config, value) {
  if (config?.id === "priority") return value || "Not ranked";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  return `${numeric.toFixed(config?.decimals ?? 1)}${config?.unit || ""}`;
}
