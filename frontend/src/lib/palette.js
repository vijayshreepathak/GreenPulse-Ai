/**
 * Chart colours. Categorical sets were checked with the data-viz palette validator
 * (lightness band, chroma floor, CVD separation, contrast) against the app surfaces:
 * light #ffffff and dark #141f1a. The order is part of the CVD-safety guarantee.
 */
export const CHART_PALETTES = {
  light: {
    factors: ["#13955f", "#6250d6", "#e0692a", "#2a78d6", "#c4569a"],
    compare: ["#2a78d6", "#eb6834", "#1baf7a"],
    pm25: "#2a78d6",
    pm10: "#e0692a",
    primary: "#1f6b4a",
    context: "#b4bab3",
    grid: "#e6e6df",
    axis: "#cfd1c6",
    text: "#5f6b63",
    surface: "#ffffff",
  },
  dark: {
    factors: ["#199e70", "#9085e9", "#d95926", "#3987e5", "#d55181"],
    compare: ["#3987e5", "#d95926", "#199e70"],
    pm25: "#3987e5",
    pm10: "#d95926",
    primary: "#4fbf8b",
    context: "#3d4c43",
    grid: "#24312a",
    axis: "#34463c",
    text: "#97a49b",
    surface: "#141f1a",
  },
};

/** Status palette for priority classes (always paired with a text label). */
export const PRIORITY_COLORS = {
  Low: "#0ca30c",
  Moderate: "#fab219",
  High: "#ec835a",
  Urgent: "#d03b3b",
};

export const NO_DATA_COLOR = "#9aa29c";
