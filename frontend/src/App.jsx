import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Copilot from "./components/copilot/Copilot";
import AppShell from "./components/layout/AppShell";
import { ErrorBoundary, Skeleton } from "./components/common/Primitives";
import { LAYER_CONFIGS } from "./components/map/layerConfig";
import OverviewView from "./components/overview/OverviewView";
import SettingsDialog from "./components/settings/SettingsDialog";
import ProductTour from "./components/tour/ProductTour";
import { CopilotProvider } from "./context/CopilotContext";
import { usePreferences } from "./context/PreferencesContext";
import { useDashboardData } from "./hooks/useDashboardData";
import { useHashRoute } from "./hooks/useHashRoute";
import { useNow, useOnlineStatus } from "./hooks/useUtilities";
import { officialWeights } from "./lib/constants";
import { downloadPriorityCsv, downloadSnapshot } from "./lib/exports";
import { describeAirQuality } from "./lib/freshness";
import { buildInsights } from "./lib/insights";
import { weightsToPercent } from "./lib/scenario";

const SpatialExplorer = lazy(() => import("./components/map/SpatialExplorer"));
const TrendsView = lazy(() => import("./components/trends/TrendsView"));
const AirQualityView = lazy(() => import("./components/air-quality/AirQualityView"));
const ComparisonView = lazy(() => import("./components/comparison/ComparisonView"));
const ScenarioLab = lazy(() => import("./components/scenario/ScenarioLab"));
const InsightsView = lazy(() => import("./components/insights/InsightsView"));
const ReportView = lazy(() => import("./components/report/ReportView"));

function ViewFallback() {
  return (
    <div className="view">
      <Skeleton className="skeleton--title" label="Loading view" />
      <Skeleton className="skeleton--chart" />
    </div>
  );
}

