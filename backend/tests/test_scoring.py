import math

import pandas as pd
import pytest

from app import config
from app.scoring import (
    DataValidationError,
    historical_ndvi_change,
    ndvi_decline_score,
    pm_stress_components,
    priority_class,
    score_zones,
)

REFERENCE_FALLBACK_RANKING = [
    ("Z01", 63.43, "High"),
    ("Z05", 61.11, "High"),
    ("Z03", 53.51, "High"),
    ("Z04", 51.73, "High"),
    ("Z02", 38.50, "Moderate"),
]


def load(raw, name):
    return pd.read_csv(raw / name)


@pytest.fixture()
def frames(data_dirs):
    raw = data_dirs["raw"]
    return (
        load(raw, config.REQUIRED_FILES["zone_ndvi"]),
        load(raw, config.REQUIRED_FILES["land_cover"]),
        load(raw, config.REQUIRED_FILES["historical_ndvi"]),
    )


def legacy_scores(zone_df, land_df, history_df, aqi):
    """Frozen copy of the pre-upgrade formula (commit 4923946) used as a regression oracle."""
    merged = zone_df.merge(land_df, on="zone_id", how="left", suffixes=("", "_lc"))
    hist = history_df.copy()
    hist["year"] = pd.to_numeric(hist["year"])
    changes = {}
    for zone_id, group in hist.sort_values(["zone_id", "year"]).groupby("zone_id"):
        changes[zone_id] = round(float(group.iloc[-1]["mean_ndvi"] - group.iloc[0]["mean_ndvi"]), 4)
    result = {}
    for row in merged.to_dict(orient="records"):
        change = changes[row["zone_id"]]
        decline = 0 if change >= 0 else min(abs(change) / 0.10 * 100, 100)
        score = (
            (0.35 * min(max(100 - row["green_cover_percent"], 0), 100))
            + (0.25 * decline)
            + (0.20 * min(max(row["built_up_percent"], 0), 100))
            + (0.10 * min(max(100 - row["tree_percent"], 0), 100))
            + (0.10 * round(float(aqi), 2))
        )
        result[row["zone_id"]] = round(score, 2)
    return result


def test_reference_ranking_with_pm_fallback(frames):
    table, issues = score_zones(*frames, None)
    assert issues == []
    observed = list(zip(table["zone_id"], table["priority_score"], table["priority_class"]))
    assert observed == REFERENCE_FALLBACK_RANKING
    assert list(table["rank"]) == [1, 2, 3, 4, 5]
    assert set(table["pm_stress_source"]) == {"fallback"}
    assert set(table["pm_stress_score"]) == {60.0}


@pytest.mark.parametrize("pm", [0, 37.5, 60, 81.27, 100])
def test_scores_match_pre_upgrade_formula(frames, pm):
    table, _ = score_zones(*frames, pm)
    legacy = legacy_scores(*frames, pm)
    assert dict(zip(table["zone_id"], table["priority_score"])) == legacy


def test_shared_pm_stress_shifts_every_zone_equally(frames):
    low, _ = score_zones(*frames, 60)
    high, _ = score_zones(*frames, 100)
    assert list(low["zone_id"]) == list(high["zone_id"])
    shifts = (high.set_index("zone_id")["priority_score"] - low.set_index("zone_id")["priority_score"]).round(2)
    assert set(shifts) == {4.0}


def test_contributions_sum_to_score(frames):
    table, _ = score_zones(*frames, 72.5)
    for row in table.to_dict(orient="records"):
        total = sum(row[f"contribution_{key}"] for key in config.SCORING_WEIGHTS)
        assert math.isclose(total, row["priority_score"], abs_tol=0.01)
        assert row["score_status"] == "ok"
        assert row["missing_inputs"] == []


def test_historical_change_uses_baseline_and_latest_years(frames):
    trend, issues = historical_ndvi_change(frames[2])
    assert issues == []
    z01 = trend.set_index("zone_id").loc["Z01"]
    assert (z01["first_year"], z01["latest_year"]) == (2018, 2025)
    assert z01["ndvi_change"] == pytest.approx(-0.0883, abs=1e-4)
    assert z01["first_year_mean_ndvi"] == pytest.approx(0.4434, abs=1e-4)
    assert z01["latest_year_mean_ndvi"] == pytest.approx(0.3551, abs=1e-4)


