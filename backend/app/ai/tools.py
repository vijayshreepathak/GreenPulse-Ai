"""Read-only, allowlisted GreenPulse data tools that Gemini may ask the server to run.

Every tool reads through the existing services (official scoring, cached air quality, spatial
cells, history CSVs). None writes files, runs shell commands, queries arbitrary URLs or reads
arbitrary paths. Each returns a bounded payload for the model plus evidence, KPI facts and an
optional visual for the UI, built here from server data rather than from model text.
"""

import json
import math
from dataclasses import dataclass, field
from typing import Any, Callable

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .. import config
from ..analysis import official_priority_table
from ..data_loader import first_row_from_df, load_optional_dataset, load_required_dataset, records_from_df
from ..external_apis import get_environment_data
from ..scoring import FACTORS, scenario_scores, scoring_methodology, zone_key
from ..spatial import cell_feature_collection, cell_history_records, spatial_summary
from .methodology import LAYER_INFO, search_methodology

MAX_PAYLOAD_CHARS = 14_000
# Same thresholds as frontend/src/lib/analysis.js STABLE_THRESHOLDS.
STABLE_THRESHOLDS = {"mean_ndvi": 0.01, "green_cover_percent": 1.0}
SENTINEL_LABEL = "Sentinel-2 seasonal composite"
LANDSAT_LABEL = "Landsat annual composite (secondary context)"
LIMITATIONS = [
    "Official priority scores are zone-level; 50 m cells carry indicators only and have no official score.",
    "NDVI green-cover thresholds are project-calibrated, not universal ecological classes.",
    "Dynamic World land cover is a supporting ~10 m indicator, not building-level ground truth.",
    "PM2.5/PM10 are Open-Meteo/CAMS modelled regional estimates near one coordinate, not campus sensor readings.",
    "PM stress is a project normalisation (caps 60 and 100 µg/m³), not an official AQI and not a forecast.",
    "Sentinel-2 (seasonal) and Landsat (annual) are different sensors and are never merged.",
    "Mapped plantable potential is not a validated planting site; interventions need ground review.",
    "No causal link between vegetation change and air quality is claimed or tested.",
    "The score is rule-based, not machine learning; no ML model, drone validation or species module exists.",
]


class ToolInputError(ValueError):
    """Unknown or invalid arguments. The message is safe to return to the model."""


def _num(value: Any, digits: int) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, digits) if math.isfinite(number) else None


def _fmt(value: Any, digits: int, suffix: str = "", signed: bool = False) -> str:
    number = _num(value, digits)
    if number is None:
        return "N/A"
    text = f"{number:+.{digits}f}" if signed else f"{number:.{digits}f}"
    return f"{text}{suffix}"


@dataclass
class ToolResult:
    payload: dict[str, Any]
    evidence: list[dict[str, Any]] = field(default_factory=list)
    facts: list[dict[str, Any]] = field(default_factory=list)
    visual: dict[str, Any] | None = None


class AnalysisSnapshot:
    """Loads the official analysis at most once per chat request so every tool sees the same data."""

    def __init__(self, environment_loader: Callable[[], dict[str, Any]] | None = None):
        self._environment_loader = environment_loader or (lambda: get_environment_data(history_hours=168))
        self._environment: dict[str, Any] | None = None
        self._priority: list[dict[str, Any]] | None = None
        self._issues: list[str] = []
        self._zone_names: dict[str, str] | None = None
        self._cells: dict[str, dict[str, Any]] | None = None
        self.scenario_weights: dict[str, float] | None = None

    def environment(self) -> dict[str, Any]:
        if self._environment is None:
            self._environment = self._environment_loader()
        return self._environment

    def priority(self) -> list[dict[str, Any]]:
        if self._priority is None:
            table, issues = official_priority_table(self.environment())
            self._priority = records_from_df(table)
            self._issues = issues
        return self._priority

    def issues(self) -> list[str]:
        self.priority()
        return self._issues

    def zone_names(self) -> dict[str, str]:
        """Zone IDs and names from the zone dataset, without fetching air quality."""
        if self._zone_names is None:
            names: dict[str, str] = {}
            frame = load_required_dataset("zone_ndvi")
            for record in frame.to_dict(orient="records"):
                key = zone_key(record.get("zone_id"))
                if key:
                    name = record.get("zone_name")
                    names[key] = name if isinstance(name, str) and name.strip() else key
            self._zone_names = names
        return self._zone_names

    def resolve_zone(self, value: Any) -> str:
        key = zone_key(value)
        if key and key in self.zone_names():
            return key
        if isinstance(value, str):
            lowered = value.strip().lower()
            for zone_id, name in self.zone_names().items():
                if name.lower() == lowered:
                    return zone_id
        raise ToolInputError(f"Unknown zone '{str(value)[:32]}'. Valid zone IDs: {', '.join(sorted(self.zone_names()))}.")

    def zone(self, zone_id: str) -> dict[str, Any]:
        resolved = self.resolve_zone(zone_id)
        for row in self.priority():
            if str(row.get("zone_id")) == resolved:
                return row
        raise ToolInputError(f"Zone {resolved} has no record in the official ranking.")

    def cells(self) -> dict[str, dict[str, Any]]:
        if self._cells is None:
            payload = cell_feature_collection()
            features = payload.get("geojson", {}).get("features", []) if payload.get("available") else []
            self._cells = {str(feature["properties"].get("cell_id")): feature["properties"] for feature in features}
        return self._cells

    def pm_context(self) -> dict[str, Any]:
        environment = self.environment()
        rows = self.priority()
        stress = rows[0].get("pm_stress_score") if rows else environment.get("stress_score")
        source = rows[0].get("pm_stress_source") if rows else environment.get("pm_stress_source")
        return {
            "pm_stress_score": _num(stress, 2),
            "pm_stress_source": source,
            "pm_fetched_at": environment.get("fetched_at"),
            "pm_freshness": environment.get("freshness"),
        }


