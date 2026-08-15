import pandas as pd

from .config import DEFAULT_AQI_STRESS_SCORE, PROCESSED_PRIORITY_FILE


def _number(value, default: float = 0.0) -> float:
    parsed = pd.to_numeric(value, errors="coerce")
    if pd.isna(parsed):
        return default
    return float(parsed)


def _numeric_column(df: pd.DataFrame, column: str, default: float = 0.0) -> pd.Series:
    if column not in df.columns:
        return pd.Series(default, index=df.index)
    return pd.to_numeric(df[column], errors="coerce").fillna(default)


def priority_class(score: float) -> str:
    if score <= 30:
        return "Low"
    if score <= 50:
        return "Moderate"
    if score <= 70:
        return "High"
    return "Urgent"


def _reason(row: pd.Series) -> str:
    drivers = []
    if _number(row.get("green_cover_percent")) < 60:
        drivers.append("low green-cover percentage")
    if _number(row.get("ndvi_change")) < -0.05:
        drivers.append("declining NDVI trend")
    if _number(row.get("built_up_percent")) > 70:
        drivers.append("high built-up pressure")
    if _number(row.get("aqi_stress_score"), DEFAULT_AQI_STRESS_SCORE) > 60:
        drivers.append("elevated PM/AQI stress")

    if not drivers:
        return "Zone has relatively stable vegetation and lower intervention priority."
    if len(drivers) == 1:
        return f"Priority is driven by {drivers[0]}."
    return f"Priority is driven by {', '.join(drivers[:-1])}, and {drivers[-1]}."


def _historical_change_by_zone(historical_df: pd.DataFrame) -> pd.DataFrame:
    if historical_df.empty or "zone_id" not in historical_df.columns or "mean_ndvi" not in historical_df.columns:
        return pd.DataFrame(columns=["zone_id", "first_year_mean_ndvi", "latest_year_mean_ndvi", "ndvi_change"])

    working = historical_df.copy()
    working["year"] = pd.to_numeric(working.get("year"), errors="coerce")
    working["mean_ndvi"] = pd.to_numeric(working["mean_ndvi"], errors="coerce")
    working = working.dropna(subset=["zone_id", "year", "mean_ndvi"]).sort_values(["zone_id", "year"])

    rows = []
    for zone_id, group in working.groupby("zone_id"):
        first = group.iloc[0]
        latest = group.iloc[-1]
        rows.append(
            {
                "zone_id": zone_id,
                "first_year": int(first["year"]),
                "latest_year": int(latest["year"]),
                "first_year_mean_ndvi": round(float(first["mean_ndvi"]), 4),
                "latest_year_mean_ndvi": round(float(latest["mean_ndvi"]), 4),
                "ndvi_change": round(float(latest["mean_ndvi"] - first["mean_ndvi"]), 4),
            }
        )
    return pd.DataFrame(rows)


def build_priority_table(
    zone_ndvi_df: pd.DataFrame,
    land_cover_df: pd.DataFrame,
    historical_df: pd.DataFrame,
    aqi_stress_score: float | None = None,
) -> pd.DataFrame:
    if "zone_id" not in zone_ndvi_df.columns:
        raise ValueError("thapar_zone_ndvi_green_cover.csv must include a zone_id column.")
    if "zone_id" not in land_cover_df.columns:
        raise ValueError("thapar_zone_land_cover.csv must include a zone_id column.")

    merged = zone_ndvi_df.merge(
        land_cover_df,
        on="zone_id",
        how="left",
        suffixes=("", "_land_cover"),
    )

    if "zone_name" not in merged.columns and "zone_name_land_cover" in merged.columns:
        merged["zone_name"] = merged["zone_name_land_cover"]

    trend = _historical_change_by_zone(historical_df)
    merged = merged.merge(trend, on="zone_id", how="left")

    merged["green_cover_percent"] = _numeric_column(merged, "green_cover_percent")
    merged["tree_percent"] = _numeric_column(merged, "tree_percent")
    merged["built_up_percent"] = _numeric_column(merged, "built_up_percent")
    merged["ndvi_change"] = _numeric_column(merged, "ndvi_change")

    merged["low_green_cover_score"] = (100 - merged["green_cover_percent"]).clip(lower=0, upper=100)
    merged["tree_gap_score"] = (100 - merged["tree_percent"]).clip(lower=0, upper=100)
    merged["built_up_pressure_score"] = merged["built_up_percent"].clip(lower=0, upper=100)
    merged["ndvi_decline_score"] = merged["ndvi_change"].apply(
        lambda change: 0 if change >= 0 else min(abs(change) / 0.10 * 100, 100)
    )
    merged["aqi_stress_score"] = round(float(aqi_stress_score if aqi_stress_score is not None else DEFAULT_AQI_STRESS_SCORE), 2)

    merged["priority_score"] = (
        (0.35 * merged["low_green_cover_score"])
        + (0.25 * merged["ndvi_decline_score"])
        + (0.20 * merged["built_up_pressure_score"])
        + (0.10 * merged["tree_gap_score"])
        + (0.10 * merged["aqi_stress_score"])
    ).round(2)
    merged["priority_class"] = merged["priority_score"].apply(priority_class)
    merged["reason"] = merged.apply(_reason, axis=1)

    merged = merged.sort_values("priority_score", ascending=False).reset_index(drop=True)
    merged["rank"] = merged.index + 1

    preferred_columns = [
        "rank",
        "zone_id",
        "zone_name",
        "mean_ndvi",
        "green_cover_percent",
        "tree_percent",
        "built_up_percent",
        "first_year",
        "latest_year",
        "first_year_mean_ndvi",
        "latest_year_mean_ndvi",
        "ndvi_change",
        "low_green_cover_score",
        "ndvi_decline_score",
        "built_up_pressure_score",
        "tree_gap_score",
        "aqi_stress_score",
        "priority_score",
        "priority_class",
        "reason",
    ]
    columns = [column for column in preferred_columns if column in merged.columns]
    result = merged[columns]
    PROCESSED_PRIORITY_FILE.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(PROCESSED_PRIORITY_FILE, index=False)
    return result