@pytest.mark.parametrize(
    "score,expected",
    [(0, "Low"), (30, "Low"), (30.01, "Moderate"), (50, "Moderate"), (50.01, "High"), (70, "High"), (70.01, "Urgent"), (100, "Urgent"), (None, "Unavailable"), (float("nan"), "Unavailable")],
)
def test_priority_class_thresholds(score, expected):
    assert priority_class(score) == expected


@pytest.mark.parametrize("change,expected", [(0.0, 0.0), (0.02, 0.0), (-0.05, 50.0), (-0.1, 100.0), (-0.3, 100.0), (None, None)])
def test_ndvi_decline_score(change, expected):
    result = ndvi_decline_score(change)
    assert result == expected if expected is None else math.isclose(result, expected)


def test_pm_stress_components_caps_and_blend():
    assert pm_stress_components(30, 50)["stress_score"] == 50.0
    assert pm_stress_components(120, 400)["stress_score"] == 100.0
    assert pm_stress_components(None, 50)["stress_score"] is None


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), "abc"])
def test_invalid_pm_stress_uses_documented_fallback(frames, bad):
    table, _ = score_zones(*frames, bad)
    assert set(table["pm_stress_score"]) == {60.0}
    assert set(table["pm_stress_source"]) == {"fallback"}


def test_duplicate_zone_ids_are_rejected(frames):
    zone_df, land_df, history_df = frames
    with pytest.raises(DataValidationError, match="duplicate zone_id"):
        score_zones(pd.concat([zone_df, zone_df.iloc[[0]]]), land_df, history_df)
    with pytest.raises(DataValidationError, match="duplicate zone_id"):
        score_zones(zone_df, pd.concat([land_df, land_df.iloc[[1]]]), history_df)


def test_missing_zone_id_column_is_rejected(frames):
    zone_df, land_df, history_df = frames
    with pytest.raises(DataValidationError):
        score_zones(zone_df.drop(columns=["zone_id"]), land_df, history_df)


def test_missing_land_cover_record_is_unavailable_not_zero(frames):
    zone_df, land_df, history_df = frames
    table, issues = score_zones(zone_df, land_df[land_df["zone_id"] != "Z03"], history_df, 60)
    z03 = table.set_index("zone_id").loc["Z03"]
    assert z03["score_status"] == "insufficient_data"
    assert z03["priority_score"] is None or pd.isna(z03["priority_score"])
    assert z03["priority_class"] == "Unavailable"
    assert pd.isna(z03["rank"])
    assert "built_up_percent" in z03["missing_inputs"] and "tree_percent" in z03["missing_inputs"]
    assert table.iloc[-1]["zone_id"] == "Z03"
    assert list(table["rank"].dropna().astype(int)) == [1, 2, 3, 4]
    assert any("Z03" in issue for issue in issues)


def test_missing_component_column_marks_all_zones_unavailable(frames):
    zone_df, land_df, history_df = frames
    table, _ = score_zones(zone_df.drop(columns=["green_cover_percent"]), land_df, history_df)
    assert set(table["score_status"]) == {"insufficient_data"}
    assert table["rank"].isna().all()


def test_invalid_percentage_is_not_clipped_into_a_score(frames):
    zone_df, land_df, history_df = frames
    land = land_df.copy()
    land.loc[land["zone_id"] == "Z02", "built_up_percent"] = 150
    table, issues = score_zones(zone_df, land, history_df)
    assert table.set_index("zone_id").loc["Z02", "score_status"] == "insufficient_data"
    assert any("outside 0-100" in issue for issue in issues)


def test_missing_history_for_zone_is_unavailable(frames):
    zone_df, land_df, history_df = frames
    history = history_df[~((history_df["zone_id"] == "Z04") & (history_df["year"] == 2018))]
    table, issues = score_zones(zone_df, land_df, history)
    assert table.set_index("zone_id").loc["Z04", "missing_inputs"] == ["ndvi_change"]
    assert any("Z04" in issue for issue in issues)


def test_duplicate_history_rows_are_not_guessed(frames):
    zone_df, land_df, history_df = frames
    duplicate = history_df[(history_df["zone_id"] == "Z02") & (history_df["year"] == 2025)].copy()
    duplicate["mean_ndvi"] = 0.1
    table, issues = score_zones(zone_df, land_df, pd.concat([history_df, duplicate]))
    assert table.set_index("zone_id").loc["Z02", "score_status"] == "insufficient_data"
    assert any("duplicate" in issue for issue in issues)