# ---------------------------------------------------------------- argument models


class NoArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ZoneArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    zone_id: str = Field(min_length=1, max_length=40)


class CompareArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    zone_ids: list[str] = Field(min_length=2, max_length=3)

    @field_validator("zone_ids")
    @classmethod
    def _bounded(cls, values: list[str]) -> list[str]:
        if any(not isinstance(value, str) or not value.strip() or len(value) > 40 for value in values):
            raise ValueError("zone IDs must be short non-empty strings")
        return values


class HistoryArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataset: str = Field(default="sentinel2", pattern=r"^(sentinel2|landsat)$")
    unit: str = Field(default="zone", pattern=r"^(zone|cell)$")
    zone_id: str | None = Field(default=None, max_length=40)
    cell_id: str | None = Field(default=None, max_length=64)


class CellArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cell_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_,.\-]+$")


class ScenarioArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    low_green_cover: float | None = Field(default=None, ge=0, le=100)
    ndvi_decline: float | None = Field(default=None, ge=0, le=100)
    built_up_pressure: float | None = Field(default=None, ge=0, le=100)
    tree_gap: float | None = Field(default=None, ge=0, le=100)
    pm_stress: float | None = Field(default=None, ge=0, le=100)


class MethodologyArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=2, max_length=200)


# ---------------------------------------------------------------- tool implementations


def _official_evidence(snapshot: AnalysisSnapshot) -> dict[str, Any]:
    pm = snapshot.pm_context()
    pm_text = (
        f"PM stress {pm['pm_stress_score']} ({pm['pm_stress_source']}"
        + (f", fetched {pm['pm_fetched_at']}" if pm["pm_fetched_at"] and pm["pm_stress_source"] == "modelled" else "")
        + ")"
    )
    return {
        "id": "official-ranking",
        "label": "Official priority ranking",
        "source": "GreenPulse rule-based score (backend/app/scoring.py), zone level",
        "detail": pm_text,
        "as_of": pm["pm_fetched_at"],
    }


def _components(row: dict[str, Any]) -> dict[str, Any]:
    return {
        factor["key"]: {
            "label": factor["label"],
            "weight": config.SCORING_WEIGHTS[factor["key"]],
            "component_score": _num(row.get(factor["score_field"]), 2),
            "weighted_contribution": _num(row.get(f"contribution_{factor['key']}"), 2),
        }
        for factor in FACTORS
    }


def campus_overview(snapshot: AnalysisSnapshot, _: NoArgs) -> ToolResult:
    summary = first_row_from_df(load_required_dataset("summary"))
    spatial = spatial_summary()
    zones = snapshot.zone_names()
    campus = {
        "study_area": summary.get("study_area"),
        "total_area_hectares": _num(summary.get("total_area_hectares"), 2),
        "green_cover_percent": _num(summary.get("green_cover_percent"), 2),
        "average_ndvi": _num(summary.get("average_ndvi"), 4),
        "dense_vegetation_percent": _num(summary.get("dense_vegetation_percent"), 2),
        "moderate_vegetation_percent": _num(summary.get("moderate_vegetation_percent"), 2),
        "low_vegetation_percent": _num(summary.get("low_vegetation_percent"), 2),
    }
    payload = {
        "source": "thapar_campus_summary.csv (Google Earth Engine, Sentinel-2 current composite) and the 50 m grid summary",
        "campus": campus,
        "analysis_zones": {"count": len(zones), "zones": [{"zone_id": key, "zone_name": name} for key, name in sorted(zones.items())]},
        "spatial_grid": {
            "usable_cells": spatial.get("cell_count"),
            "grid_resolution_m": spatial.get("grid_resolution_m"),
            "history_years": spatial.get("years"),
            "history_season": spatial.get("season"),
        },
        "notes": ["Green cover uses a project-calibrated NDVI threshold.", "Location: TIET campus, Patiala, Punjab, India."],
    }
    facts = [
        {"label": "Campus area", "value": _fmt(campus["total_area_hectares"], 1), "unit": "ha", "source": "Campus summary"},
        {"label": "Green cover", "value": _fmt(campus["green_cover_percent"], 1, "%"), "unit": "", "source": "Sentinel-2 current composite"},
        {"label": "Average NDVI", "value": _fmt(campus["average_ndvi"], 3), "unit": "", "source": "Sentinel-2 current composite"},
        {"label": "Analysis zones", "value": str(len(zones)), "unit": "", "source": "Zone dataset"},
        {"label": "50 m cells", "value": str(spatial.get("cell_count") or "N/A"), "unit": "", "source": "50 m grid"},
    ]
    evidence = [{
        "id": "campus-summary", "label": "Campus summary",
        "source": "thapar_campus_summary.csv · Google Earth Engine", "detail": "Area, green cover, NDVI, vegetation classes",
        "as_of": None,
    }]
    return ToolResult(payload, evidence, facts)


