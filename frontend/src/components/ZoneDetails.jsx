import { Activity, Building2, CircleHelp, Leaf, Radio, Satellite } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import Badge from "./common/Badge";

const number = (value, digits = 1) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : "N/A";
};

function explain(area, aqiStress) {
  const drivers = [];
  if (Number(area?.ndvi_change) < -0.05) drivers.push("Persistent vegetation decline");
  if (Number(area?.built_up_percent) > 70) drivers.push("High built-up pressure");
  if (Number(area?.tree_percent) < 10) drivers.push("Low tree cover");
  if (Number(area?.green_cover_percent) < 60) drivers.push("Limited green-cover share");
  if (Number(aqiStress) > 60) drivers.push("Elevated regional PM stress");
  return drivers.length ? drivers : ["Vegetation remains comparatively stable across the available indicators"];
}

function Indicator({ label, value, decimals = 1, suffix = "%" }) {
  const numeric = Number(value);
  const width = Number.isFinite(numeric) ? Math.max(0, Math.min(numeric, 100)) : 0;
  return (
    <div className="detail-indicator">
      <span><span>{label}</span><strong>{number(value, decimals)}{Number.isFinite(numeric) ? suffix : ""}</strong></span>
      <i aria-hidden="true"><b style={{ width: `${width}%` }} /></i>
    </div>
  );
}

function PlainMetric({ label, value }) {
  return <div className="detail-metric"><span>{label}</span><strong>{value}</strong></div>;
}

export default function ZoneDetails({ zone, cell, recentAqi }) {
  const reduceMotion = useReducedMotion();
  if (!zone && !cell) {
    return <div className="empty-state empty-state--compact">Select a zone or 50 m cell to inspect its environmental context.</div>;
  }

  const isCell = Boolean(cell);
  const area = cell || zone;
  const priority = zone || {};
  const aqiStress = priority.aqi_stress_score ?? recentAqi?.stress_score;
  const drivers = explain(area, aqiStress);
  const title = isCell ? area.cell_id : area.zone_name || area.zone_id;
  const subtitle = isCell ? `${area.zone_name} · 50 m analysis cell` : "Zone-level intervention context";
  const priorityTone = String(priority.priority_class || "neutral").toLowerCase();

  return (
    <motion.div
      className="selected-area-panel"
      key={title}
      initial={reduceMotion ? false : { opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      <header className="selected-area-panel__header">
        <div>
          <p className="eyebrow">{isCell ? "Selected cell" : "Selected zone"}</p>
          <h3>{title}</h3>
          <span>{subtitle}</span>
        </div>
        <div className="selected-area-score">
          <Badge tone={priorityTone}>{priority.priority_class || "Zone context"}</Badge>
          <strong>{number(priority.priority_score)}</strong>
          <small>{isCell ? "Zone priority score" : "Priority score"}</small>
        </div>
      </header>

      <section className="detail-section">
        <h4><CircleHelp size={16} />Why this area?</h4>
        <ul className="driver-list">
          {drivers.map((driver) => <li key={driver}>{driver}</li>)}
        </ul>
      </section>

      <section className="detail-section">
        <h4><Leaf size={16} />Vegetation</h4>
        <div className="detail-grid">
          <PlainMetric label="Mean NDVI" value={number(area.mean_ndvi, 3)} />
          <PlainMetric label="NDVI change" value={`${Number(area.ndvi_change) > 0 ? "+" : ""}${number(area.ndvi_change, 3)}`} />
        </div>
        <Indicator label="Green cover" value={area.green_cover_percent} />
        <Indicator label="Tree cover" value={area.tree_percent} />
      </section>

      <section className="detail-section">
        <h4><Building2 size={16} />Land pressure</h4>
        <Indicator label="Built-up" value={area.built_up_percent} />
        <Indicator label="Bare land" value={area.bare_land_percent} />
        <Indicator label="Plantable potential" value={area.potential_plantable_percent} />
      </section>

      {isCell && (
        <section className="detail-section">
          <h4><Satellite size={16} />Satellite indices</h4>
          <div className="detail-grid">
            <PlainMetric label="Mean NDBI" value={number(area.mean_ndbi, 3)} />
            <PlainMetric label="Mean NDWI" value={number(area.mean_ndwi, 3)} />
          </div>
        </section>
      )}

      <section className="detail-section detail-section--context">
        <h4><Radio size={16} />Environmental context</h4>
        <div className="detail-grid">
          <PlainMetric label="PM stress" value={number(aqiStress)} />
          <PlainMetric label="Vegetation source" value="Sentinel-2" />
        </div>
        <p><Activity size={14} /> PM values are regional modeled context and are not assigned independently to this area.</p>
      </section>
    </motion.div>
  );
}