def test_single_year_history_cannot_produce_change(frames):
    zone_df, land_df, history_df = frames
    table, issues = score_zones(zone_df, land_df, history_df[history_df["year"] == 2025])
    assert set(table["score_status"]) == {"insufficient_data"}
    assert any("single year" in issue for issue in issues)


def test_tied_scores_rank_deterministically_by_zone_id(frames):
    zone_df, land_df, history_df = frames
    zone = zone_df.copy()
    land = land_df.copy()
    history = history_df.copy()
    for column in ["green_cover_percent"]:
        zone.loc[zone["zone_id"] == "Z04", column] = zone.loc[zone["zone_id"] == "Z02", column].values
    for column in ["built_up_percent", "tree_percent"]:
        land.loc[land["zone_id"] == "Z04", column] = land.loc[land["zone_id"] == "Z02", column].values
    for year in history["year"].unique():
        mask_from = (history["zone_id"] == "Z02") & (history["year"] == year)
        mask_to = (history["zone_id"] == "Z04") & (history["year"] == year)
        history.loc[mask_to, "mean_ndvi"] = history.loc[mask_from, "mean_ndvi"].values
    table, _ = score_zones(zone, land, history)
    tied = table[table["zone_id"].isin(["Z02", "Z04"])]
    assert list(tied["zone_id"]) == ["Z02", "Z04"]
    assert tied["priority_score"].nunique() == 1


def test_reason_does_not_invent_drivers(frames):
    table, _ = score_zones(*frames, 10)
    z02 = table.set_index("zone_id").loc["Z02"]
    assert "regional PM" not in z02["reason"]
    assert "high built-up pressure" in z02["reason"]


def test_numeric_zone_ids_join_across_int_and_float_columns(frames):
    zone_df, land_df, history_df = frames
    mapping = {f"Z0{i}": i for i in range(1, 6)}
    zone = zone_df.assign(zone_id=zone_df["zone_id"].map(mapping))  # int64
    land = land_df.assign(zone_id=land_df["zone_id"].map(mapping).astype(float))  # 1.0, 2.0 ...
    history = history_df.assign(zone_id=history_df["zone_id"].map(mapping).astype(str))  # "1", "2" ...
    table, issues = score_zones(zone, land, history, None)
    assert issues == []
    assert list(table["zone_id"]) == ["1", "5", "3", "4", "2"]
    assert list(table["priority_score"]) == [score for _, score, _ in REFERENCE_FALLBACK_RANKING]


def test_whitespace_in_zone_ids_is_ignored(frames):
    zone_df, land_df, history_df = frames
    land = land_df.assign(zone_id=" " + land_df["zone_id"] + " ")
    table, _ = score_zones(zone_df, land, history_df, None)
    assert set(table["score_status"]) == {"ok"}


def test_header_only_zone_file_yields_empty_ranking(frames):
    zone_df, land_df, history_df = frames
    table, _ = score_zones(zone_df.iloc[0:0], land_df, history_df, None)
    assert table.empty


def test_genuine_zero_inputs_are_valid_not_missing(frames):
    zone_df, land_df, history_df = frames
    zone = zone_df.copy()
    land = land_df.copy()
    zone.loc[zone["zone_id"] == "Z02", "green_cover_percent"] = 0.0
    land.loc[land["zone_id"] == "Z02", ["tree_percent", "built_up_percent"]] = 0.0
    table, issues = score_zones(zone, land, history_df, 0)
    z02 = table.set_index("zone_id").loc["Z02"]
    assert z02["score_status"] == "ok" and z02["missing_inputs"] == []
    assert z02["low_green_cover_score"] == 100.0 and z02["tree_gap_score"] == 100.0
    assert z02["built_up_pressure_score"] == 0.0 and z02["pm_stress_score"] == 0.0
    assert z02["pm_stress_source"] == "modelled"
    assert issues == []


def test_numeric_and_prefixed_zone_ids_stay_distinct(frames):
    zone_df, land_df, history_df = frames
    zone = zone_df.copy()
    zone.loc[zone["zone_id"] == "Z01", "zone_id"] = "1"
    table, issues = score_zones(zone, land_df, history_df, None)
    rows = table.set_index("zone_id")
    assert len(table) == 5
    assert rows.loc["1", "score_status"] == "insufficient_data"  # no land cover or history for "1"
    assert "Z01" not in rows.index
    assert any("Land-cover records missing for: 1" in issue for issue in issues)