def zone_rankings(snapshot: AnalysisSnapshot, _: NoArgs) -> ToolResult:
    rows = snapshot.priority()
    zones = [
        {
            "rank": row.get("rank"),
            "zone_id": row.get("zone_id"),
            "zone_name": row.get("zone_name"),
            "priority_score": _num(row.get("priority_score"), 2),
            "priority_class": row.get("priority_class"),
            "score_status": row.get("score_status"),
            "reason": row.get("reason"),
            "weighted_contributions": {factor["key"]: _num(row.get(f"contribution_{factor['key']}"), 2) for factor in FACTORS},
        }
        for row in rows
    ]
    pm = snapshot.pm_context()
    payload = {
        "source": "Official GreenPulse priority score: transparent rule-based weighted sum, zone level (not ML)",
        "formula": "0.35×LowGreenCover + 0.25×NDVIDecline + 0.20×BuiltUpPressure + 0.10×TreeGap + 0.10×RegionalPMStress",
        "shared_pm_stress": pm,
        "zones": zones,
        "data_issues": snapshot.issues()[:5],
        "notes": ["Ranks ordered by score; ties ordered by zone ID.", "The shared PM stress adds the same amount to every zone."],
    }
    scored = [zone for zone in zones if zone["priority_score"] is not None]
    facts = []
    if scored:
        top = scored[0]
        facts.append({"label": f"Top priority · {top['zone_id']}", "value": _fmt(top["priority_score"], 2), "unit": "/100",
                      "detail": f"{top['zone_name']} · {top['priority_class']}", "source": "Official score"})
    facts.append({"label": "Regional PM stress", "value": _fmt(pm["pm_stress_score"], 1), "unit": "/100",
                  "detail": f"{pm['pm_stress_source']} · shared by all zones", "source": "Open-Meteo / CAMS modelled"})
    visual = {
        "type": "table",
        "title": "Official priority ranking",
        "columns": ["Rank", "Zone", "Score", "Class"],
        "rows": [[str(zone["rank"] or "—"), f"{zone['zone_id']} · {zone['zone_name']}", _fmt(zone["priority_score"], 2), zone["priority_class"]] for zone in zones],
        "source": "Official rule-based score",
    }
    return ToolResult(payload, [_official_evidence(snapshot)], facts, visual)


def zone_details(snapshot: AnalysisSnapshot, args: ZoneArgs) -> ToolResult:
    row = snapshot.zone(args.zone_id)
    scored_count = sum(1 for item in snapshot.priority() if item.get("priority_score") is not None)
    components = _components(row)
    largest = max(
        (item for item in components.items() if item[1]["weighted_contribution"] is not None),
        key=lambda item: item[1]["weighted_contribution"], default=(None, None),
    )
    payload = {
        "zone_id": row.get("zone_id"),
        "zone_name": row.get("zone_name"),
        "official": {
            "rank": row.get("rank"), "of_ranked_zones": scored_count,
            "priority_score": _num(row.get("priority_score"), 2), "priority_class": row.get("priority_class"),
            "score_status": row.get("score_status"), "missing_inputs": row.get("missing_inputs"), "reason": row.get("reason"),
            "largest_contributor": largest[0],
        },
        "indicators": {
            "zone_area_hectares": _num(row.get("zone_area_hectares"), 2),
            "mean_ndvi": _num(row.get("mean_ndvi"), 4),
            "vegetation_status": row.get("vegetation_status"),
            "green_cover_percent": _num(row.get("green_cover_percent"), 2),
            "tree_percent": _num(row.get("tree_percent"), 2),
            "grass_percent": _num(row.get("grass_percent"), 2),
            "built_up_percent": _num(row.get("built_up_percent"), 2),
            "bare_land_percent": _num(row.get("bare_land_percent"), 2),
            "potential_plantable_percent": _num(row.get("potential_plantable_percent"), 2),
        },
        "ndvi_trend": {
            "dataset": f"{SENTINEL_LABEL} (Oct-Dec)",
            "baseline_year": row.get("first_year"), "latest_year": row.get("latest_year"),
            "baseline_mean_ndvi": _num(row.get("first_year_mean_ndvi"), 4),
            "latest_mean_ndvi": _num(row.get("latest_year_mean_ndvi"), 4),
            "ndvi_change": _num(row.get("ndvi_change"), 4),
        },
        "components": components,
        "shared_pm_stress": snapshot.pm_context(),
        "sources": {
            "mean_ndvi, green_cover_percent": "Sentinel-2 current composite",
            "tree/grass/built_up/bare/plantable percent": "Dynamic World land cover (supporting ~10 m indicator)",
            "ndvi_trend": f"{SENTINEL_LABEL}, same Oct-Dec season each year",
        },
    }
    zone_label = f"{row.get('zone_id')} · {row.get('zone_name')}"
    facts = [
        {"label": f"{row.get('zone_id')} priority score", "value": _fmt(row.get("priority_score"), 2), "unit": "/100",
         "detail": f"Rank {row.get('rank') or '—'} of {scored_count} · {row.get('priority_class')}", "source": "Official score"},
        {"label": "Green cover", "value": _fmt(row.get("green_cover_percent"), 1, "%"), "unit": "", "source": "Sentinel-2"},
        {"label": "NDVI change", "value": _fmt(row.get("ndvi_change"), 3, signed=True), "unit": "",
         "detail": f"{row.get('first_year')}→{row.get('latest_year')}", "source": "Sentinel-2 seasonal"},
        {"label": "Built-up", "value": _fmt(row.get("built_up_percent"), 1, "%"), "unit": "", "source": "Dynamic World"},
    ]
    visual = {
        "type": "table",
        "title": f"{zone_label}: score components",
        "columns": ["Factor", "Weight", "Component", "Contribution"],
        "rows": [[item["label"], f"{round(item['weight'] * 100)}%", _fmt(item["component_score"], 1), _fmt(item["weighted_contribution"], 2)] for item in components.values()],
        "source": "Official rule-based score",
    }
    evidence = [
        {**_official_evidence(snapshot), "id": f"zone-{row.get('zone_id')}", "label": f"Zone details · {zone_label}"},
        {"id": "sentinel2-history", "label": "Sentinel-2 NDVI history", "source": "thapar_historical_zone_ndvi_2018_2025.csv",
         "detail": f"{SENTINEL_LABEL}, {row.get('first_year')}–{row.get('latest_year')}", "as_of": None},
        {"id": "dynamic-world", "label": "Dynamic World land cover", "source": "thapar_zone_land_cover.csv",
         "detail": "Supporting zone-level indicator", "as_of": None},
    ]
    return ToolResult(payload, evidence, facts, visual)


