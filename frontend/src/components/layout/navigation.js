import { Columns3, FlaskConical, LayoutDashboard, Lightbulb, LineChart, Map, Wind } from "lucide-react";

export const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "map", label: "Spatial Explorer", icon: Map },
  { id: "trends", label: "Vegetation Trends", icon: LineChart },
  { id: "air-quality", label: "Air Quality", icon: Wind },
  { id: "compare", label: "Zone Comparison", icon: Columns3 },
  { id: "scenario", label: "Scenario Lab", icon: FlaskConical },
  { id: "insights", label: "Insights & Methodology", icon: Lightbulb },
];

export const VIEW_TITLES = {
  ...Object.fromEntries(NAV_ITEMS.map((item) => [item.id, item.label])),
  report: "Printable report",
};

/** The report is reached from Insights, so Insights stays highlighted. */
export function navSection(view) {
  return view === "report" ? "insights" : view;
}
