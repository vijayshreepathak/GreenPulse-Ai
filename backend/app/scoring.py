"""Official, deterministic environmental priority scoring for the five campus zones.

The formula is the documented MVP methodology (see config.SCORING_WEIGHTS):

    Priority = 0.35 * LowGreenCover + 0.25 * NDVIDecline + 0.20 * BuiltUpPressure
             + 0.10 * TreeGap + 0.10 * RegionalPMStress

Required zone inputs that are missing or invalid are never converted into a
valid-looking score: the zone is returned with ``score_status = "insufficient_data"``
and a ``None`` score instead.
"""

import math
import re
from typing import Any

import numpy as np

import pandas as pd

from . import config

FACTORS: list[dict[str, str]] = [
    {"key": "low_green_cover", "score_field": "low_green_cover_score", "label": "Low green cover"},
    {"key": "ndvi_decline", "score_field": "ndvi_decline_score", "label": "NDVI decline"},
    {"key": "built_up_pressure", "score_field": "built_up_pressure_score", "label": "Built-up pressure"},
    {"key": "tree_gap", "score_field": "tree_gap_score", "label": "Tree gap"},
    {"key": "pm_stress", "score_field": "pm_stress_score", "label": "Regional PM stress"},
]

REQUIRED_ZONE_INPUTS = ["green_cover_percent", "tree_percent", "built_up_percent", "ndvi_change"]
PERCENT_INPUTS = ["green_cover_percent", "tree_percent", "built_up_percent"]
OPTIONAL_PERCENT_INPUTS = ["grass_percent", "bare_land_percent", "potential_plantable_percent"]


class DataValidationError(ValueError):
    """Raised when a dataset is structurally unusable (for example duplicate zone IDs)."""


def _finite(value: Any) -> float | None:
    parsed = pd.to_numeric(value, errors="coerce")
    if parsed is None or pd.isna(parsed):
        return None
    parsed = float(parsed)
    return parsed if math.isfinite(parsed) else None


def _percent(value: Any) -> float | None:
    parsed = _finite(value)
    if parsed is None:
        return None
    if parsed < -config.PERCENT_TOLERANCE or parsed > 100 + config.PERCENT_TOLERANCE:
        return None
    return min(max(parsed, 0.0), 100.0)