export default function App() {
  const route = useHashRoute();
  const { view, params, navigate, replaceParams } = route;
  const { preferences, tourCompleted, markTourCompleted } = usePreferences();
  const { state, refresh, reload } = useDashboardData({ backgroundRefresh: preferences.backgroundRefresh });
  const online = useOnlineStatus();
  const now = useNow(30000);

  const [selection, setSelection] = useState(() => ({ zoneId: params.zone || null, cellId: params.cell || null, origin: "url", nonce: 0 }));
  const [activeLayer, setActiveLayer] = useState(() => (LAYER_CONFIGS[params.layer] ? params.layer : "priority"));
  const [opacity, setOpacity] = useState(0.75);
  const [compareSelection, setCompareIds] = useState(null);
  const [scenarioWeights, setScenarioWeights] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tourStep, setTourStep] = useState(null);
  const [seenRevision, setSeenRevision] = useState(route.revision);

  // A hash navigation (shared link pasted into this tab, back/forward) carries its own selection:
  // adopt it during render so the URL and the map never disagree.
  if (route.revision !== seenRevision) {
    setSeenRevision(route.revision);
    if (params.zone || params.cell) {
      const zoneId = params.zone ? String(params.zone) : null;
      const cellId = params.cell ? String(params.cell) : null;
      if (zoneId !== selection.zoneId || cellId !== selection.cellId) {
        setSelection((current) => ({ zoneId: zoneId ?? current.zoneId, cellId, origin: "url", nonce: current.nonce + 1 }));
      }
    }
    if (LAYER_CONFIGS[params.layer] && params.layer !== activeLayer) setActiveLayer(params.layer);
  }

  const { dashboard, live, cells, landsat, zones } = state;
  const priority = live.priority;
  const environment = live.environment;
  const loading = dashboard.status === "loading";
  const cellFeatures = useMemo(() => cells.data?.geojson?.features || [], [cells.data]);
  const priorityByZone = useMemo(() => new Map(priority.map((zone) => [String(zone.zone_id), zone])), [priority]);
  const insights = useMemo(() => buildInsights(priority, cellFeatures), [priority, cellFeatures]);
  const freshness = useMemo(() => describeAirQuality(environment, { refreshError: live.error, now }), [environment, live.error, now]);
  const official = officialWeights(dashboard.scoring);
  const weights = scenarioWeights ?? weightsToPercent(official);

  const selectedZone = priorityByZone.get(String(selection.zoneId)) || priority.find((zone) => zone.rank === 1) || priority[0] || null;
  const selectedCell = useMemo(
    () => (selection.cellId ? cellFeatures.find((feature) => String(feature.properties?.cell_id) === String(selection.cellId))?.properties || null : null),
    [cellFeatures, selection.cellId]
  );

  // Until the user picks zones, compare the two highest-ranked zones.
  // Ignore IDs that are no longer in the ranking (e.g. after a data reload).
  const compareIds = (compareSelection ?? priority.slice(0, 2).map((zone) => String(zone.zone_id))).filter((id) => priorityByZone.has(id));

  // Keep shareable map deep links in sync without adding history entries.
  useEffect(() => {
    if (view !== "map") return;
    replaceParams({ layer: activeLayer, zone: selectedZone?.zone_id, cell: selectedCell?.cell_id });
  }, [view, activeLayer, selectedZone?.zone_id, selectedCell?.cell_id, replaceParams]);

  // Move focus to the new view's heading for keyboard and screen-reader users.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    const timer = window.setTimeout(() => document.querySelector("main h1")?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(timer);
  }, [view]);

  const selectZone = useCallback((zoneId, origin = "external") => {
    setSelection((current) => ({ zoneId: String(zoneId), cellId: null, origin, nonce: current.nonce + 1 }));
  }, []);

  const selectCell = useCallback((cellId, zoneId, origin = "external") => {
    setSelection((current) => ({ zoneId: zoneId ? String(zoneId) : current.zoneId, cellId: String(cellId), origin, nonce: current.nonce + 1 }));
  }, []);

  const openZone = useCallback(
    (zoneId, cellId) => {
      if (cellId) {
        selectCell(cellId, zoneId, "external");
        if (LAYER_CONFIGS[activeLayer]?.source !== "cell") setActiveLayer("plantable");
      } else {
        selectZone(zoneId, "external");
        if (LAYER_CONFIGS[activeLayer]?.source !== "zone") setActiveLayer("priority");
      }
      navigate("map");
    },
    [activeLayer, navigate, selectCell, selectZone]
  );

  const changeLayer = useCallback(
    (layerId) => {
      setActiveLayer(layerId);
      if (LAYER_CONFIGS[layerId]?.source === "zone" && selection.cellId) {
        setSelection((current) => ({ ...current, cellId: null, origin: "panel" }));
      }
    },
    [selection.cellId]
  );

  // A new object only when the selection itself changes, so the map re-centres at most once per selection.
  const focusRequest = useMemo(
    () => ({ zoneId: selection.zoneId, cellId: selection.cellId, origin: selection.origin, nonce: selection.nonce }),
    [selection]
  );

  const exportContext = {
    summary: dashboard.summary,
    priority,
    environment,
    scoring: dashboard.scoring,
    datasets: dashboard.datasets,
    spatial: dashboard.spatial,
    landsatMeta: landsat.metadata,
    notes: dashboard.notes,
    dataIssues: dashboard.dataIssues,
  };
  const exportActions = [
    { id: "ranking", label: "Priority ranking", description: "CSV with scores, components and sources", disabled: !priority.length, onSelect: () => downloadPriorityCsv(exportContext) },
    { id: "snapshot", label: "Analysis snapshot", description: "JSON of the current loaded analysis", disabled: loading, onSelect: () => downloadSnapshot(exportContext) },
    { id: "report", label: "Printable report", description: "Print-friendly summary page", disabled: !priority.length, onSelect: () => navigate("report") },
  ];

  const assistantContext = useMemo(
    () => ({ priority, scoring: dashboard.scoring, environment, cells: cellFeatures }),
    [priority, dashboard.scoring, environment, cellFeatures]
  );

  // What the AI Copilot may describe as the user's current view. IDs only; the backend validates
  // them and recomputes every number itself.
  const zoneNames = useMemo(() => new Map(priority.map((zone) => [String(zone.zone_id), zone.zone_name || String(zone.zone_id)])), [priority]);
  const copilotAppContext = {
    view,
    activeLayer,
    displayedZoneId: selectedZone?.zone_id ?? null,
    selectedZoneId: selection.zoneId && priorityByZone.has(String(selection.zoneId)) ? String(selection.zoneId) : null,
    selectedCellId: selectedCell?.cell_id ?? null,
    compareIds,
    scenarioWeights,
    officialWeights: official,
  };

  const startTour = () => {
    setSelection((current) => ({ ...current, cellId: null, origin: "panel" }));
    if (LAYER_CONFIGS[activeLayer]?.source !== "zone") setActiveLayer("priority");
    setTourStep(0);
  };
  const closeTour = useCallback(() => {
    setTourStep(null);
    markTourCompleted(true);
  }, [markTourCompleted]);

  // Announced politely to screen readers; empty until the user (or the scheduler) refreshes.
  const announcement = live.refreshing
    ? "Updating modelled air quality and the official ranking."
    : live.error
      ? `Refresh failed. ${live.error} Previously loaded values remain visible.`
      : live.lastAttemptAt && live.lastSuccessAt >= live.lastAttemptAt
        ? `Air quality and ranking updated. PM data: ${freshness.label}.`
        : "";

  const sentinel = dashboard.datasets?.sentinel2_zone_history;
  const satelliteLabel = sentinel?.latest_year
    ? `Sentinel-2 ${sentinel.season || ""} ${sentinel.latest_year} · ${dashboard.spatial?.cell_count ?? "—"} cells`
    : loading ? "Loading datasets…" : "Satellite data unavailable";

  let content;
  switch (view) {
    case "map":
      content = (
        <SpatialExplorer
          priority={priority}
          priorityByZone={priorityByZone}
          zones={zones}
          cells={cells}
          activeLayer={activeLayer}
          onLayerChange={changeLayer}
          opacity={opacity}
          onOpacityChange={setOpacity}
          selectedZone={selectedZone}
          selectedCell={selectedCell}
          focusRequest={focusRequest}
          onSelectZone={selectZone}
          onSelectCell={selectCell}
          onViewCellHistory={() => navigate("trends", { unit: "cell" })}
          scoring={dashboard.scoring}
          freshnessLabel={freshness.label}
          onExportRanking={() => downloadPriorityCsv(exportContext)}
        />
      );
      break;
    case "trends":
      content = (
        <TrendsView
          zoneHistory={dashboard.historical}
          landsat={landsat}
          cells={cells}
          priority={priority}
          selectedZoneId={selectedZone?.zone_id}
          selectedCellId={selectedCell?.cell_id}
          initialUnit={params.unit}
          onSelectZone={selectZone}
          onSelectCell={selectCell}
        />
      );
      break;
    case "air-quality":
      content = (
        <AirQualityView
          environment={environment}
          freshness={freshness}
          loading={loading}
          refreshing={live.refreshing}
          refreshError={live.error}
          online={online}
          onRefresh={() => refresh(true)}
          scoring={dashboard.scoring}
        />
      );
      break;
    case "compare":
      content = <ComparisonView priority={priority} compareIds={compareIds} onCompareChange={setCompareIds} zoneHistory={dashboard.historical} onFocusZone={openZone} />;
      break;
    case "scenario":
      content = <ScenarioLab priority={priority} scoring={dashboard.scoring} weights={weights} onWeightsChange={setScenarioWeights} />;
      break;
    case "insights":
      content = (
        <InsightsView
          insights={insights}
          assistantContext={assistantContext}
          scoring={dashboard.scoring}
          datasets={dashboard.datasets}
          landsatMeta={landsat.metadata}
          spatial={dashboard.spatial}
          notes={dashboard.notes}
          dataIssues={dashboard.dataIssues}
          loading={loading}
          onOpenZone={openZone}
          onExportRanking={() => downloadPriorityCsv(exportContext)}
          onExportSnapshot={() => downloadSnapshot(exportContext)}
          onNavigate={navigate}
        />
      );
      break;
    case "report":
      content = (
        <ReportView
          summary={dashboard.summary}
          priority={priority}
          environment={environment}
          freshness={freshness}
          scoring={dashboard.scoring}
          datasets={dashboard.datasets}
          spatial={dashboard.spatial}
          zoneHistory={dashboard.historical}
          onBack={() => navigate("insights")}
        />
      );
      break;
    default:
      content = (
        <OverviewView
          summary={dashboard.summary}
          priority={priority}
          spatial={dashboard.spatial}
          datasets={dashboard.datasets}
          landsatMeta={landsat.metadata}
          environment={environment}
          freshness={freshness}
          insights={insights}
          loading={loading}
          dashboardError={dashboard.error}
          refreshing={live.refreshing}
          onRefresh={() => refresh(true)}
          onRetry={reload}
          onNavigate={navigate}
          onOpenZone={openZone}
          onStartTour={startTour}
          tourCompleted={tourCompleted}
        />
      );
  }

  return (
    <CopilotProvider appContext={copilotAppContext} zoneNames={zoneNames}>
      <AppShell
        view={view}
        freshness={freshness}
        refreshing={live.refreshing}
        online={online}
        onOpenSettings={() => setSettingsOpen(true)}
        onStartTour={startTour}
        exportActions={exportActions}
        satelliteLabel={satelliteLabel}
        announcement={announcement}
      >
        <ErrorBoundary label="This view" resetKey={view}>
          <Suspense fallback={<ViewFallback />}>{content}</Suspense>
        </ErrorBoundary>
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onStartTour={startTour} />
        {tourStep !== null && (
          <ProductTour step={tourStep} onStepChange={setTourStep} onClose={closeTour} onNavigate={navigate} currentView={view} />
        )}
        <ErrorBoundary label="The AI Copilot">
          <Copilot />
        </ErrorBoundary>
      </AppShell>
    </CopilotProvider>
  );
}
