import { Activity, ArrowRight, CalendarRange, Compass, Grid3X3, LandPlot, Layers, Leaf, MapPin, Map as MapIcon, RefreshCw, Satellite, Wind } from "lucide-react";
import { scoredZones, zoneLabel } from "../../lib/analysis";
import { CAMPUS } from "../../lib/constants";
import { formatNumber, formatPercent } from "../../lib/numbers";
import Badge, { PriorityBadge } from "../common/Badge";
import { Alert, PageHeader, Panel, SectionTitle, Skeleton, StatTile } from "../common/Primitives";
import ContributionBar, { FactorLegend } from "../charts/ContributionBar";
import InsightCards from "../insights/InsightCards";

function PrioritySnapshot({ priority, loading, onOpenZone }) {
  if (loading) return <Skeleton className="skeleton--block" label="Loading priority ranking" />;
  if (!priority.length) return <p className="muted">The official ranking is unavailable.</p>;
  return (
    <ol className="snapshot-list">
      {priority.map((zone) => (
        <li key={zone.zone_id}>
          <button type="button" className="snapshot-row" onClick={() => onOpenZone(zone.zone_id)}>
            <span className="snapshot-row__rank">{zone.rank ?? "—"}</span>
            <span className="snapshot-row__name">
              <strong>{zoneLabel(zone)}</strong>
              <small>{zone.zone_id}</small>
            </span>
            <span className="snapshot-row__bar"><ContributionBar zone={zone} height="sm" decorative /></span>
            <span className="snapshot-row__class"><PriorityBadge priorityClass={zone.priority_class} /></span>
            <span className="sr-only">Open score breakdown</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export default function OverviewView({
  summary,
  priority,
  spatial,
  datasets,
  landsatMeta,
  environment,
  freshness,
  insights,
  loading,
  dashboardError,
  refreshing,
  onRefresh,
  onRetry,
  onNavigate,
  onOpenZone,
  onStartTour,
  tourCompleted = false,
}) {
  const ranked = scoredZones(priority);
  const top = ranked[0];
  const sentinel = datasets?.sentinel2_zone_history || {};
  const latestYear = sentinel.latest_year ?? spatial?.latest_satellite_year;
  const season = sentinel.season || spatial?.season || "seasonal";
  const cellCount = spatial?.cell_count;

  return (
    <div className="view view--overview">
      <section className="hero" aria-labelledby="overview-title">
        <div className="hero__copy">
          <PageHeader
            id="overview-title"
            eyebrow={`${CAMPUS.name} · ${CAMPUS.city}`}
            title="Campus environmental intelligence"
            description="Satellite vegetation, land-cover pressure and modelled air-quality context combined into a transparent, zone-level review priority for the TIET campus."
          />
          <div className="hero__meta" aria-label="Study area">
            <span><MapPin size={14} aria-hidden="true" />{CAMPUS.latitude.toFixed(3)}° N, {CAMPUS.longitude.toFixed(3)}° E</span>
            <span><Satellite size={14} aria-hidden="true" />Sentinel-2 {season} {latestYear ?? ""}</span>
            <span><Grid3X3 size={14} aria-hidden="true" />{cellCount ? `${cellCount} cells at 50 m` : "50 m grid"}</span>
          </div>
          <div className="hero__actions">
            <button type="button" className="button button--primary" onClick={() => onNavigate("map")}>
              <MapIcon size={16} aria-hidden="true" /> Explore the map
            </button>
            <button type="button" className="button button--secondary" onClick={() => document.getElementById("priority-snapshot")?.scrollIntoView({ block: "start" })}>
              <Layers size={16} aria-hidden="true" /> View priorities
            </button>
            <button type="button" className="button button--ghost" onClick={onStartTour}>
              <Compass size={16} aria-hidden="true" /> {tourCompleted ? "Replay guided demo" : "Guided demo"}
            </button>
          </div>
        </div>
        <aside className="hero__focus" aria-label="Highest official priority">
          <p className="eyebrow">Review first</p>
          {loading ? (
            <Skeleton className="skeleton--block" />
          ) : top ? (
            <>
              <div className="hero__focus-head">
                <h2>{zoneLabel(top)}</h2>
                <PriorityBadge priorityClass={top.priority_class} />
              </div>
              <p className="hero__score"><strong>{formatNumber(top.priority_score, 2)}</strong><span>/ 100 official score</span></p>
              <ContributionBar zone={top} showTotal={false} />
              <p className="hero__reason">{top.reason}</p>
              <button type="button" className="button button--link" onClick={() => onOpenZone(top.zone_id)}>
                Explain this score <ArrowRight size={15} aria-hidden="true" />
              </button>
            </>
          ) : (
            <p className="muted">No zone could be scored with the loaded data.</p>
          )}
        </aside>
      </section>

      {dashboardError && (
        <Alert tone="error" title="The dashboard could not load" action={<button type="button" className="button button--secondary" onClick={onRetry}>Retry</button>}>
          {dashboardError} Map layers and history that loaded independently remain available.
        </Alert>
      )}

      <section className="stat-grid" aria-label="Key indicators" data-tour="kpis">
        <StatTile icon={LandPlot} label="Campus area" loading={loading} value={formatNumber(summary?.total_area_hectares, 1)} unit="ha" context="Mapped study boundary (GEE)" />
        <StatTile icon={Leaf} label="Green cover" loading={loading} value={formatPercent(summary?.green_cover_percent)} context="Campus share, current Sentinel-2 composite" />
        <StatTile icon={Activity} label="Average NDVI" loading={loading} value={formatNumber(summary?.average_ndvi, 3)} context="Campus mean, current composite" />
        <StatTile icon={MapIcon} label="Analysis zones" loading={loading} value={priority.length ? String(priority.length) : "N/A"} context={`${ranked.length} with an official score`} />
        <StatTile icon={Grid3X3} label="Usable 50 m cells" loading={loading && !cellCount} value={cellCount ? String(cellCount) : "N/A"} context="Indicator grid, not scored" />
        <StatTile icon={MapPin} label="Highest priority" loading={loading} value={top ? top.zone_id : "N/A"} context={top ? `${zoneLabel(top)} · ${formatNumber(top.priority_score, 2)}` : "Awaiting ranking"} />
        <StatTile
          icon={Wind}
          label="Regional PM stress"
          loading={loading}
          value={formatNumber(environment?.stress_score, 1)}
          unit="/ 100"
          context={freshness.fallback ? "Documented fallback (no usable PM data)" : `Modelled · ${freshness.label.toLowerCase()}`}
        />
      </section>

      <div className="overview-grid">
        <Panel className="panel--snapshot" id="priority-snapshot" aria-labelledby="snapshot-title">
          <SectionTitle
            id="snapshot-title"
            title="Priority snapshot"
            description="Official zone ranking. Bar length is the score; colours show each factor's weighted points."
            actions={<button type="button" className="button button--ghost button--sm" onClick={() => onNavigate("map")}>Open map <ArrowRight size={14} aria-hidden="true" /></button>}
          />
          <FactorLegend compact />
          <PrioritySnapshot priority={priority} loading={loading} onOpenZone={onOpenZone} />
        </Panel>

        <div className="status-stack">
          <Panel aria-labelledby="satellite-status-title">
            <SectionTitle id="satellite-status-title" as="h3" title="Satellite analysis" />
            <dl className="status-list">
              <div><dt>Sentinel-2 zone series</dt><dd>{sentinel.baseline_year && sentinel.latest_year ? `${sentinel.baseline_year}–${sentinel.latest_year}` : "Unavailable"} <Badge tone="neutral">{season}</Badge></dd></div>
              <div><dt>Latest satellite season</dt><dd><CalendarRange size={14} aria-hidden="true" /> {season} {latestYear ?? "—"}</dd></div>
              <div><dt>Landsat context</dt><dd>{landsatMeta?.baseline_year ? `${landsatMeta.baseline_year}–${landsatMeta.latest_year} (annual, separate)` : "Not loaded"}</dd></div>
              <div><dt>Spatial grid</dt><dd>{cellCount ? `${cellCount} usable cells` : "Not loaded"}</dd></div>
            </dl>
          </Panel>
          <Panel aria-labelledby="air-status-title">
            <SectionTitle
              id="air-status-title"
              as="h3"
              title="Modelled air quality"
              actions={
                <button type="button" className="icon-button" onClick={onRefresh} disabled={refreshing || loading} aria-label="Refresh modelled air quality and ranking" title="Refresh">
                  <RefreshCw size={16} className={refreshing ? "is-spinning" : ""} aria-hidden="true" />
                </button>
              }
            />
            <dl className="status-list">
              <div><dt>Status</dt><dd><span className={`status-dot status-dot--${freshness.tone}`} aria-hidden="true" />{freshness.label}</dd></div>
              <div><dt>Model time</dt><dd>{freshness.modelTime || "Unavailable"}</dd></div>
              <div><dt>Last provider fetch</dt><dd>{freshness.fetchedRelative || "Never"}</dd></div>
              <div><dt>24-h PM2.5 / PM10</dt><dd>{formatNumber(environment?.averages_24h?.pm2_5, 1)} / {formatNumber(environment?.averages_24h?.pm10, 1)} µg/m³</dd></div>
            </dl>
            {freshness.refreshError && (
              <p className="inline-error" role="alert">Refresh failed: {freshness.refreshError} The values above are from the last successful load.</p>
            )}
            <p className="fine-print">Modelled estimates near TIET campus, not campus sensor readings.</p>
          </Panel>
        </div>
      </div>

      <Panel aria-labelledby="quick-insights-title">
        <SectionTitle
          id="quick-insights-title"
          title="Quick insights"
          description="Derived directly from the loaded datasets; each card names its source fields."
          actions={<button type="button" className="button button--ghost button--sm" onClick={() => onNavigate("insights")}>All insights <ArrowRight size={14} aria-hidden="true" /></button>}
        />
        <InsightCards insights={insights.slice(0, 4)} loading={loading} onOpenZone={onOpenZone} />
      </Panel>
    </div>
  );
}