COMPARE_METRICS = [
    ("priority_score", "Official priority score", 2, ""),
    ("green_cover_percent", "Green cover", 2, "%"),
    ("tree_percent", "Tree cover", 2, "%"),
    ("built_up_percent", "Built-up", 2, "%"),
    ("mean_ndvi", "Mean NDVI", 4, ""),
    ("ndvi_change", "NDVI change (baseline→latest)", 4, ""),
    ("potential_plantable_percent", "Plantable potential", 2, "%"),
]


def compare_zones(snapshot: AnalysisSnapshot, args: CompareArgs) -> ToolResult:
    ids = list(dict.fromkeys(snapshot.resolve_zone(value) for value in args.zone_ids))
    if len(ids) < 2:
        raise ToolInputError("Provide two or three different zone IDs.")
    rows = [snapshot.zone(zone_id) for zone_id in ids]
    reference = rows[0]
    metrics = []
    for field_name, label, digits, unit in COMPARE_METRICS:
        values = {str(row["zone_id"]): _num(row.get(field_name), digits) for row in rows}
        differences = {}
        for other in rows[1:]:
            a, b = values[str(reference["zone_id"])], values[str(other["zone_id"])]
            differences[f"{reference['zone_id']} minus {other['zone_id']}"] = None if a is None or b is None else round(a - b, digits)
        available = {key: value for key, value in values.items() if value is not None}
        metrics.append({
            "metric": field_name, "label": label, "unit": unit, "values": values, "differences": differences,
            "highest": max(available, key=available.get) if available else None,
        })
    contribution_gaps = {}
    for other in rows[1:]:
        gaps = {}
        for factor in FACTORS:
            a = _num(reference.get(f"contribution_{factor['key']}"), 2)
            b = _num(other.get(f"contribution_{factor['key']}"), 2)
            gaps[factor["key"]] = None if a is None or b is None else round(a - b, 2)
        available = {key: value for key, value in gaps.items() if value is not None}
        contribution_gaps[f"{reference['zone_id']} minus {other['zone_id']}"] = {
            "by_factor": gaps,
            "largest_driver": max(available, key=lambda key: abs(available[key])) if available else None,
        }
    payload = {
        "source": "Official zone ranking and its indicator inputs (Sentinel-2, Dynamic World, Sentinel-2 seasonal history)",
        "zones": [{"zone_id": row["zone_id"], "zone_name": row.get("zone_name"), "rank": row.get("rank"),
                   "priority_class": row.get("priority_class")} for row in rows],
        "metrics": metrics,
        "weighted_contribution_gaps": contribution_gaps,
        "shared_pm_stress": snapshot.pm_context(),
        "notes": ["Differences are the first zone minus each other zone.",
                  "The shared PM stress contributes equally to every zone, so it never explains a score gap."],
    }
    visual = {
        "type": "table",
        "title": "Zone comparison",
        "columns": ["Indicator", *[f"{row['zone_id']}" for row in rows]],
        "rows": [[f"{metric['label']}{' (%)' if metric['unit'] == '%' else ''}",
                  *[_fmt(metric["values"][str(row["zone_id"])], 3 if metric["metric"] in ("mean_ndvi", "ndvi_change") else 2,
                         signed=metric["metric"] == "ndvi_change") for row in rows]] for metric in metrics],
        "source": "Official score and indicators",
    }
    facts = [
        {"label": f"{row['zone_id']} score", "value": _fmt(row.get("priority_score"), 2), "unit": "/100",
         "detail": f"{row.get('zone_name')} · rank {row.get('rank') or '—'}", "source": "Official score"}
        for row in rows
    ]
    return ToolResult(payload, [_official_evidence(snapshot)], facts, visual)


def _series(records: list[dict[str, Any]], field_name: str, digits: int) -> list[dict[str, Any]]:
    points: dict[int, float] = {}
    for record in records:
        year, value = _num(record.get("year"), 0), _num(record.get(field_name), digits)
        if year is not None and value is not None:
            points[int(year)] = value
    return [{"year": year, "value": points[year]} for year in sorted(points)]


def _summary(points: list[dict[str, Any]], field_name: str, digits: int) -> dict[str, Any]:
    if len(points) < 2:
        return {"status": "Unavailable", "points": len(points)}
    first, last = points[0], points[-1]
    change = round(last["value"] - first["value"], digits)
    threshold = STABLE_THRESHOLDS[field_name]
    status = "Declining" if change <= -threshold else "Improving" if change >= threshold else "Stable"
    relative = None if first["value"] == 0 else round((last["value"] - first["value"]) / abs(first["value"]) * 100, 1)
    return {
        "baseline_year": first["year"], "baseline": first["value"], "latest_year": last["year"], "latest": last["value"],
        "change": change, "relative_change_percent": relative, "status": status, "stable_threshold": threshold,
    }


