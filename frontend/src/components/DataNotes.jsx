import { Braces, Grid3X3, Info, Radio, Satellite } from "lucide-react";
import SectionHeader from "./common/SectionHeader";

const sources = [
  {
    title: "Satellite data",
    icon: Satellite,
    items: ["Sentinel-2 primary vegetation analysis", "Dynamic World supporting land cover", "Landsat long-term context"],
  },
  {
    title: "Spatial analysis",
    icon: Grid3X3,
    items: ["Mapped campus boundary", "Five human-readable zones", "50 m cell-level feature grid"],
  },
  {
    title: "Air quality",
    icon: Radio,
    items: ["Open-Meteo Air Quality API", "CAMS modeled regional context", "10-minute last-good response cache"],
  },
  {
    title: "Priority logic",
    icon: Braces,
    items: ["Transparent weighted score", "Five documented contributors", "Readable rule-based reasons"],
  },
];

const limitations = [
  "NDVI thresholds are calibrated for this project and are not universal ecological classifications.",
  "Dynamic World supports land-cover interpretation; it is not building-level ground truth.",
  "Modeled PM values describe regional context near one campus coordinate, not local zone measurements.",
  "Sentinel-2 and Landsat differ in spatial characteristics and remain separate analysis series.",
  "Current priority intelligence is explainable and rule-based; future ML is not represented as implemented.",
];

export default function DataNotes({ spatialAnalysis }) {
  const cellCount = spatialAnalysis?.cell_count;
  return (
    <section id="data-methodology" className="product-section methodology-section section-anchor" aria-labelledby="methodology-title">
      <SectionHeader
        id="methodology-title"
        eyebrow="Data & methodology"
        title="Built for transparent interpretation"
        description="Every visible signal retains its source, spatial scale, and scientific limitation."
      />

      <div className="source-card-grid">
        {sources.map((source) => {
          const Icon = source.icon;
          return (
            <article className="source-card" key={source.title}>
              <div className="source-card__icon"><Icon size={19} aria-hidden="true" /></div>
              <h3>{source.title}</h3>
              <ul>
                {source.items.map((item) => (
                  <li key={item}>{item === "50 m cell-level feature grid" && cellCount ? `${cellCount} usable 50 m cells` : item}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <div className="limitations-block">
        <div className="limitations-block__intro">
          <Info size={19} aria-hidden="true" />
          <div><p className="eyebrow">Interpretation boundaries</p><h3>What the evidence does and does not claim</h3></div>
        </div>
        <ul>
          {limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>
      </div>

      <footer className="methodology-footer">
        <strong>Decision support scope</strong>
        <span>Satellite and GIS decision support for Thapar campus</span>
        <span>Local sensing, field validation, and ML remain future validation layers.</span>
      </footer>
    </section>
  );
}