@pytest.mark.parametrize("bad", ["abc", float("inf"), float("-inf"), float("nan"), ""])
def test_non_numeric_percentages_are_unavailable(frames, bad):
    zone_df, land_df, history_df = frames
    land = land_df.astype({"tree_percent": object})
    land.loc[land["zone_id"] == "Z03", "tree_percent"] = bad
    table, _ = score_zones(zone_df, land, history_df, None)
    z03 = table.set_index("zone_id").loc["Z03"]
    assert z03["score_status"] == "insufficient_data"
    assert z03["missing_inputs"] == ["tree_percent"]
    assert z03["priority_score"] is None or pd.isna(z03["priority_score"])
    assert pd.isna(z03["rank"])
    assert list(table["rank"].dropna().astype(int)) == [1, 2, 3, 4]


def test_class_follows_the_displayed_rounded_score(frames):
    zone_df, land_df, history_df = frames
    zone = zone_df.copy()
    land = land_df.copy()
    history = history_df.copy()
    # Z02: green cover chosen so the raw score is 30.004, which displays as 30.00 (Low, not Moderate).
    zone.loc[zone["zone_id"] == "Z02", "green_cover_percent"] = 100 - 30.004 / 0.35
    land.loc[land["zone_id"] == "Z02", ["tree_percent", "built_up_percent"]] = [100.0, 0.0]
    history.loc[history["zone_id"] == "Z02", "mean_ndvi"] = 0.4  # no NDVI change
    table, _ = score_zones(zone, land, history, 0)
    z02 = table.set_index("zone_id").loc["Z02"]
    assert z02["priority_score"] == 30.0
    assert z02["priority_class"] == "Low"


def test_components_and_contributions_stay_in_range(frames):
    for pm in (None, 0, 100):
        table, _ = score_zones(*frames, pm)
        for row in table.to_dict(orient="records"):
            for key, weight in config.SCORING_WEIGHTS.items():
                component = row[{
                    "low_green_cover": "low_green_cover_score",
                    "ndvi_decline": "ndvi_decline_score",
                    "built_up_pressure": "built_up_pressure_score",
                    "tree_gap": "tree_gap_score",
                    "pm_stress": "pm_stress_score",
                }[key]]
                assert 0 <= component <= 100
                assert 0 <= row[f"contribution_{key}"] <= weight * 100 + 1e-9
            assert 0 <= row["priority_score"] <= 100
            assert row["priority_class"] == priority_class(row["priority_score"])


def test_infinite_history_year_is_ignored_not_a_crash(frames):
    zone_df, land_df, history_df = frames
    history = history_df.copy()
    history.loc[history.index[0], "year"] = float("inf")
    table, issues = score_zones(zone_df, land_df, history, None)
    assert any("invalid record" in issue for issue in issues)
    assert table.set_index("zone_id").loc["Z01", "missing_inputs"] == ["ndvi_change"]
    assert len(table) == 5


def test_decimal_string_ids_join_numeric_ids(frames):
    zone_df, land_df, history_df = frames
    mapping = {f"Z0{i}": i for i in range(1, 6)}
    zone = zone_df.assign(zone_id=zone_df["zone_id"].map(mapping))
    land = land_df.assign(zone_id=land_df["zone_id"].map(mapping).map(lambda value: f"{value}.0"))
    history = history_df.assign(zone_id=history_df["zone_id"].map(mapping))
    table, issues = score_zones(zone, land, history, None)
    assert issues == []
    assert set(table["score_status"]) == {"ok"}


def test_ranks_and_years_stay_integers_when_a_zone_is_unavailable(frames):
    from app.data_loader import records_from_df

    zone_df, land_df, history_df = frames
    land = land_df.copy()
    land.loc[land["zone_id"] == "Z02", "tree_percent"] = None
    table, _ = score_zones(zone_df, land, history_df, None)
    records = {row["zone_id"]: row for row in records_from_df(table)}
    assert records["Z01"]["rank"] == 1 and isinstance(records["Z01"]["rank"], int)
    assert isinstance(records["Z01"]["first_year"], int)
    assert records["Z02"]["rank"] is None
    assert "1.0" not in table.to_csv(index=False).split("\n")[1].split(",")[0]
