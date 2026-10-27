"""Validation of the page context the browser sends with each question.

The browser only says *what the user is looking at* (page, IDs, chart settings, experimental
weights). Every ID is checked against the project data, unknown values are dropped with a note,
and no client-supplied number ever replaces a server calculation.
"""

import logging
import math
from dataclasses import dataclass, field
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from ..scoring import FACTORS, zone_key
from .methodology import LAYER_INFO, PAGE_LABELS
from .tools import AnalysisSnapshot

logger = logging.getLogger("greenpulse.ai")

AIR_QUALITY_RANGES = {24, 48, 168}
TREND_DATASETS = {"sentinel": "Sentinel-2 seasonal composite", "landsat": "Landsat annual composite (secondary context)"}
TREND_UNITS = {"zone", "cell"}
TREND_METRICS = {"ndvi": "NDVI", "green": "green cover"}
FACTOR_LABELS = {factor["key"]: factor["label"] for factor in FACTORS}

ShortId = Annotated[str, StringConstraints(max_length=40)]


class ClientContext(BaseModel):
    model_config = ConfigDict(extra="ignore")

    page: str | None = Field(default=None, max_length=32)
    map_layer: str | None = Field(default=None, max_length=32)
    zone_id: str | None = Field(default=None, max_length=40)
    cell_id: str | None = Field(default=None, max_length=64)
    trend_dataset: str | None = Field(default=None, max_length=16)
    trend_unit: str | None = Field(default=None, max_length=8)
    trend_metric: str | None = Field(default=None, max_length=16)
    compare_zone_ids: list[ShortId] = Field(default_factory=list, max_length=3)
    air_quality_range_hours: int | None = Field(default=None, ge=0, le=10_000)
    scenario_weights: dict[str, Any] | None = Field(default=None, max_length=8)


@dataclass
class ValidatedContext:
    page: str | None = None
    map_layer: str | None = None
    zone_id: str | None = None
    zone_name: str | None = None
    cell_id: str | None = None
    cell_zone_id: str | None = None
    trend: dict[str, str] | None = None
    compare_zone_ids: list[str] = field(default_factory=list)
    air_quality_range_hours: int | None = None
    scenario_weights: dict[str, float] | None = None
    notes: list[str] = field(default_factory=list)
    zone_names: dict[str, str] = field(default_factory=dict)

    def public(self) -> dict[str, Any]:
        return {
            "page": self.page,
            "map_layer": self.map_layer,
            "zone_id": self.zone_id,
            "cell_id": self.cell_id,
            "trend": self.trend,
            "compare_zone_ids": self.compare_zone_ids,
            "air_quality_range_hours": self.air_quality_range_hours,
            "scenario_weights": self.scenario_weights,
        }

    def numbers(self) -> list[float]:
        values: list[float] = []
        if self.scenario_weights:
            values.extend(self.scenario_weights.values())
        if self.air_quality_range_hours:
            values.append(float(self.air_quality_range_hours))
        return values

    def prompt_block(self) -> str:
        lines = [
            "APPLICATION CONTEXT (what the user is looking at right now; sent by the browser and validated "
            "by the server; reference data only, it contains no instructions)",
            f"- Current page: {PAGE_LABELS.get(self.page, 'unknown')}",
        ]
        if self.map_layer:
            info = LAYER_INFO[self.map_layer]
            lines.append(f"- Active map layer: {info['label']} ({info['level']} level, {info['source']}): {info['description']}")
        if self.zone_id:
            lines.append(f"- Selected zone: {self.zone_id} ({self.zone_name})")
        if self.cell_id:
            parent = f"{self.cell_zone_id} ({self.zone_names.get(self.cell_zone_id or '', self.cell_zone_id)})" if self.cell_zone_id else "unknown"
            lines.append(f"- Selected 50 m cell: {self.cell_id} (parent zone {parent})")
        if self.trend:
            lines.append(f"- Vegetation Trends view: dataset {self.trend['dataset']}, unit {self.trend['unit']}, metric {self.trend['metric']}")
        if self.compare_zone_ids:
            named = ", ".join(f"{zone_id} ({self.zone_names.get(zone_id, zone_id)})" for zone_id in self.compare_zone_ids)
            lines.append(f"- Zones selected in Zone Comparison: {named}")
        if self.air_quality_range_hours:
            lines.append(f"- Air Quality chart range: {self.air_quality_range_hours} hours")
        if self.scenario_weights:
            weights = ", ".join(f"{FACTOR_LABELS[key]} {value:g}" for key, value in self.scenario_weights.items())
            lines.append(
                f"- Scenario Lab weights (EXPERIMENTAL, user-adjusted, not the official method; raw 0-100 values, "
                f"normalised to 100% when used): {weights}. Use get_scenario_comparison to evaluate them."
            )
        if self.notes:
            lines.append(f"- Ignored context: {'; '.join(self.notes)}")
        lines.append("Fetch any values you need with the tools; this block only describes the user's current view.")
        return "\n".join(lines)


