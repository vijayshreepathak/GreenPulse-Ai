import json
import logging
import math
from typing import Any

import numpy as np
import pandas as pd

from . import config
from .data_loader import clean_value, load_optional_dataset, raw_path, records_from_df

logger = logging.getLogger("greenpulse.spatial")

_feature_cache: dict[str, Any] = {"key": None, "payload": None}


def _valid_position(position: Any) -> bool:
    """A finite [longitude, latitude] pair inside the WGS84 range."""
    if not isinstance(position, (list, tuple)) or len(position) < 2:
        return False
    lon, lat = position[0], position[1]
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in (lon, lat)):
        return False
    return -180 <= lon <= 180 and -90 <= lat <= 90


def _valid_ring(ring: Any) -> bool:
    return isinstance(ring, list) and len(ring) >= 4 and all(_valid_position(position) for position in ring)


def valid_geometry(geometry: Any) -> bool:
    if not isinstance(geometry, dict):
        return False
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "Polygon":
        return isinstance(coordinates, list) and bool(coordinates) and all(_valid_ring(ring) for ring in coordinates)
    if geometry.get("type") == "MultiPolygon":
        return (
            isinstance(coordinates, list)
            and bool(coordinates)
            and all(isinstance(polygon, list) and polygon and all(_valid_ring(ring) for ring in polygon) for polygon in coordinates)
        )
    return False


def _cell_change(history: pd.DataFrame) -> pd.DataFrame:
    columns = ["cell_id", "baseline_year", "latest_year", "baseline_ndvi", "latest_ndvi", "ndvi_change"]
    if history.empty or not {"cell_id", "year", "mean_ndvi"}.issubset(history.columns):
        return pd.DataFrame(columns=columns)

    working = history.copy()
    working["cell_id"] = working["cell_id"].astype(str)
    working["year"] = pd.to_numeric(working["year"], errors="coerce")
    working["mean_ndvi"] = pd.to_numeric(working["mean_ndvi"], errors="coerce")
    working = working[np.isfinite(working["year"]) & working["mean_ndvi"].between(-1, 1)]
    if working.empty:
        return pd.DataFrame(columns=columns)

    baseline_year = int(working["year"].min())
    latest_year = int(working["year"].max())
    if baseline_year == latest_year:
        return pd.DataFrame(columns=columns)

    baseline = working[working["year"] == baseline_year].groupby("cell_id")["mean_ndvi"].agg(["first", "count"])
    latest = working[working["year"] == latest_year].groupby("cell_id")["mean_ndvi"].agg(["first", "count"])
    joined = baseline.merge(latest, left_index=True, right_index=True, how="inner", suffixes=("_baseline", "_latest"))
    joined = joined[(joined["count_baseline"] == 1) & (joined["count_latest"] == 1)]

    return pd.DataFrame(
        {
            "cell_id": joined.index,
            "baseline_year": baseline_year,
            "latest_year": latest_year,
            "baseline_ndvi": joined["first_baseline"].round(4).values,
            "latest_ndvi": joined["first_latest"].round(4).values,
            "ndvi_change": (joined["first_latest"] - joined["first_baseline"]).round(4).values,
        },
        columns=columns,
    )


def load_cell_features() -> pd.DataFrame:
    current = load_optional_dataset("cell_current")
    if current.empty or "cell_id" not in current.columns:
        return pd.DataFrame()
    current = current.copy()
    current["cell_id"] = current["cell_id"].astype(str)

    change = _cell_change(load_optional_dataset("cell_history"))
    if not change.empty:
        current = current.merge(change, on="cell_id", how="left")
    return current


def _source_key() -> tuple:
    key = []
    for name in (config.OPTIONAL_FILES["cell_current"], config.OPTIONAL_FILES["cell_history"]):
        path = raw_path(name)
        key.append((str(path), path.stat().st_mtime_ns if path.exists() else None))
    return tuple(key)


def cell_feature_collection() -> dict[str, Any]:
    key = _source_key()
    if _feature_cache["key"] == key and _feature_cache["payload"] is not None:
        return _feature_cache["payload"]

    cells = load_cell_features()
    features: list[dict[str, Any]] = []
    invalid = 0
    for row in cells.to_dict(orient="records") if not cells.empty else []:
        geometry = None
        raw_geometry = row.get(".geo")
        if isinstance(raw_geometry, str) and raw_geometry.strip():
            try:
                geometry = json.loads(raw_geometry)
            except json.JSONDecodeError:
                geometry = None
        if not valid_geometry(geometry):
            invalid += 1
            continue
        properties = {name: clean_value(value) for name, value in row.items() if name not in {".geo", "system:index"}}
        features.append({"type": "Feature", "id": properties.get("cell_id"), "properties": properties, "geometry": geometry})

    if invalid:
        logger.warning("Skipped %s cell(s) with missing or invalid geometry", invalid)
    payload = {
        "count": len(features),
        "source_rows": int(len(cells)),
        "skipped_invalid_geometry": invalid,
        "available": bool(features),
        "level": "cell",
        "note": "50 m cells carry environmental indicators only; the official priority score is calculated per zone.",
        "geojson": {"type": "FeatureCollection", "features": features},
    }
    _feature_cache.update(key=key, payload=payload)
    return payload


def spatial_summary() -> dict[str, Any]:
    current = load_optional_dataset("cell_current")
    history = load_optional_dataset("cell_history")

    years: list[int] = []
    if not history.empty and "year" in history.columns:
        numeric_years = pd.to_numeric(history["year"], errors="coerce")
        numeric_years = numeric_years[np.isfinite(numeric_years)].astype(int)
        years = sorted(numeric_years.unique().tolist())

    seasons: list[str] = []
    if not history.empty and "season" in history.columns:
        seasons = sorted(history["season"].dropna().astype(str).unique().tolist())

    return {
        "cell_count": int(current["cell_id"].nunique()) if "cell_id" in current.columns else int(len(current)),
        "historical_record_count": int(len(history)),
        "zone_count": int(current["zone_id"].nunique()) if "zone_id" in current.columns else 0,
        "years": years,
        "season": seasons[0] if len(seasons) == 1 else ", ".join(seasons),
        "latest_satellite_year": years[-1] if years else None,
        "grid_resolution_m": 50,
    }


def cell_history_records(cell_id: str | None = None, zone_id: str | None = None) -> list[dict[str, Any]]:
    history = load_optional_dataset("cell_history")
    if history.empty:
        return []

    if cell_id:
        if "cell_id" not in history.columns:
            return []
        history = history[history["cell_id"].astype(str) == str(cell_id)]
    if zone_id:
        if "zone_id" not in history.columns:
            return []
        history = history[history["zone_id"].astype(str) == str(zone_id)]

    sort_columns = [column for column in ["cell_id", "year"] if column in history.columns]
    if sort_columns:
        history = history.sort_values(sort_columns, kind="mergesort")
    return records_from_df(history)