def vegetation_history(snapshot: AnalysisSnapshot, args: HistoryArgs) -> ToolResult:
    if args.unit == "cell":
        if args.dataset != "sentinel2":
            raise ToolInputError("Cell-level history exists only for Sentinel-2.")
        if not args.cell_id:
            raise ToolInputError("Provide cell_id for cell-level history.")
        if args.cell_id not in snapshot.cells():
            raise ToolInputError(f"Unknown cell '{args.cell_id[:64]}'.")
        records = cell_history_records(cell_id=args.cell_id)
        label, source_file, subject = SENTINEL_LABEL, "thapar_50m_historical_ndvi_2018_2025.csv", f"cell {args.cell_id}"
    elif args.dataset == "landsat":
        frame = load_optional_dataset("landsat_history")
        records = records_from_df(frame) if not frame.empty else []
        label, source_file, subject = LANDSAT_LABEL, "thapar_landsat_historical_zone_ndvi_2014_2025.csv", "zones"
        if not records:
            raise ToolInputError("The optional Landsat history file is not available.")
    else:
        records = records_from_df(load_required_dataset("historical_ndvi"))
        label, source_file, subject = SENTINEL_LABEL, "thapar_historical_zone_ndvi_2018_2025.csv", "zones"

    seasons = sorted({str(record.get("season")) for record in records if record.get("season")})
    base = {
        "dataset": label, "source_file": source_file,
        "season": ", ".join(seasons) if seasons else ("annual" if args.dataset == "landsat" else None),
        "notes": ["Sentinel-2 and Landsat are different sensors; their values are never merged or compared as one series.",
                  "Change is latest minus baseline year; status uses ±0.01 NDVI or ±1 percentage point green cover."],
    }

    if args.unit == "zone" and not args.zone_id:
        by_zone: dict[str, list[dict[str, Any]]] = {}
        for record in records:
            key = zone_key(record.get("zone_id"))
            if key:
                by_zone.setdefault(key, []).append(record)
        zones = []
        for zone_id in sorted(by_zone):
            ndvi = _series(by_zone[zone_id], "mean_ndvi", 4)
            zones.append({"zone_id": zone_id, "zone_name": snapshot.zone_names().get(zone_id, zone_id),
                          "ndvi": _summary(ndvi, "mean_ndvi", 4),
                          "green_cover_percent": _summary(_series(by_zone[zone_id], "green_cover_percent", 2), "green_cover_percent", 2)})
        payload = {**base, "unit": "zone", "zones": zones}
        visual = {
            "type": "table", "title": f"NDVI change by zone · {label}",
            "columns": ["Zone", "Baseline", "Latest", "Change", "Status"],
            "rows": [[f"{zone['zone_id']} · {zone['zone_name']}",
                      f"{_fmt(zone['ndvi'].get('baseline'), 3)} ({zone['ndvi'].get('baseline_year', '—')})",
                      f"{_fmt(zone['ndvi'].get('latest'), 3)} ({zone['ndvi'].get('latest_year', '—')})",
                      _fmt(zone["ndvi"].get("change"), 3, signed=True), zone["ndvi"]["status"]] for zone in zones],
            "source": label,
        }
        years = sorted({point for zone in zones for point in (zone["ndvi"].get("baseline_year"), zone["ndvi"].get("latest_year")) if point})
        detail = f"{years[0]}–{years[-1]}" if years else "years unavailable"
        evidence = [{"id": f"history-{args.dataset}", "label": label, "source": source_file, "detail": detail, "as_of": None}]
        return ToolResult(payload, evidence, [], visual)

    if args.unit == "zone":
        zone_id = snapshot.resolve_zone(args.zone_id)
        records = [record for record in records if zone_key(record.get("zone_id")) == zone_id]
        subject = f"{zone_id} · {snapshot.zone_names().get(zone_id, zone_id)}"
    ndvi = _series(records, "mean_ndvi", 4)[-15:]
    green = _series(records, "green_cover_percent", 2)[-15:]
    if not ndvi:
        raise ToolInputError(f"No {label} records are available for {subject}.")
    summary = _summary(ndvi, "mean_ndvi", 4)
    payload = {**base, "unit": args.unit, "subject": subject, "ndvi_series": ndvi, "green_cover_series": green,
               "ndvi_summary": summary, "green_cover_summary": _summary(green, "green_cover_percent", 2)}
    visual = {"type": "series", "title": f"Mean NDVI · {subject}", "unit": "NDVI", "source": label, "points": ndvi}
    facts = []
    if summary.get("status") != "Unavailable":
        facts.append({"label": f"NDVI change {summary['baseline_year']}→{summary['latest_year']}",
                      "value": _fmt(summary["change"], 3, signed=True), "unit": "", "detail": f"{subject} · {summary['status']}",
                      "source": label})
    evidence = [{"id": f"history-{args.dataset}-{args.unit}", "label": label, "source": source_file,
                 "detail": f"{subject}, {ndvi[0]['year']}–{ndvi[-1]['year']}", "as_of": None}]
    return ToolResult(payload, evidence, facts, visual)