def zone_key(value: Any) -> str | None:
    """Normalise a zone ID so "Z01", " Z01 " and numeric IDs read as 1, 1.0, "1" or "1.0" join consistently."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    if re.fullmatch(r"[+-]?\d+\.0+", text):
        text = text.split(".")[0]
    return text or None


def priority_class(score: float | None) -> str:
    if score is None or not math.isfinite(score):
        return config.PRIORITY_CLASS_UNAVAILABLE
    for upper, label in config.PRIORITY_CLASS_BOUNDS:
        if score <= upper:
            return label
    return config.PRIORITY_CLASS_TOP


def ndvi_decline_score(change: float | None) -> float | None:
    if change is None:
        return None
    if change >= 0:
        return 0.0
    return min(abs(change) / config.NDVI_DECLINE_FULL_SCALE * 100, 100.0)


def pm_stress_components(pm25_avg: float | None, pm10_avg: float | None) -> dict[str, float | None]:
    """Normalised PM stress (0-100). Not a regulatory AQI."""
    if pm25_avg is None or pm10_avg is None:
        return {"pm25_score": None, "pm10_score": None, "stress_score": None}
    pm25_score = min((pm25_avg / config.PM25_FULL_SCALE) * 100, 100.0)
    pm10_score = min((pm10_avg / config.PM10_FULL_SCALE) * 100, 100.0)
    stress = round((config.PM25_STRESS_WEIGHT * pm25_score) + (config.PM10_STRESS_WEIGHT * pm10_score), 2)
    return {"pm25_score": round(pm25_score, 2), "pm10_score": round(pm10_score, 2), "stress_score": stress}


def _normalise_zone_ids(df: pd.DataFrame, dataset: str, issues: list[str]) -> pd.DataFrame:
    if "zone_id" not in df.columns:
        raise DataValidationError(f"{dataset} must include a zone_id column.")
    working = df.copy()
    working["zone_id"] = working["zone_id"].map(zone_key)
    blank = working["zone_id"].isna() | (working["zone_id"] == "")
    if blank.any():
        issues.append(f"{dataset}: {int(blank.sum())} row(s) without a zone_id were ignored.")
        working = working[~blank]
    duplicates = sorted(working.loc[working["zone_id"].duplicated(), "zone_id"].unique().tolist())
    if duplicates:
        raise DataValidationError(f"{dataset} contains duplicate zone_id values: {', '.join(duplicates)}.")
    return working


def historical_ndvi_change(historical_df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Baseline-to-latest Sentinel-2 NDVI change per zone.

    All zones are compared over the same campus-wide baseline and latest years
    (and the same season), so changes are comparable between zones.
    """
    columns = ["zone_id", "first_year", "latest_year", "first_year_mean_ndvi", "latest_year_mean_ndvi", "ndvi_change"]
    issues: list[str] = []
    if historical_df.empty or not {"zone_id", "year", "mean_ndvi"}.issubset(historical_df.columns):
        issues.append("Historical Sentinel-2 NDVI records are unavailable or missing required columns.")
        return pd.DataFrame(columns=columns), issues

    working = historical_df.copy()
    working["zone_id"] = working["zone_id"].map(zone_key)
    working["year"] = pd.to_numeric(working["year"], errors="coerce")
    working["mean_ndvi"] = pd.to_numeric(working["mean_ndvi"], errors="coerce")
    valid = (
        working["zone_id"].notna()
        & (working["zone_id"] != "")
        & np.isfinite(working["year"])
        & working["mean_ndvi"].between(-1, 1)
    )
    if (~valid).any():
        issues.append(f"Historical NDVI: {int((~valid).sum())} invalid record(s) were ignored.")
    working = working[valid]

    if "season" in working.columns and working["season"].nunique(dropna=True) > 1:
        latest_season = working.sort_values("year").iloc[-1]["season"]
        issues.append(f"Historical NDVI contains several seasons; only '{latest_season}' composites are compared.")
        working = working[working["season"] == latest_season]

    if working.empty:
        return pd.DataFrame(columns=columns), issues

    baseline_year = int(working["year"].min())
    latest_year = int(working["year"].max())
    if baseline_year == latest_year:
        issues.append("Historical NDVI covers a single year, so NDVI change cannot be calculated.")
        return pd.DataFrame(columns=columns), issues

    rows = []
    for zone_id, group in working.groupby("zone_id", sort=True):
        baseline = group[group["year"] == baseline_year]["mean_ndvi"]
        latest = group[group["year"] == latest_year]["mean_ndvi"]
        if len(baseline) != 1 or len(latest) != 1:
            reason = "duplicate" if len(baseline) > 1 or len(latest) > 1 else "missing"
            issues.append(f"{zone_id}: {reason} {baseline_year}/{latest_year} NDVI record(s); NDVI change unavailable.")
            continue
        first_value = float(baseline.iloc[0])
        latest_value = float(latest.iloc[0])
        rows.append(
            {
                "zone_id": zone_id,
                "first_year": baseline_year,
                "latest_year": latest_year,
                "first_year_mean_ndvi": round(first_value, 4),
                "latest_year_mean_ndvi": round(latest_value, 4),
                "ndvi_change": round(latest_value - first_value, 4),
            }
        )
    return pd.DataFrame(rows, columns=columns), issues


def _reason(row: dict[str, Any]) -> str:
    if row["score_status"] != "ok":
        return f"Score unavailable: missing or invalid {', '.join(row['missing_inputs'])}."
    drivers = []
    if row["green_cover_percent"] < 60:
        drivers.append("low green-cover percentage")
    if row["ndvi_change"] < -0.05:
        drivers.append("declining NDVI trend")
    if row["built_up_percent"] > 70:
        drivers.append("high built-up pressure")
    if row["pm_stress_score"] > 60:
        drivers.append("elevated regional PM stress")

    if not drivers:
        return "Zone has relatively stable vegetation and lower intervention priority."
    if len(drivers) == 1:
        return f"Priority is driven by {drivers[0]}."
    return f"Priority is driven by {', '.join(drivers[:-1])}, and {drivers[-1]}."


