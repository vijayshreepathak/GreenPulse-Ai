/** Score factors in the order of the official formula (also the stacking/colour order). */
export const FACTORS = [
  {
    key: "low_green_cover",
    label: "Low green cover",
    short: "Green gap",
    scoreField: "low_green_cover_score",
    contributionField: "contribution_low_green_cover",
    inputField: "green_cover_percent",
    inputLabel: "Green cover",
    inputUnit: "%",
    formula: "100 − green cover %",
    source: "Sentinel-2 current composite",
  },
  {
    key: "ndvi_decline",
    label: "NDVI decline",
    short: "NDVI decline",
    scoreField: "ndvi_decline_score",
    contributionField: "contribution_ndvi_decline",
    inputField: "ndvi_change",
    inputLabel: "NDVI change",
    inputUnit: "",
    inputDecimals: 3,
    signed: true,
    formula: "0 if NDVI did not fall, else min(|ΔNDVI| ÷ 0.10 × 100, 100)",
    source: "Sentinel-2 seasonal composites",
  },
  {
    key: "built_up_pressure",
    label: "Built-up pressure",
    short: "Built-up",
    scoreField: "built_up_pressure_score",
    contributionField: "contribution_built_up_pressure",
    inputField: "built_up_percent",
    inputLabel: "Built-up",
    inputUnit: "%",
    formula: "built-up %",
    source: "Dynamic World land cover",
  },
  {
    key: "tree_gap",
    label: "Tree gap",
    short: "Tree gap",
    scoreField: "tree_gap_score",
    contributionField: "contribution_tree_gap",
    inputField: "tree_percent",
    inputLabel: "Tree cover",
    inputUnit: "%",
    formula: "100 − tree cover %",
    source: "Dynamic World land cover",
  },
  {
    key: "pm_stress",
    label: "Regional PM stress",
    short: "PM stress",
    scoreField: "pm_stress_score",
    contributionField: "contribution_pm_stress",
    inputField: "pm_stress_score",
    inputLabel: "PM stress",
    inputUnit: "",
    formula: "0.6 × PM2.5 score + 0.4 × PM10 score",
    source: "Open-Meteo / CAMS modelled, regional",
  },
];

/** Used only if the API omits scoring metadata; the backend is the source of truth. */
export const FALLBACK_WEIGHTS = {
  low_green_cover: 0.35,
  ndvi_decline: 0.25,
  built_up_pressure: 0.2,
  tree_gap: 0.1,
  pm_stress: 0.1,
};

export const PRIORITY_CLASSES = ["Low", "Moderate", "High", "Urgent"];

export const AIR_QUALITY_LABEL = "Modelled air-quality estimates near TIET campus, not readings from campus sensors.";

export const CAMPUS = {
  name: "Thapar Institute of Engineering and Technology",
  shortName: "TIET campus",
  city: "Patiala, Punjab, India",
  latitude: 30.356,
  longitude: 76.367,
};

export function officialWeights(scoring) {
  const weights = scoring?.weights;
  if (!weights || FACTORS.some((factor) => typeof weights[factor.key] !== "number")) return FALLBACK_WEIGHTS;
  return weights;
}

export function priorityTone(priorityClass) {
  const normalized = String(priorityClass || "").toLowerCase();
  return ["low", "moderate", "high", "urgent"].includes(normalized) ? normalized : "neutral";
}