def air_quality_context(snapshot: AnalysisSnapshot, _: NoArgs) -> ToolResult:
    environment = snapshot.environment()
    averages = environment.get("averages_24h") or {}
    current = environment.get("current") or {}
    records = environment.get("records") or []
    pm25 = [value for value in (_num(record.get("pm2_5"), 2) for record in records) if value is not None]
    pm10 = [value for value in (_num(record.get("pm10"), 2) for record in records) if value is not None]
    components = environment.get("stress_components") or {}
    payload = {
        "label": config.AIR_QUALITY_LABEL,
        "source": environment.get("source"),
        "data_mode": "modelled regional estimate (not a campus sensor, not an official AQI, not a forecast)",
        "freshness": environment.get("freshness"),
        "fetched_at_utc": environment.get("fetched_at"),
        "latest_model_time_local": environment.get("last_updated"),
        "timezone": environment.get("timezone"),
        "current": {"pm2_5_ugm3": _num(current.get("pm2_5"), 2), "pm10_ugm3": _num(current.get("pm10"), 2), "time_local": current.get("time")},
        "averages_24h": {
            "pm2_5_ugm3": _num(averages.get("pm2_5"), 2), "pm10_ugm3": _num(averages.get("pm10"), 2),
            "record_count": averages.get("record_count"), "window_start_local": averages.get("window_start"),
            "window_end_local": averages.get("window_end"), "span_hours": averages.get("span_hours"),
            "complete": averages.get("complete"),
        },
        "pm_stress": {
            "score": _num(environment.get("stress_score"), 2), "source": environment.get("pm_stress_source"),
            "pm25_score": _num(components.get("pm25_score"), 2), "pm10_score": _num(components.get("pm10_score"), 2),
            "formula": "0.6 × min(PM2.5 24h mean / 60 × 100, 100) + 0.4 × min(PM10 24h mean / 100 × 100, 100); fallback 60 without data",
        },
        "available_history": {
            "hours": len(records),
            "first_time_local": records[0].get("time") if records else None,
            "last_time_local": records[-1].get("time") if records else None,
            "pm2_5_min": min(pm25) if pm25 else None, "pm2_5_max": max(pm25) if pm25 else None,
            "pm10_min": min(pm10) if pm10 else None, "pm10_max": max(pm10) if pm10 else None,
        },
        "provider_status": environment.get("provider_status"),
        "notes": ["The 60 and 100 µg/m³ caps are project normalisation values, not regulatory limits.",
                  "The same regional PM stress is added to every zone, so it cannot change their relative order."],
    }
    modelled = environment.get("pm_stress_source") == "modelled"
    facts = [
        {"label": "PM2.5 · 24 h mean", "value": _fmt(averages.get("pm2_5"), 1), "unit": "µg/m³", "detail": "Modelled estimate", "source": "Open-Meteo / CAMS"},
        {"label": "PM10 · 24 h mean", "value": _fmt(averages.get("pm10"), 1), "unit": "µg/m³", "detail": "Modelled estimate", "source": "Open-Meteo / CAMS"},
        {"label": "PM stress", "value": _fmt(environment.get("stress_score"), 1), "unit": "/100",
         "detail": "Modelled" if modelled else "Documented fallback", "source": "Project normalisation, not AQI"},
        {"label": "Data freshness", "value": str(environment.get("freshness") or "unknown").capitalize(), "unit": "",
         "detail": f"Model time {environment.get('last_updated') or 'N/A'} (IST)", "source": "Open-Meteo"},
    ]
    evidence = [{
        "id": "air-quality", "label": "Modelled air quality",
        "source": f"{environment.get('source') or 'Open-Meteo / CAMS modelled estimate'}",
        "detail": f"{environment.get('freshness')}; 24 h window {averages.get('window_start') or '—'} to {averages.get('window_end') or '—'} IST",
        "as_of": environment.get("fetched_at"),
    }]
    return ToolResult(payload, evidence, facts)


CELL_FIELDS = [
    ("mean_ndvi", 4), ("green_cover_percent", 2), ("tree_percent", 2), ("grass_percent", 2), ("built_up_percent", 2),
    ("bare_land_percent", 2), ("potential_plantable_percent", 2), ("mean_ndbi", 4), ("mean_ndwi", 4),
    ("cell_area_m2", 1), ("zone_overlap_percent", 3), ("baseline_ndvi", 4), ("latest_ndvi", 4), ("ndvi_change", 4),
]


def cell_details(snapshot: AnalysisSnapshot, args: CellArgs) -> ToolResult:
    properties = snapshot.cells().get(args.cell_id)
    if properties is None:
        raise ToolInputError(f"Unknown cell '{args.cell_id}'. Cell IDs look like 'C_12612,67168'.")
    zone_id = zone_key(properties.get("zone_id"))
    indicators = {name: _num(properties.get(name), digits) for name, digits in CELL_FIELDS}
    payload = {
        "cell_id": args.cell_id,
        "level": "50 m grid cell (indicators only; no official priority score at cell level)",
        "parent_zone": {"zone_id": zone_id, "zone_name": properties.get("zone_name")},
        "indicators": indicators,
        "ndvi_change_years": {"baseline_year": properties.get("baseline_year"), "latest_year": properties.get("latest_year")},
        "sources": {"ndvi/ndbi/ndwi/green_cover": "Sentinel-2 current composite (50 m grid)",
                    "tree/grass/built_up/bare/plantable": "Dynamic World-derived (supporting indicator)",
                    "ndvi_change": "Sentinel-2 seasonal composites (50 m grid history)"},
        "notes": ["Mapped plantable potential is not a validated planting site; it needs ground review.",
                  "The parent zone's official score applies to the whole zone, not to this cell."],
    }
    facts = [
        {"label": "Cell NDVI", "value": _fmt(indicators["mean_ndvi"], 3), "unit": "", "detail": args.cell_id, "source": "Sentinel-2"},
        {"label": "Green cover", "value": _fmt(indicators["green_cover_percent"], 1, "%"), "unit": "", "source": "Sentinel-2"},
        {"label": "Built-up", "value": _fmt(indicators["built_up_percent"], 1, "%"), "unit": "", "source": "Dynamic World"},
        {"label": "Plantable potential", "value": _fmt(indicators["potential_plantable_percent"], 1, "%"), "unit": "",
         "detail": "Not a validated site", "source": "Dynamic World-derived"},
    ]
    evidence = [{"id": f"cell-{args.cell_id}", "label": f"50 m cell {args.cell_id}", "source": "thapar_50m_master_current_2025.csv",
                 "detail": f"Parent zone {zone_id} · indicators only", "as_of": None}]
    return ToolResult(payload, evidence, facts)