def _resolve_pm_stress(pm_stress_score: float | None, source: str | None) -> tuple[float, str]:
    value = _finite(pm_stress_score)
    if value is None:
        return round(config.DEFAULT_AQI_STRESS_SCORE, 2), "fallback"
    return round(min(max(value, 0.0), 100.0), 2), source or "modelled"


def score_zones(
    zone_ndvi_df: pd.DataFrame,
    land_cover_df: pd.DataFrame,
    historical_df: pd.DataFrame,
    pm_stress_score: float | None = None,
    *,
    pm_stress_source: str | None = None,
) -> tuple[pd.DataFrame, list[str]]:
    issues: list[str] = []
    zones = _normalise_zone_ids(zone_ndvi_df, "thapar_zone_ndvi_green_cover.csv", issues)
    land = _normalise_zone_ids(land_cover_df, "thapar_zone_land_cover.csv", issues)

    missing_land = sorted(set(zones["zone_id"]) - set(land["zone_id"]))
    if missing_land:
        issues.append(f"Land-cover records missing for: {', '.join(missing_land)}.")

    merged = zones.merge(land, on="zone_id", how="left", suffixes=("", "_land_cover"))
    if "zone_name" not in merged.columns and "zone_name_land_cover" in merged.columns:
        merged["zone_name"] = merged["zone_name_land_cover"]

    trend, trend_issues = historical_ndvi_change(historical_df)
    issues.extend(trend_issues)
    merged = merged.merge(trend, on="zone_id", how="left")

    pm_value, pm_source = _resolve_pm_stress(pm_stress_score, pm_stress_source)
    weights = config.SCORING_WEIGHTS

    rows: list[dict[str, Any]] = []
    for record in merged.to_dict(orient="records"):
        row: dict[str, Any] = {
            "zone_id": record["zone_id"],
            "zone_name": record.get("zone_name") if isinstance(record.get("zone_name"), str) else record["zone_id"],
            "zone_area_hectares": _finite(record.get("zone_area_hectares")),
            "mean_ndvi": _finite(record.get("mean_ndvi")),
            "vegetation_status": record.get("vegetation_status") if isinstance(record.get("vegetation_status"), str) else None,
        }
        for field in PERCENT_INPUTS + OPTIONAL_PERCENT_INPUTS:
            row[field] = _percent(record.get(field))
            if row[field] is None and _finite(record.get(field)) is not None:
                issues.append(f"{row['zone_id']}: {field} is outside 0-100 and was treated as unavailable.")
        for field in ["first_year", "latest_year"]:
            value = _finite(record.get(field))
            row[field] = int(value) if value is not None else None
        for field in ["first_year_mean_ndvi", "latest_year_mean_ndvi", "ndvi_change"]:
            row[field] = _finite(record.get(field))

        row["low_green_cover_score"] = None if row["green_cover_percent"] is None else 100 - row["green_cover_percent"]
        row["tree_gap_score"] = None if row["tree_percent"] is None else 100 - row["tree_percent"]
        row["built_up_pressure_score"] = row["built_up_percent"]
        row["ndvi_decline_score"] = ndvi_decline_score(row["ndvi_change"])
        row["pm_stress_score"] = pm_value
        row["pm_stress_source"] = pm_source

        row["missing_inputs"] = [field for field in REQUIRED_ZONE_INPUTS if row[field] is None]
        row["score_status"] = "ok" if not row["missing_inputs"] else "insufficient_data"

        if row["score_status"] == "ok":
            total = 0.0
            for factor in FACTORS:
                contribution = weights[factor["key"]] * row[factor["score_field"]]
                row[f"contribution_{factor['key']}"] = round(contribution, 4)
                total += contribution
            row["priority_score"] = round(total, 2)
        else:
            for factor in FACTORS:
                component = row[factor["score_field"]]
                row[f"contribution_{factor['key']}"] = (
                    None if component is None else round(weights[factor["key"]] * component, 4)
                )
            row["priority_score"] = None

        for factor in FACTORS:
            if row[factor["score_field"]] is not None:
                row[factor["score_field"]] = round(row[factor["score_field"]], 4)
        row["aqi_stress_score"] = pm_value  # deprecated alias kept for API compatibility
        row["priority_class"] = priority_class(row["priority_score"])
        row["reason"] = _reason(row)
        rows.append(row)

    scored = sorted(
        (row for row in rows if row["priority_score"] is not None),
        key=lambda row: (-row["priority_score"], row["zone_id"]),
    )
    unscored = sorted((row for row in rows if row["priority_score"] is None), key=lambda row: row["zone_id"])
    for index, row in enumerate(scored, start=1):
        row["rank"] = index
    for row in unscored:
        row["rank"] = None

    columns = [
        "rank", "zone_id", "zone_name", "zone_area_hectares", "mean_ndvi", "vegetation_status",
        "green_cover_percent", "tree_percent", "grass_percent", "built_up_percent", "bare_land_percent",
        "potential_plantable_percent", "first_year", "latest_year", "first_year_mean_ndvi",
        "latest_year_mean_ndvi", "ndvi_change", "low_green_cover_score", "ndvi_decline_score",
        "built_up_pressure_score", "tree_gap_score", "pm_stress_score", "aqi_stress_score",
        "pm_stress_source", *[f"contribution_{factor['key']}" for factor in FACTORS],
        "priority_score", "priority_class", "score_status", "missing_inputs", "reason",
    ]
    table = pd.DataFrame(scored + unscored, columns=columns)
    # Nullable integers, so an unscored zone does not turn every rank into 1.0 in JSON and CSV.
    for column in ("rank", "first_year", "latest_year"):
        table[column] = table[column].astype("Int64")
    return table, issues


