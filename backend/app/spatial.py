import json
from typing import Any

import pandas as pd

from .data_loader import clean_value, load_optional_dataset, records_from_df


def _cell_change(history: pd.DataFrame) -> pd.DataFrame:
    required = {"cell_id", "year", "mean_ndvi"}
    if history.empty or not required.issubset(history.columns):
        return pd.DataFrame(columns=["cell_id", "baseline_ndvi", "latest_ndvi", "ndvi_change"])

    working = history.copy()
    working["year"] = pd.to_numeric(working["year"], errors="coerce")
    working["mean_ndvi"] = pd.to_numeric(working["mean_ndvi"], errors="coerce")
    working = working.dropna(subset=["cell_id", "year", "mean_ndvi"]).sort_values(["cell_id", "year"])

    rows: list[dict[str, Any]] = []
    for cell_id, group in working.groupby("cell_id"):
        first = group.iloc[0]
        latest = group.iloc[-1]
        rows.append(
            {
                "cell_id": cell_id,
                "baseline_year": int(first["year"]),
                "latest_year": int(latest["year"]),
                "baseline_ndvi": round(float(first["mean_ndvi"]), 4),
                "latest_ndvi": round(float(latest["mean_ndvi"]), 4),
                "ndvi_change": round(float(latest["mean_ndvi"] - first["mean_ndvi"]), 4),
            }
        )
    return pd.DataFrame(rows)


def load_cell_features() -> pd.DataFrame:
    current = load_optional_dataset("cell_current")
    if current.empty:
        return current

    history = load_optional_dataset("cell_history")
    change = _cell_change(history)
    if not change.empty:
        current = current.merge(change, on="cell_id", how="left")
    return current


def cell_feature_collection() -> dict[str, Any]:
    cells = load_cell_features()
    features: list[dict[str, Any]] = []

    for _, row in cells.iterrows():
        geometry = None
        raw_geometry = row.get(".geo")
        if isinstance(raw_geometry, str) and raw_geometry.strip():
            try:
                geometry = json.loads(raw_geometry)
            except json.JSONDecodeError:
                geometry = None

        properties = {
            key: clean_value(value)
            for key, value in row.to_dict().items()
            if key not in {".geo", "system:index"}
        }
        if geometry:
            features.append(
                {
                    "type": "Feature",
                    "id": properties.get("cell_id"),
                    "properties": properties,
                    "geometry": geometry,
                }
            )

    return {
        "count": int(len(cells)),
        "available": bool(features),
        "geojson": {"type": "FeatureCollection", "features": features},
    }


def spatial_summary() -> dict[str, Any]:
    current = load_optional_dataset("cell_current")
    history = load_optional_dataset("cell_history")

    years: list[int] = []
    if not history.empty and "year" in history.columns:
        numeric_years = pd.to_numeric(history["year"], errors="coerce").dropna().astype(int)
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
        history = history[history["cell_id"].astype(str) == str(cell_id)]
    if zone_id:
        history = history[history["zone_id"].astype(str) == str(zone_id)]

    sort_columns = [column for column in ["cell_id", "year"] if column in history.columns]
    if sort_columns:
        history = history.sort_values(sort_columns)
    return records_from_df(history)