def methodology_overview(snapshot: AnalysisSnapshot, _: NoArgs) -> ToolResult:
    method = scoring_methodology()
    payload = {
        **method,
        "official_formula": "Priority = 0.35×LowGreenCover + 0.25×NDVIDecline + 0.20×BuiltUpPressure + 0.10×TreeGap + 0.10×RegionalPMStress",
        "shared_pm_note": "Regional PM stress is one shared value added to every zone; changing only that common term shifts all scores equally and cannot reorder zones.",
        "reason_triggers": "green cover < 60%, NDVI change < -0.05, built-up > 70%, PM stress > 60",
        "limitations": LIMITATIONS,
    }
    facts = [{"label": factor["label"], "value": f"{round(config.SCORING_WEIGHTS[factor['key']] * 100)}%", "unit": "weight", "source": "Official method"} for factor in FACTORS]
    evidence = [{"id": "methodology", "label": "Official scoring methodology", "source": "backend/app/scoring.py · README Priority scoring",
                 "detail": "Weights, formulas, classes, limitations", "as_of": None}]
    return ToolResult(payload, evidence, facts)


def scenario_comparison(snapshot: AnalysisSnapshot, args: ScenarioArgs) -> ToolResult:
    provided = args.model_dump(exclude_none=True)
    if provided:
        weights = {factor["key"]: provided.get(factor["key"], 0.0) for factor in FACTORS}
        origin = "weights supplied in the question"
    elif snapshot.scenario_weights:
        weights = dict(snapshot.scenario_weights)
        origin = "the user's current Scenario Lab weights"
    else:
        raise ToolInputError("No scenario weights were given and the Scenario Lab weights are not in the current context.")
    result = scenario_scores(snapshot.priority(), weights)
    if not result["valid"]:
        raise ToolInputError("All scenario weights are zero, so no hypothetical score can be calculated.")
    payload = {
        "label": "HYPOTHETICAL Scenario Lab result: experimental sensitivity analysis, NOT the official ranking",
        "weights_origin": origin,
        "raw_weights": result["raw_weights"],
        "effective_weights": result["effective_weights"],
        "official_weights": dict(config.SCORING_WEIGHTS),
        "rows": result["rows"],
        "excluded_zones": result["excluded"],
        "all_tied": result["all_tied"],
        "has_ties": result["has_ties"],
        "notes": ["Uses the official component scores unchanged; only the weights differ.",
                  "Equal scenario scores share a rank. A PM-only weighting ties every zone because PM stress is shared."],
    }
    visual = {
        "type": "table", "title": "Hypothetical scenario vs official",
        "columns": ["Zone", "Official", "Scenario", "Rank change"],
        "rows": [[f"{row['zone_id']} · {row['zone_name']}", f"{_fmt(row['official_score'], 2)} (#{row['official_rank']})",
                  f"{_fmt(row['scenario_score'], 2)} (#{row['scenario_rank']})",
                  "tied" if result["all_tied"] else (f"{row['rank_change']:+d}" if row["rank_change"] else "0")] for row in result["rows"]],
        "source": "Scenario Lab (experimental)",
    }
    evidence = [{"id": "scenario", "label": "Scenario Lab (hypothetical)", "source": "Official components re-weighted on the server",
                 "detail": "Experimental; the official ranking is unchanged", "as_of": None}]
    return ToolResult(payload, evidence, [], visual)


def project_methodology(_: AnalysisSnapshot, args: MethodologyArgs) -> ToolResult:
    payload = search_methodology(args.query)
    evidence = [{"id": f"doc-{index}", "label": f"Docs · {item['section']}", "source": item["document"], "detail": "Project documentation", "as_of": None}
                for index, item in enumerate(payload["results"])]
    if payload["map_layer_glossary"] and not evidence:
        evidence.append({"id": "layer-glossary", "label": "Map layer glossary", "source": "Spatial Explorer layer definitions",
                         "detail": ", ".join(item["label"] for item in payload["map_layer_glossary"]), "as_of": None})
    return ToolResult(payload, evidence)


# ---------------------------------------------------------------- registry


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    progress: str
    args_model: type[BaseModel]
    handler: Callable[[AnalysisSnapshot, Any], ToolResult]
    parameters: Callable[[list[str]], dict[str, Any]]


