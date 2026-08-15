import { useEffect, useMemo, useState } from "react";
import { getDashboard } from "./api";
import SummaryCards from "./components/SummaryCards";
import PriorityTable from "./components/PriorityTable";
import NDVITrendChart from "./components/NDVITrendChart";
import AQIChart from "./components/AQIChart";
import CampusMap from "./components/CampusMap";
import ZoneDetails from "./components/ZoneDetails";
import DataNotes from "./components/DataNotes";

export default function App() {
  const [dashboard, setDashboard] = useState({
    summary: {},
    priority: [],
    historical_ndvi: [],
    recent_aqi: {},
    notes: [],
  });
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    getDashboard()
      .then((payload) => {
        if (ignore) return;
        setDashboard(payload);
        const topZone = payload.priority?.[0]?.zone_id;
        if (topZone !== undefined && topZone !== null) {
          setSelectedZoneId(String(topZone));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const priority = useMemo(
    () => [...(dashboard.priority || [])].sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0)),
    [dashboard.priority]
  );

  const selectedZone = useMemo(() => {
    if (!priority.length) return null;
    return priority.find((zone) => String(zone.zone_id) === String(selectedZoneId)) || priority[0];
  }, [priority, selectedZoneId]);

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Thapar campus environmental intelligence</p>
          <h1>GreenPulse AI</h1>
          <p className="subtitle">
            A live environmental intelligence dashboard for vegetation health, land-cover pressure, modeled PM stress,
            and explainable campus zone priorities.
          </p>
        </div>
        <div className="status-pill">{loading ? "Loading" : "Campus insights live"}</div>
      </header>

      {error && <section className="alert">Backend error: {error}</section>}

      <SummaryCards summary={dashboard.summary} priority={priority} recentAqi={dashboard.recent_aqi} />

      <section className="dashboard-grid">
        <div className="panel wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Priority ranking</p>
              <h2>Zone environmental priority</h2>
            </div>
          </div>
          <PriorityTable records={priority} selectedZoneId={selectedZone?.zone_id} onSelectZone={setSelectedZoneId} />
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Campus map</p>
              <h2>Zone layer</h2>
            </div>
          </div>
          <CampusMap records={priority} selectedZoneId={selectedZone?.zone_id} onSelectZone={setSelectedZoneId} />
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Selected zone</p>
              <h2>Details</h2>
            </div>
          </div>
          <ZoneDetails zone={selectedZone} />
        </div>

        <div className="panel wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Sentinel-2</p>
              <h2>Historical NDVI trend</h2>
            </div>
          </div>
          <NDVITrendChart records={dashboard.historical_ndvi || []} selectedZone={selectedZone} />
        </div>

        <div className="panel wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Open-Meteo</p>
              <h2>Recent PM2.5 / PM10</h2>
            </div>
          </div>
          <AQIChart recentAqi={dashboard.recent_aqi || {}} />
        </div>
      </section>

      <DataNotes notes={dashboard.notes || []} />
    </main>
  );
}
