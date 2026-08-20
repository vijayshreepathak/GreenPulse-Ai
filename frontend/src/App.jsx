import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { getDashboard, getEnvironmentCurrent, getLandsatHistory, getSpatialCells } from "./api";
import AirQualityView from "./components/air-quality/AirQualityView";
import AppShell from "./components/layout/AppShell";
import SpatialIntelligence from "./components/map/SpatialIntelligence";
import DataNotes from "./components/DataNotes";
import HeroSummary from "./components/overview/HeroSummary";
import IntelligencePipeline from "./components/overview/IntelligencePipeline";
import MetricGrid from "./components/overview/MetricGrid";
import InsightGrid from "./components/insights/InsightGrid";
import { buildInsights } from "./components/insights/insightData";
import TrendsView from "./components/trends/TrendsView";

const INITIAL_DASHBOARD = {
  summary: {},
  priority: [],
  historical_ndvi: [],
  recent_aqi: {},
  spatial_analysis: {},
  notes: [],
};

const MAP_LAYERS = new Set(["priority", "ndvi", "green_cover", "built_up", "tree_cover", "ndbi", "ndwi", "plantable", "decline"]);

function initialMapLayer() {
  const requested = new URLSearchParams(window.location.search).get("layer");
  return MAP_LAYERS.has(requested) ? requested : "priority";
}

export default function App() {
  const [dashboard, setDashboard] = useState(INITIAL_DASHBOARD);
  const [spatialCells, setSpatialCells] = useState({ count: 0, available: false, geojson: null });
  const [landsatHistory, setLandsatHistory] = useState([]);
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [selectedCellId, setSelectedCellId] = useState(null);
  const [activeLayer, setActiveLayer] = useState(initialMapLayer);
  const [airRange, setAirRange] = useState(24);
  const [loading, setLoading] = useState(true);
  const [environmentUpdating, setEnvironmentUpdating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    async function loadProductData() {
      const [dashboardResult, cellsResult, landsatResult] = await Promise.allSettled([
        getDashboard(),
        getSpatialCells(),
        getLandsatHistory(),
      ]);
      if (ignore) return;

      const messages = [];
      if (dashboardResult.status === "fulfilled") {
        setDashboard({ ...INITIAL_DASHBOARD, ...dashboardResult.value });
        const topZone = dashboardResult.value.priority?.[0]?.zone_id;
        if (topZone !== undefined && topZone !== null) setSelectedZoneId(String(topZone));
      } else {
        messages.push(`Dashboard data: ${dashboardResult.reason.message}`);
      }

      if (cellsResult.status === "fulfilled") setSpatialCells(cellsResult.value);
      else messages.push(`50 m spatial data: ${cellsResult.reason.message}`);

      if (landsatResult.status === "fulfilled") setLandsatHistory(landsatResult.value.records || []);
      else messages.push(`Landsat context: ${landsatResult.reason.message}`);

      setError(messages.join(" "));
      setLoading(false);
    }
    loadProductData();
    return () => { ignore = true; };
  }, []);

  const refreshEnvironment = useCallback(async (force = false) => {
    setEnvironmentUpdating(true);
    try {
      const payload = await getEnvironmentCurrent(force);
      setDashboard((current) => ({ ...current, recent_aqi: payload }));
    } catch (refreshError) {
      setError((current) => current || `Air-quality refresh: ${refreshError.message}`);
    } finally {
      setEnvironmentUpdating(false);
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => refreshEnvironment(false), 12 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [refreshEnvironment]);

  const priority = useMemo(
    () => [...(dashboard.priority || [])].sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0)),
    [dashboard.priority]
  );
  const cellFeatures = spatialCells?.geojson?.features || [];
  const selectedZone = useMemo(() => {
    if (!priority.length) return null;
    return priority.find((zone) => String(zone.zone_id) === String(selectedZoneId)) || priority[0];
  }, [priority, selectedZoneId]);
  const selectedCell = useMemo(
    () => cellFeatures.find((feature) => String(feature?.properties?.cell_id) === String(selectedCellId))?.properties || null,
    [cellFeatures, selectedCellId]
  );
  const insights = useMemo(() => buildInsights(priority, cellFeatures), [cellFeatures, priority]);
  const spatialAnalysis = {
    ...(dashboard.spatial_analysis || {}),
    cell_count: spatialCells.count || dashboard.spatial_analysis?.cell_count,
  };

  const selectZone = (zoneId) => {
    setSelectedZoneId(String(zoneId));
    setSelectedCellId(null);
  };

  const selectCell = (cellId, zoneId) => {
    setSelectedCellId(String(cellId));
    setSelectedZoneId(String(zoneId));
  };

  return (
    <AppShell
      loading={loading}
      updating={environmentUpdating}
      error={error}
      recentAqi={dashboard.recent_aqi}
    >
      <section id="overview" className="overview-view section-anchor" aria-labelledby="overview-title">
        <HeroSummary recentAqi={dashboard.recent_aqi} spatialAnalysis={spatialAnalysis} />
        {error && (
          <div className="data-alert" role="status">
            <AlertCircle size={17} aria-hidden="true" />
            <span>Some sources could not load. Available analysis remains interactive. {error}</span>
          </div>
        )}
        <MetricGrid
          summary={dashboard.summary}
          priority={priority}
          recentAqi={dashboard.recent_aqi}
          spatialAnalysis={spatialAnalysis}
          loading={loading}
        />
        <IntelligencePipeline />
        <InsightGrid insights={insights} compact limit={3} />
      </section>

      <SpatialIntelligence
        priority={priority}
        cellGeojson={spatialCells.geojson}
        activeLayer={activeLayer}
        onLayerChange={setActiveLayer}
        selectedZone={selectedZone}
        selectedCell={selectedCell}
        onSelectZone={selectZone}
        onSelectCell={selectCell}
        recentAqi={dashboard.recent_aqi}
      />

      <TrendsView
        zoneHistory={dashboard.historical_ndvi || []}
        landsatHistory={landsatHistory}
        cellFeatures={cellFeatures}
        selectedZoneId={selectedZone?.zone_id}
        selectedCellId={selectedCell?.cell_id}
        onSelectZone={selectZone}
        onSelectCell={selectCell}
      />

      <AirQualityView
        recentAqi={dashboard.recent_aqi || {}}
        loading={loading}
        updating={environmentUpdating}
        onRefresh={() => refreshEnvironment(true)}
        range={airRange}
        onRangeChange={setAirRange}
      />

      <section id="insights" className="product-section section-anchor" aria-label="Environmental insights">
        <InsightGrid insights={insights} title="Campus signals worth attention" />
      </section>

      <DataNotes spatialAnalysis={spatialAnalysis} />
    </AppShell>
  );
}