SCENARIO_TIE_TOLERANCE = 1e-9


def _competition_ranks(scores: dict[str, float]) -> dict[str, int]:
    """Equal scores (within the tolerance) share a rank: 1, 2, 2, 4."""
    return {
        zone_id: 1 + sum(1 for other in scores.values() if other > score + SCENARIO_TIE_TOLERANCE)
        for zone_id, score in scores.items()
    }


def scenario_scores(rows: list[dict[str, Any]], raw_weights: dict[str, Any]) -> dict[str, Any]:
    """Hypothetical re-weighting of the official component scores (the Scenario Lab rule).

    Same semantics as frontend/src/lib/scenario.js: weights are clamped to 0-100 and normalised to
    sum to 1; component scores come unchanged from ``score_zones``; zones without an official
    score are excluded; equal unrounded scores share a rank. The official ranking is not touched.
    """
    cleaned: dict[str, float] = {}
    for factor in FACTORS:
        value = raw_weights.get(factor["key"]) if isinstance(raw_weights, dict) else None
        number = None if isinstance(value, bool) else _finite(value)
        cleaned[factor["key"]] = 0.0 if number is None else min(max(number, 0.0), 100.0)
    total = sum(cleaned.values())
    if not total > 0:
        return {"valid": False, "raw_weights": cleaned, "effective_weights": None, "rows": [], "excluded": []}
    effective = {key: value / total for key, value in cleaned.items()}

    usable: list[dict[str, Any]] = []
    excluded: list[str] = []
    for row in rows:
        components = {factor["key"]: _finite(row.get(factor["score_field"])) for factor in FACTORS}
        if _finite(row.get("priority_score")) is None or any(value is None for value in components.values()):
            excluded.append(str(row.get("zone_id")))
            continue
        official_raw = sum(config.SCORING_WEIGHTS[key] * value for key, value in components.items())
        simulated_raw = sum(effective[key] * value for key, value in components.items())
        drivers = sorted(
            (
                {"factor": factor["key"], "label": factor["label"],
                 "delta": round((effective[factor["key"]] - config.SCORING_WEIGHTS[factor["key"]]) * components[factor["key"]], 2)}
                for factor in FACTORS
            ),
            key=lambda item: -abs(item["delta"]),
        )
        usable.append({
            "zone_id": row.get("zone_id"),
            "zone_name": row.get("zone_name") or row.get("zone_id"),
            "official_score": _finite(row.get("priority_score")),
            "scenario_score": round(simulated_raw, 2),
            "score_change": round(simulated_raw - _finite(row.get("priority_score")), 2),
            "_official_raw": official_raw,
            "_simulated_raw": simulated_raw,
            "main_driver": drivers[0],
        })

    official_ranks = _competition_ranks({row["zone_id"]: row["_official_raw"] for row in usable})
    scenario_ranks = _competition_ranks({row["zone_id"]: row["_simulated_raw"] for row in usable})
    for row in usable:
        row["official_rank"] = official_ranks[row["zone_id"]]
        row["scenario_rank"] = scenario_ranks[row["zone_id"]]
        row["rank_change"] = row["official_rank"] - row["scenario_rank"]
        row["tied"] = sum(1 for rank in scenario_ranks.values() if rank == row["scenario_rank"]) > 1
        del row["_official_raw"], row["_simulated_raw"]
    usable.sort(key=lambda row: (row["scenario_rank"], row["official_rank"], str(row["zone_id"])))
    distinct = len(set(scenario_ranks.values()))
    return {
        "valid": True,
        "raw_weights": cleaned,
        "effective_weights": {key: round(value, 4) for key, value in effective.items()},
        "rows": usable,
        "excluded": excluded,
        "has_ties": distinct < len(usable),
        "all_tied": len(usable) > 1 and distinct == 1,
    }