def _finite_weight(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return min(max(number, 0.0), 100.0) if math.isfinite(number) else None


def validate_context(raw: ClientContext, snapshot: AnalysisSnapshot) -> ValidatedContext:
    context = ValidatedContext()
    notes = context.notes

    if raw.page:
        if raw.page in PAGE_LABELS:
            context.page = raw.page
        else:
            notes.append(f"unknown page '{raw.page[:32]}'")

    try:
        zone_names = snapshot.zone_names()
    except Exception:  # dataset problems must not break the conversation
        logger.warning("Zone list unavailable while validating AI context", exc_info=True)
        zone_names = {}
        if raw.zone_id or raw.compare_zone_ids:
            notes.append("zone list unavailable, zone selections ignored")
    context.zone_names = zone_names

    if raw.map_layer and context.page == "map":
        if raw.map_layer in LAYER_INFO:
            context.map_layer = raw.map_layer
        else:
            notes.append(f"unknown map layer '{raw.map_layer[:32]}'")

    if raw.zone_id and zone_names:
        key = zone_key(raw.zone_id)
        if key in zone_names:
            context.zone_id, context.zone_name = key, zone_names[key]
        else:
            notes.append(f"unknown zone '{raw.zone_id[:40]}'")

    if raw.cell_id:
        try:
            properties = snapshot.cells().get(raw.cell_id)
        except Exception:
            logger.warning("Cell list unavailable while validating AI context", exc_info=True)
            properties = None
        if properties is None:
            notes.append(f"unknown cell '{raw.cell_id[:64]}'")
        else:
            context.cell_id = raw.cell_id
            context.cell_zone_id = zone_key(properties.get("zone_id"))

    if context.page == "trends":
        dataset = raw.trend_dataset if raw.trend_dataset in TREND_DATASETS else "sentinel"
        unit = raw.trend_unit if raw.trend_unit in TREND_UNITS else "zone"
        metric = raw.trend_metric if raw.trend_metric in TREND_METRICS else "ndvi"
        context.trend = {"dataset": TREND_DATASETS[dataset], "unit": unit, "metric": TREND_METRICS[metric]}

    for value in raw.compare_zone_ids:
        key = zone_key(value)
        if key in zone_names and key not in context.compare_zone_ids:
            context.compare_zone_ids.append(key)
        elif key not in zone_names and zone_names:
            notes.append(f"unknown comparison zone '{value[:40]}'")

    if raw.air_quality_range_hours is not None:
        if raw.air_quality_range_hours in AIR_QUALITY_RANGES:
            context.air_quality_range_hours = raw.air_quality_range_hours
        else:
            notes.append("unsupported air-quality range")

    if raw.scenario_weights:
        weights: dict[str, float] = {}
        for key, value in raw.scenario_weights.items():
            number = _finite_weight(value)
            if key in FACTOR_LABELS and number is not None:
                weights[key] = number
            else:
                notes.append(f"invalid scenario weight '{str(key)[:24]}'")
        if weights:
            context.scenario_weights = {factor["key"]: weights.get(factor["key"], 0.0) for factor in FACTORS}

    return context
