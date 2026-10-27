import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Download, Info, Minus } from "lucide-react";
import { getCellHistory, isAbortError } from "../../api";
import { useCopilotViewContext } from "../../context/CopilotContext";
import { buildSeries, summarizeSeries, zoneLabel } from "../../lib/analysis";
import { dateStamp, downloadText, EXPORT_DISCLAIMER, safeFilename, toCsv } from "../../lib/csv";
import { formatNumber, formatPercent } from "../../lib/numbers";
import { Alert, EmptyState, PageHeader, Panel, SegmentedControl, Skeleton, StatTile } from "../common/Primitives";
import TrendChart from "../charts/TrendChart";

const SOURCE_NOTES = {
  sentinel: "Sentinel-2 seasonal composites from the same season each year, compared like-for-like. Primary vegetation source.",
  landsat: "Landsat annual composites at coarser resolution. Secondary long-term context — a different sensor and compositing period, so values are not directly comparable with Sentinel-2.",
};

export default function TrendsView({ zoneHistory, landsat, cells, priority, selectedZoneId, selectedCellId, initialUnit, onSelectZone, onSelectCell }) {
  const zoneSelectId = useId();
  const cellSelectId = useId();
  const [dataset, setDataset] = useState("sentinel");
  const [unit, setUnit] = useState(initialUnit === "cell" ? "cell" : "zone");
  const [metric, setMetric] = useState("ndvi");
  useCopilotViewContext("trends", { dataset, unit, metric });
  const [showContext, setShowContext] = useState(false);
  const [cellState, setCellState] = useState({ status: "idle", records: [], error: null });
  const cache = useRef(new Map());

  const zones = useMemo(() => {
    const names = new Map();
    for (const record of priority) names.set(String(record.zone_id), zoneLabel(record));
    for (const record of zoneHistory) if (!names.has(String(record.zone_id))) names.set(String(record.zone_id), record.zone_name || record.zone_id);
    return [...names.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [priority, zoneHistory]);

  const sentinelSeason = useMemo(() => [...new Set(zoneHistory.map((record) => record.season).filter(Boolean))].join(", "), [zoneHistory]);
  const zoneId = selectedZoneId || zones[0]?.[0] || "";
  const cellFeatures = cells.data?.geojson?.features;
  const zoneCells = useMemo(
    () => (cellFeatures || [])
      .map((feature) => feature.properties)
      .filter((cell) => String(cell.zone_id) === String(zoneId))
      .sort((a, b) => String(a.cell_id).localeCompare(String(b.cell_id))),
    [cellFeatures, zoneId]
  );
  const cellId = zoneCells.some((cell) => String(cell.cell_id) === String(selectedCellId)) ? String(selectedCellId) : zoneCells[0]?.cell_id ?? null;
  const cellMode = unit === "cell" && dataset === "sentinel";

  useEffect(() => {
    if (!cellMode || !cellId) return undefined;
    if (cache.current.has(cellId)) {
      setCellState({ status: "ready", records: cache.current.get(cellId), error: null });
      return undefined;
    }
    const controller = new AbortController();
    setCellState({ status: "loading", records: [], error: null });
    getCellHistory(cellId, { signal: controller.signal })
      .then((payload) => {
        cache.current.set(cellId, payload.records || []);
        setCellState({ status: "ready", records: payload.records || [], error: null });
      })
      .catch((error) => {
        if (!isAbortError(error)) setCellState({ status: "error", records: [], error: error.message });
      });
    return () => controller.abort();
  }, [cellMode, cellId]);

  const field = metric === "ndvi" ? "mean_ndvi" : "green_cover_percent";
  const sourceRecords = dataset === "landsat" ? landsat.records : zoneHistory;
  const mainSeries = cellMode
    ? { key: "selected", label: cellId || "Cell", emphasis: true, points: buildSeries(cellState.records, { idField: "cell_id", id: cellId, field }) }
    : { key: "selected", label: zones.find(([id]) => id === String(zoneId))?.[1] || zoneId, emphasis: true, points: buildSeries(sourceRecords, { idField: "zone_id", id: zoneId, field }) };
  const contextSeries = !cellMode && showContext
    ? zones.filter(([id]) => id !== String(zoneId)).map(([id, name]) => ({ key: `ctx_${id}`, label: name, emphasis: false, points: buildSeries(sourceRecords, { idField: "zone_id", id, field }) }))
    : [];
  const series = [mainSeries, ...contextSeries];
  const summary = summarizeSeries(mainSeries.points, metric === "ndvi" ? "ndvi" : "green");
  const isNdvi = metric === "ndvi";
  const digits = isNdvi ? 3 : 1;
  const unitSuffix = isNdvi ? "" : "%";
  const StatusIcon = summary.status === "Declining" ? ArrowDownRight : summary.status === "Improving" ? ArrowUpRight : Minus;
  const datasetLabel = dataset === "sentinel" ? "Sentinel-2" : "Landsat";
  const loadingChart = cellMode && cellState.status === "loading";

  const exportCsv = () => {
    const rows = series.flatMap((item) => item.points.map((point) => ({ series: item.label, emphasis: item.emphasis ? "selected" : "context", ...point })));
    const csv = toCsv({
      metadata: [
        ["GreenPulse AI", "Historical vegetation trend export"],
        ["Dataset", `${datasetLabel} ${dataset === "sentinel" ? `seasonal composites (${sentinelSeason || "season not recorded"})` : "annual composites (secondary context)"}`],
        ["Unit", cellMode ? "50 m cell" : "zone"],
        ["Metric", isNdvi ? "Mean NDVI (unitless)" : "Green cover (%)"],
        ["Exported", new Date().toISOString()],
        ["Note", EXPORT_DISCLAIMER],
      ],
      columns: [
        { key: "series", label: cellMode ? "cell_id" : "zone" },
        { key: "emphasis", label: "series_role" },
        { key: "year", label: "year" },
        { key: "value", label: isNdvi ? "mean_ndvi" : "green_cover_percent" },
        { key: "season", label: "season" },
        { key: "imageCount", label: "image_count" },
        { key: "dataset", label: "dataset" },
      ],
      rows,
    });
    downloadText(safeFilename(`greenpulse-trend-${datasetLabel}-${mainSeries.label}-${metric}-${dateStamp()}`), csv);
  };

  return (
    <div className="view view--trends">
      <PageHeader
        id="view-title"
        eyebrow="Vegetation trends"
        title="Historical vegetation analysis"
        description="Baseline-to-latest change per zone or 50 m cell. Sensors are never blended; change in NDVI does not by itself identify a cause."
        actions={
          <button type="button" className="button button--secondary" onClick={exportCsv} disabled={!mainSeries.points.length}>
            <Download size={15} aria-hidden="true" /> Export CSV
          </button>
        }
      />

      <Panel className="control-bar" aria-label="Trend controls">
        <div className="control">
          <span className="control__label">Source</span>
          <SegmentedControl
            label="Satellite source"
            value={dataset}
            onChange={(value) => {
              setDataset(value);
              if (value === "landsat") setUnit("zone");
            }}
            options={[
              { value: "sentinel", label: "Sentinel-2" },
              { value: "landsat", label: "Landsat", disabled: !landsat.records.length, title: landsat.records.length ? undefined : "Landsat history unavailable" },
            ]}
          />
        </div>
        <div className="control">
          <span className="control__label">Unit</span>
          <SegmentedControl
            label="Analysis unit"
            value={cellMode ? "cell" : "zone"}
            onChange={(value) => {
              setUnit(value);
              if (value === "cell") setDataset("sentinel");
            }}
            options={[
              { value: "zone", label: "Zone" },
              { value: "cell", label: "50 m cell", disabled: !zoneCells.length, title: zoneCells.length ? undefined : "Cell data unavailable" },
            ]}
          />
        </div>
        <label className="control" htmlFor={zoneSelectId}>
          <span className="control__label">Zone</span>
          <select id={zoneSelectId} className="select" value={zoneId} onChange={(event) => onSelectZone(event.target.value, "trends")}>
            {zones.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        {cellMode && (
          <label className="control" htmlFor={cellSelectId}>
            <span className="control__label">Cell ({zoneCells.length})</span>
            <select id={cellSelectId} className="select" value={cellId || ""} onChange={(event) => onSelectCell(event.target.value, zoneId, "trends")}>
              {zoneCells.map((cell) => <option key={cell.cell_id} value={cell.cell_id}>{cell.cell_id}</option>)}
            </select>
          </label>
        )}
        <div className="control">
          <span className="control__label">Metric</span>
          <SegmentedControl label="Metric" value={metric} onChange={setMetric} options={[{ value: "ndvi", label: "NDVI" }, { value: "green", label: "Green cover" }]} />
        </div>
        {!cellMode && (
          <label className="switch">
            <input type="checkbox" checked={showContext} onChange={(event) => setShowContext(event.target.checked)} />
            <span className="switch__track" aria-hidden="true" />
            <span>Show other zones</span>
          </label>
        )}
      </Panel>

      <section className="stat-grid stat-grid--5" aria-label="Trend summary">
        <StatTile label={`Baseline${summary.baselineYear ? ` (${summary.baselineYear})` : ""}`} value={formatNumber(summary.baseline, digits, { suffix: unitSuffix })} loading={loadingChart} />
        <StatTile label={`Latest${summary.latestYear ? ` (${summary.latestYear})` : ""}`} value={formatNumber(summary.latest, digits, { suffix: unitSuffix })} loading={loadingChart} />
        <StatTile label="Absolute change" value={formatNumber(summary.change, digits, { suffix: isNdvi ? "" : " pp", signed: true })} loading={loadingChart} />
        <StatTile label="Relative change" value={formatPercent(summary.percent, 1, { signed: true })} loading={loadingChart} />
        <StatTile
          label="Trend status"
          tone={summary.status.toLowerCase()}
          loading={loadingChart}
          value={<span className="trend-status"><StatusIcon size={18} aria-hidden="true" />{summary.status}</span>}
          context={`Stable when |change| < ${isNdvi ? formatNumber(summary.threshold, 2) : `${summary.threshold} pp`}`}
        />
      </section>

      <Panel aria-labelledby="trend-chart-title" data-tour="trend-chart">
        <div className="chart-head">
          <div>
            <h2 id="trend-chart-title">{mainSeries.label}</h2>
            <p>{datasetLabel} · {isNdvi ? "mean NDVI" : "green cover %"} · {mainSeries.points.length} annual points{summary.baselineYear ? ` · ${summary.baselineYear}–${summary.latestYear}` : ""}</p>
          </div>
          {contextSeries.length > 0 && (
            <ul className="chart-key" aria-label="Series key">
              <li><i className="chart-key__line chart-key__line--primary" aria-hidden="true" />Selected zone</li>
              <li><i className="chart-key__line chart-key__line--context" aria-hidden="true" />Other zones (context)</li>
            </ul>
          )}
        </div>
        {cellState.status === "error" && cellMode && <Alert tone="error" title="Cell history could not load">{cellState.error}</Alert>}
        {loadingChart ? (
          <Skeleton className="skeleton--chart" label="Loading cell history" />
        ) : mainSeries.points.length ? (
          <TrendChart series={series} metric={isNdvi ? "ndvi" : "green"} ariaLabel={`${datasetLabel} ${isNdvi ? "NDVI" : "green cover"} by year for ${mainSeries.label}`} />
        ) : (
          <EmptyState title="No historical records">There are no {datasetLabel} records for this selection.</EmptyState>
        )}
        <p className="source-note"><Info size={14} aria-hidden="true" />{SOURCE_NOTES[dataset]}</p>
      </Panel>
    </div>
  );
}