def build_priority_table(
    zone_ndvi_df: pd.DataFrame,
    land_cover_df: pd.DataFrame,
    historical_df: pd.DataFrame,
    aqi_stress_score: float | None = None,
    *,
    pm_stress_source: str | None = None,
) -> pd.DataFrame:
    table, _ = score_zones(
        zone_ndvi_df, land_cover_df, historical_df, aqi_stress_score, pm_stress_source=pm_stress_source
    )
    return table


def priority_table_for_csv(table: pd.DataFrame) -> pd.DataFrame:
    export = table.copy()
    export["missing_inputs"] = export["missing_inputs"].map(lambda values: "; ".join(values) if values else "")
    return export


def scoring_methodology() -> dict[str, Any]:
    return {
        "method": "Transparent rule-based weighted score (not machine learning).",
        "level": "zone",
        "weights": dict(config.SCORING_WEIGHTS),
        "factors": [
            {**factor, "weight": config.SCORING_WEIGHTS[factor["key"]]} for factor in FACTORS
        ],
        "formulas": {
            "low_green_cover": "100 - green_cover_percent",
            "ndvi_decline": f"0 if NDVI change >= 0, else min(|change| / {config.NDVI_DECLINE_FULL_SCALE} * 100, 100)",
            "built_up_pressure": "built_up_percent",
            "tree_gap": "100 - tree_percent",
            "pm_stress": (
                f"{config.PM25_STRESS_WEIGHT} * min(PM2.5 avg / {config.PM25_FULL_SCALE:g} * 100, 100) + "
                f"{config.PM10_STRESS_WEIGHT} * min(PM10 avg / {config.PM10_FULL_SCALE:g} * 100, 100)"
            ),
        },
        "pm": {
            "averaging_records": config.PM_AVERAGING_RECORDS,
            "pm25_full_scale": config.PM25_FULL_SCALE,
            "pm10_full_scale": config.PM10_FULL_SCALE,
            "pm25_weight": config.PM25_STRESS_WEIGHT,
            "pm10_weight": config.PM10_STRESS_WEIGHT,
            "fallback_score": config.DEFAULT_AQI_STRESS_SCORE,
        },
        "ndvi_decline_full_scale": config.NDVI_DECLINE_FULL_SCALE,
        "classes": [
            {"label": "Low", "min": 0, "max": 30},
            {"label": "Moderate", "min": 30, "max": 50},
            {"label": "High", "min": 50, "max": 70},
            {"label": "Urgent", "min": 70, "max": 100},
        ],
        "class_rule": "Upper bounds are inclusive: score <= 30 Low, <= 50 Moderate, <= 70 High, otherwise Urgent.",
    }
