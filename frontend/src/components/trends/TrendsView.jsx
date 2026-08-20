import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Satellite } from "lucide-react";
import { getCellHistory } from "../../api";
import Badge from "../common/Badge";
import SectionHeader from "../common/SectionHeader";
import Skeleton from "../common/Skeleton";
import NDVITrendChart from "../NDVITrendChart";

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function format(value, digits = 3, suffix = "") {
  return value === null ? "N/A" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`;
}

export default function TrendsView({
  zoneHistory,
  landsatHistory,
  cellFeatures,
  selectedZoneId,
  selectedCellId,
  onSelectZone,
  onSelectCell,
}) {
  const [dataset, setDataset] = useState("sentinel");
  const [metric, setMetric] = useState("ndvi");
  const [unit, setUnit] = useState(selectedCellId ? "cell" : "zone");
  const [trendCellId, setTrendCellId] = useState(selectedCellId || "");
  const [cellHistory, setCellHistory] = useState([]);
  const [loadingCell, setLoadingCell] = useState(false);
  const [cellError, setCellError] = useState("");

  const zones = useMemo(
    () => [...new Map((zoneHistory || []).map((record) => [String(record.zone_id), record.zone_name || record.zone_id])).entries()],
    [zoneHistory]
  );
  const currentZoneId = selectedZoneId || zones[0]?.[0] || "";
  const zoneCells = useMemo(
    () => cellFeatures
      .map((feature) => feature?.properties || feature)
      .filter((cell) => String(cell.zone_id) === String(currentZoneId))
      .sort((a, b) => String(a.cell_id).localeCompare(String(b.cell_id))),
    [cellFeatures, currentZoneId]
  );

  useEffect(() => {
    if (unit !== "cell" || !zoneCells.length) return;
    const belongsToZone = zoneCells.some((cell) => String(cell.cell_id) === String(trendCellId));
    if (!belongsToZone) setTrendCellId(String(zoneCells[0].cell_id));
  }, [trendCellId, unit, zoneCells]);

  useEffect(() => {
    if (!selectedCellId) return;
    setTrendCellId(selectedCellId);
    setUnit("cell");
    setDataset("sentinel");
  }, [selectedCellId]);

  useEffect(() => {
    if (unit !== "cell" || dataset !== "sentinel") return;
    const nextCellId = trendCellId || zoneCells[0]?.cell_id;
    if (!nextCellId) return;
    if (!trendCellId) setTrendCellId(nextCellId);
    let ignore = false;
    setLoadingCell(true);
    setCellError("");
    getCellHistory(nextCellId)
      .then((payload) => {
        if (!ignore) setCellHistory(payload.records || []);
      })
      .catch((error) => {
        if (!ignore) setCellError(error.message);
      })
      .finally(() => {
        if (!ignore) setLoadingCell(false);
      });
    return () => { ignore = true; };
  }, [dataset, trendCellId, unit, zoneCells]);

  const setSource = (nextDataset) => {
    setDataset(nextDataset);
    if (nextDataset === "landsat") setUnit("zone");
  };

  const setAnalysisUnit = (nextUnit) => {
    if (nextUnit === "cell" && dataset === "landsat") setDataset("sentinel");
    setUnit(nextUnit);
  };

  const handleCellSelection = (cellId) => {
    setTrendCellId(cellId);
    const cell = zoneCells.find((item) => String(item.cell_id) === String(cellId));
    if (cell) onSelectCell(String(cell.cell_id), String(cell.zone_id));
  };

  const sourceRecords = dataset === "landsat"
    ? landsatHistory
    : unit === "cell"
      ? cellHistory
      : zoneHistory;
  const filtered = (sourceRecords || []).filter((record) => {
    if (unit === "cell") return String(record.cell_id) === String(trendCellId || zoneCells[0]?.cell_id);
    return String(record.zone_id) === String(currentZoneId);
  });
  const field = metric === "ndvi" ? "mean_ndvi" : "green_cover_percent";
  const chartData = filtered
    .map((record) => ({ year: Number(record.year), value: numeric(record[field]) }))
    .filter((record) => Number.isFinite(record.year) && record.value !== null)
    .sort((a, b) => a.year - b.year);

  const baseline = chartData[0]?.value ?? null;
  const current = chartData.at(-1)?.value ?? null;
  const change = baseline === null || current === null ? null : current - baseline;
  const percentChange = change === null || !baseline ? null : (change / Math.abs(baseline)) * 100;
  const status = change === null ? "Unavailable" : change < -0.01 ? "Declining" : change > 0.01 ? "Improving" : "Stable";
  const StatusIcon = status === "Declining" ? ArrowDownRight : status === "Improving" ? ArrowUpRight : Minus;
  const selectedZoneName = zones.find(([id]) => String(id) === String(currentZoneId))?.[1] || currentZoneId;
  const seriesName = unit === "cell" ? trendCellId || zoneCells[0]?.cell_id : selectedZoneName;
  const isNdvi = metric === "ndvi";

  return (
    <section id="vegetation-trends" className="product-section section-anchor" aria-labelledby="trends-title">
      <SectionHeader
        id="trends-title"
        eyebrow="Vegetation trends"
        title="Historical satellite analysis"
        description="Compare seasonal vegetation signals without blending measurements from different satellite sensors."
        action={<Badge tone={dataset === "sentinel" ? "forest" : "neutral"}><Satellite size={14} />{dataset === "sentinel" ? "Primary source" : "Long-term context"}</Badge>}
      />

      <div className="trend-controls" aria-label="Historical analysis controls">
        <div className="control-field">
          <span>Dataset</span>
          <div className="segmented-control">
            <button type="button" className={dataset === "sentinel" ? "is-active" : ""} onClick={() => setSource("sentinel")}>Sentinel-2</button>
            <button type="button" className={dataset === "landsat" ? "is-active" : ""} onClick={() => setSource("landsat")} disabled={!landsatHistory?.length}>Landsat</button>
          </div>
        </div>
        <div className="control-field">
          <span>Analysis unit</span>
          <div className="segmented-control">
            <button type="button" className={unit === "zone" ? "is-active" : ""} onClick={() => setAnalysisUnit("zone")}>Zone</button>
            <button type="button" className={unit === "cell" ? "is-active" : ""} onClick={() => setAnalysisUnit("cell")} disabled={!cellFeatures.length}>50 m cell</button>
          </div>
        </div>
        <label className="control-field">
          <span>Zone</span>
          <select value={currentZoneId} onChange={(event) => onSelectZone(event.target.value)}>
            {zones.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        {unit === "cell" && (
          <label className="control-field control-field--cell">
            <span>Cell</span>
            <select value={trendCellId || zoneCells[0]?.cell_id || ""} onChange={(event) => handleCellSelection(event.target.value)}>
              {zoneCells.map((cell) => <option key={cell.cell_id} value={cell.cell_id}>{cell.cell_id}</option>)}
            </select>
          </label>
        )}
        <div className="control-field">
          <span>Metric</span>
          <div className="segmented-control">
            <button type="button" className={metric === "ndvi" ? "is-active" : ""} onClick={() => setMetric("ndvi")}>NDVI</button>
            <button type="button" className={metric === "green" ? "is-active" : ""} onClick={() => setMetric("green")}>Green cover</button>
          </div>
        </div>
      </div>

      <div className="trend-summary-grid">
        <div><span>Baseline {isNdvi ? "NDVI" : "green cover"}</span><strong>{baseline === null ? "N/A" : `${baseline.toFixed(isNdvi ? 3 : 1)}${isNdvi ? "" : "%"}`}</strong></div>
        <div><span>Current {isNdvi ? "NDVI" : "green cover"}</span><strong>{current === null ? "N/A" : `${current.toFixed(isNdvi ? 3 : 1)}${isNdvi ? "" : "%"}`}</strong></div>
        <div><span>Absolute change</span><strong>{format(change, isNdvi ? 3 : 1, isNdvi ? "" : "%")}</strong></div>
        <div><span>Percentage change</span><strong>{format(percentChange, 1, "%")}</strong></div>
        <div className={`trend-status trend-status--${status.toLowerCase()}`}><span>Trend status</span><strong><StatusIcon size={17} />{status}</strong></div>
      </div>

      <div className="trend-chart-surface">
        <div className="chart-title-row">
          <div><strong>{seriesName}</strong><span>{dataset === "sentinel" ? "Sentinel-2 · Oct-Dec seasonal comparison" : "Landsat · secondary long-term context"}</span></div>
          <Badge tone="neutral">{chartData.length} annual points</Badge>
        </div>
        {loadingCell ? <Skeleton className="skeleton--chart" /> : <NDVITrendChart data={chartData} metric={isNdvi ? "NDVI" : "Green cover"} seriesName={seriesName} />}
        {cellError && <p className="inline-error">Cell history could not load: {cellError}</p>}
      </div>
    </section>
  );
}