def _no_params(_: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": {}}


def _zone_param(zone_ids: list[str]) -> dict[str, Any]:
    return {"type": "string", "enum": zone_ids, "description": "Analysis zone ID."}


TOOLS: dict[str, ToolSpec] = {
    spec.name: spec
    for spec in [
        ToolSpec("get_campus_overview", "Campus-wide facts: total area, green cover, average NDVI, vegetation classes, zone list, 50 m cell count and history years.",
                 "Reading the campus overview", NoArgs, campus_overview, _no_params),
        ToolSpec("get_zone_rankings", "The current OFFICIAL zone priority ranking: rank, score, class, reason and weighted contributions for every zone, plus the shared PM stress used.",
                 "Fetching the official zone ranking", NoArgs, zone_rankings, _no_params),
        ToolSpec("get_zone_details", "All indicators, NDVI trend and official score components for one analysis zone.",
                 "Fetching zone details", ZoneArgs, zone_details,
                 lambda ids: {"type": "object", "properties": {"zone_id": _zone_param(ids)}, "required": ["zone_id"]}),
        ToolSpec("compare_zones", "Deterministic comparison of 2 or 3 zones: scores, green cover, tree cover, built-up, NDVI, NDVI change, and which weighted factors explain the score gap.",
                 "Comparing zones", CompareArgs, compare_zones,
                 lambda ids: {"type": "object", "properties": {"zone_ids": {"type": "array", "items": _zone_param(ids), "minItems": 2, "maxItems": 3,
                                                                              "description": "Two or three different zone IDs; the first is the reference."}},
                              "required": ["zone_ids"]}),
        ToolSpec("get_vegetation_history", "Historical NDVI and green cover from ONE satellite dataset. dataset=sentinel2 (seasonal Oct-Dec, 2018-2025, primary) or landsat (annual, secondary context). unit=zone with zone_id for one zone, or omit zone_id for a per-zone summary of all zones; unit=cell with cell_id (Sentinel-2 only).",
                 "Fetching vegetation history", HistoryArgs, vegetation_history,
                 lambda ids: {"type": "object", "properties": {
                     "dataset": {"type": "string", "enum": ["sentinel2", "landsat"]},
                     "unit": {"type": "string", "enum": ["zone", "cell"]},
                     "zone_id": _zone_param(ids),
                     "cell_id": {"type": "string", "description": "50 m cell ID such as C_12612,67168 (unit=cell only)."}}}),
        ToolSpec("get_air_quality_context", "Latest modelled PM2.5/PM10 near campus (Open-Meteo/CAMS): current values, 24-hour means and window, PM stress, freshness and fetch time.",
                 "Fetching modelled air quality", NoArgs, air_quality_context, _no_params),
        ToolSpec("get_spatial_cell_details", "Indicators of one 50 m grid cell (NDVI, NDBI, NDWI, land cover, plantable potential, NDVI change) and its parent zone. Cells have no official score.",
                 "Fetching 50 m cell details", CellArgs, cell_details,
                 lambda _: {"type": "object", "properties": {"cell_id": {"type": "string", "description": "Cell ID such as C_12612,67168."}}, "required": ["cell_id"]}),
        ToolSpec("get_scoring_methodology", "The official scoring formula, weights, component formulas, PM rules, class thresholds and scientific limitations.",
                 "Reading the scoring methodology", NoArgs, methodology_overview, _no_params),
        ToolSpec("get_scenario_comparison", "HYPOTHETICAL Scenario Lab comparison: re-weights the official component scores with the given 0-100 weights (normalised to 100%), or with the user's current Scenario Lab weights when none are given. Never the official ranking.",
                 "Calculating the hypothetical scenario", ScenarioArgs, scenario_comparison,
                 lambda _: {"type": "object", "properties": {key: {"type": "number", "minimum": 0, "maximum": 100}
                                                             for key in ("low_green_cover", "ndvi_decline", "built_up_pressure", "tree_gap", "pm_stress")}}),
        ToolSpec("get_project_methodology", "Search allowlisted GreenPulse documentation (overview, datasets, scoring notes, limitations, roadmap) and map layer definitions.",
                 "Searching project documentation", MethodologyArgs, project_methodology,
                 lambda _: {"type": "object", "properties": {"query": {"type": "string", "description": "Short topic, e.g. 'NDBI', 'Landsat', 'limitations'."}}, "required": ["query"]}),
    ]
}


def function_declarations(zone_ids: list[str]) -> list[dict[str, Any]]:
    return [{"name": spec.name, "description": spec.description, "parameters_json_schema": spec.parameters(zone_ids)} for spec in TOOLS.values()]


def _json_default(value: Any) -> Any:
    item = getattr(value, "item", None)  # numpy / pandas scalars
    return item() if callable(item) else str(value)


def _finite_only(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(key): _finite_only(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite_only(item) for item in value]
    return value


def _bounded(payload: dict[str, Any]) -> dict[str, Any]:
    """Plain JSON types only (what the SDK serialises), capped in size."""
    text = json.dumps(_finite_only(payload), default=_json_default, ensure_ascii=False, allow_nan=False)
    if len(text) <= MAX_PAYLOAD_CHARS:
        return json.loads(text)
    return {"truncated": True, "note": "Result shortened to fit the size limit.", "partial_json": text[:MAX_PAYLOAD_CHARS]}


def run_tool(name: str, raw_args: Any, snapshot: AnalysisSnapshot) -> tuple[ToolResult | None, dict[str, Any]]:
    """Validate and execute one tool. Returns (result or None, payload for the model)."""
    spec = TOOLS.get(name)
    if spec is None:
        return None, {"error": f"Unknown tool '{str(name)[:40]}'. Only the declared GreenPulse tools can be used."}
    try:
        args = spec.args_model.model_validate(raw_args if isinstance(raw_args, dict) else {})
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(str(part) for part in error['loc']) or 'arguments'}: {error['msg']}" for error in exc.errors()[:4])
        return None, {"error": f"Invalid arguments for {name}: {problems}"}
    try:
        result = spec.handler(snapshot, args)
    except ToolInputError as exc:
        return None, {"error": str(exc)}
    result.payload = _bounded(result.payload)
    return result, result.payload
