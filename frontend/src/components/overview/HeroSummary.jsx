import { Activity, CalendarRange, MapPin } from "lucide-react";
import Badge from "../common/Badge";

export default function HeroSummary({ recentAqi, spatialAnalysis }) {
  const live = recentAqi?.freshness === "live";
  const latestYear = spatialAnalysis?.latest_satellite_year;
  const season = spatialAnalysis?.season || "Oct-Dec";

  return (
    <header className="hero-summary">
      <div className="hero-summary__copy">
        <p className="eyebrow">Thapar campus environmental intelligence</p>
        <h1 id="overview-title">Campus environmental overview</h1>
        <p className="hero-summary__subline">
          Satellite-derived vegetation, land-cover pressure, and modeled air quality in one decision workspace.
        </p>
        <div className="hero-status-row" aria-label="Analysis status">
          <span>
            <Activity size={15} aria-hidden="true" />
            {live ? "Live modeled air quality" : "Modeled air-quality context"}
          </span>
          <span>
            <CalendarRange size={15} aria-hidden="true" />
            {season} {latestYear || "satellite season"}
          </span>
          <span>
            <MapPin size={15} aria-hidden="true" />
            Thapar campus, Patiala
          </span>
        </div>
      </div>
      <aside className="hero-brief" aria-label="Current decision signal">
        <Badge tone="forest">Decision support</Badge>
        <strong>Explainable spatial priorities</strong>
        <p>Five campus zones are ranked from satellite vegetation, land pressure, and regional PM context.</p>
      </aside>
    </header>
  );
}
