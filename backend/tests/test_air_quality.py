import json
from datetime import datetime, timedelta, timezone

import pytest
import requests

from app import config, external_apis
from app.external_apis import (
    averaging_window,
    calculate_aqi_stress_score,
    get_environment_data,
    parse_local_time,
    sanitize_records,
)

from .conftest import provider_payload

NOW = datetime(2026, 10, 27, 11, 47, tzinfo=timezone.utc)  # 17:17 IST


@pytest.fixture(autouse=True)
def provider_at_fixed_now(provider):
    """Build the mocked provider payload around NOW, not the wall clock, so results never drift."""
    provider["set_payload"](provider_payload(NOW))
    return provider


def hourly(label, pm25, pm10):
    return {"time": label, "pm2_5": pm25, "pm10": pm10}


def test_parse_local_time_variants():
    naive = parse_local_time("2026-10-27T16:00")
    assert naive.utcoffset() == timedelta(hours=5, minutes=30)
    assert parse_local_time("2026-10-27T16:00:30").second == 30
    assert parse_local_time("2026-10-27T10:30:00Z").utcoffset() == timedelta(0)
    assert parse_local_time("2026-10-27T16:00+05:30") == naive
    assert parse_local_time("not a date") is None
    assert parse_local_time(None) is None


def test_sanitize_records_handles_malformed_input():
    raw = [
        hourly("2026-10-27T15:00", 50, 200),
        hourly("2026-10-27T13:00", 40, 100),  # out of order
        hourly("2026-10-27T14:00", -5, 120),  # negative concentration
        hourly("2026-10-27T14:00", 45, 150),  # duplicate timestamp, last one wins
        hourly("garbage", 1, 1),
        hourly("2026-10-27T16:00", "n/a", None),
        hourly("2026-10-27T17:00", 10, float("nan")),  # current hour, partial
        hourly("2026-10-27T18:00", 99, 99),  # future forecast hour
        "not a record",
    ]
    history, quality = sanitize_records(raw, NOW)
    assert [record["time"] for record in history] == [
        "2026-10-27T13:00", "2026-10-27T14:00", "2026-10-27T15:00", "2026-10-27T16:00", "2026-10-27T17:00",
    ]
    assert history[1] == hourly("2026-10-27T14:00", 45.0, 150.0)
    assert history[3] == hourly("2026-10-27T16:00", None, None)
    assert quality["out_of_order"] is True
    assert quality["duplicate_timestamps"] == 1
    assert quality["invalid_timestamps"] == 2
    assert quality["invalid_values"] == 3
    assert quality["forecast_records_excluded"] == 1
    assert quality["partial_records"] == 1


def test_averaging_uses_latest_24_complete_historical_records():
    start = datetime(2026, 10, 26, 0, 0)
    raw = [hourly((start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M"), 10 if h < 10 else 30, 50) for h in range(40)]
    raw.append(hourly("2026-10-27T23:00", 900, 900))  # future, must be ignored
    history, _ = sanitize_records(raw, NOW)
    window = averaging_window(history)
    assert window["record_count"] == 24
    assert window["complete"] is True
    assert window["pm2_5"] == 30.0 and window["pm10"] == 50.0
    assert window["window_end"] == "2026-10-27T15:00"
    assert calculate_aqi_stress_score(raw, NOW) == 50.0


def test_stress_falls_back_to_60_without_data():
    assert calculate_aqi_stress_score([], NOW) == 60.0
    assert calculate_aqi_stress_score([hourly("2026-10-27T10:00", None, 40)], NOW) == 60.0


def test_live_then_cached_then_forced_refresh(data_dirs, provider):
    first = get_environment_data(now=NOW)
    assert first["freshness"] == "live"
    assert first["served_from_cache"] is False
    assert first["pm_stress_source"] == "modelled"
    assert first["stress_score"] == 50.0
    assert first["data_quality"]["forecast_records_excluded"] == 1
    assert provider["calls"] == 1

    second = get_environment_data(now=NOW + timedelta(minutes=4))
    assert second["freshness"] == "cached"
    assert second["served_from_cache"] is True
    assert second["fetched_at"] == first["fetched_at"]
    assert second["cache_age_seconds"] == 240
    assert provider["calls"] == 1

    rapid = get_environment_data(force_refresh=True, now=NOW + timedelta(seconds=10))
    assert rapid["freshness"] == "cached" and provider["calls"] == 1

    forced = get_environment_data(force_refresh=True, now=NOW + timedelta(minutes=5))
    assert forced["freshness"] == "live"
    assert provider["calls"] == 2


def test_provider_failure_with_recent_cache_stays_cached(data_dirs, provider):
    get_environment_data(now=NOW)
    provider["fail"](requests.Timeout("slow"))
    result = get_environment_data(force_refresh=True, now=NOW + timedelta(minutes=2))
    assert result["freshness"] == "cached"
    assert result["provider_status"] == {"ok": False, "error": "timeout", "message": "The air-quality provider did not respond in time."}
    assert result["pm_stress_source"] == "modelled"


def test_provider_failure_with_old_cache_is_stale(data_dirs, provider):
    get_environment_data(now=NOW)
    provider["fail"]()
    later = NOW + timedelta(hours=3)
    result = get_environment_data(now=later)
    assert result["freshness"] == "stale"
    assert result["served_from_cache"] is True
    assert result["provider_status"]["error"] == "network"
    assert result["cache_age_seconds"] == 3 * 3600
    assert result["stress_score"] == 50.0


def test_no_cache_and_provider_down_is_unavailable_with_fallback(data_dirs, provider):
    provider["fail"]()
    result = get_environment_data(now=NOW)
    assert result["freshness"] == "unavailable"
    assert result["stress_score"] == 60.0
    assert result["pm_stress_source"] == "fallback"
    assert result["records"] == []
    assert result["current"]["pm2_5"] is None


@pytest.mark.parametrize(
    "response,kind",
    [
        ({"payload": None, "status": 503}, "http"),
        ({"payload": {"hourly": {"time": []}}, "status": 200}, "empty"),
        ({"payload": {"unexpected": True}, "status": 200}, "empty"),
    ],
)
def test_provider_error_kinds(data_dirs, provider, response, kind):
    provider["set_payload"](response["payload"], response["status"])
    result = get_environment_data(now=NOW)
    assert result["provider_status"]["error"] == kind
    assert result["freshness"] == "unavailable"


def test_unreadable_json_response(data_dirs, provider):
    from .conftest import FakeResponse

    provider["response"] = FakeResponse(json_error=True)
    result = get_environment_data(now=NOW)
    assert result["provider_status"]["error"] == "invalid_payload"


def test_all_invalid_values_do_not_replace_good_cache(data_dirs, provider):
    get_environment_data(now=NOW)
    payload = provider_payload(NOW + timedelta(minutes=20), pm25=-1, pm10=-1)
    provider["set_payload"](payload)
    result = get_environment_data(now=NOW + timedelta(minutes=20))
    assert result["provider_status"]["error"] == "empty"
    assert result["freshness"] == "stale"
    assert result["stress_score"] == 50.0


def test_corrupt_cache_file_is_ignored(data_dirs, provider):
    config.PROCESSED_OPEN_METEO_CACHE_FILE.write_text("{ not json", encoding="utf-8")
    provider["fail"]()
    result = get_environment_data(now=NOW)
    assert result["freshness"] == "unavailable"
    assert "unreadable" in result["note"]


def test_cache_write_failure_does_not_break_response(data_dirs, provider, monkeypatch):
    monkeypatch.setattr(external_apis, "atomic_write_text", lambda path, text: False)
    result = get_environment_data(now=NOW)
    assert result["freshness"] == "live"
    assert "could not be updated" in result["note"]


def test_legacy_csv_cache_is_used_as_stale_fallback(data_dirs, provider):
    config.PROCESSED_OPEN_METEO_FILE.write_text("time,pm10,pm2_5\n2026-10-27T09:00,100,60\n", encoding="utf-8")
    provider["fail"]()
    result = get_environment_data(now=NOW)
    assert result["freshness"] == "stale"
    assert result["averages_24h"]["record_count"] == 1
    assert result["averages_24h"]["complete"] is False


def test_invalid_provider_current_falls_back_to_latest_hourly(data_dirs, provider):
    payload = provider_payload(NOW)
    payload["current"] = {"time": "2026-10-27T16:30", "pm2_5": None, "pm10": -2}
    provider["set_payload"](payload)
    result = get_environment_data(now=NOW)
    assert result["current"]["source"] == "latest_hourly"
    assert result["current"]["pm2_5"] == 30.0


def test_cached_payload_is_rebuilt_relative_to_now(data_dirs, provider):
    get_environment_data(now=NOW)
    cache = json.loads(config.PROCESSED_OPEN_METEO_CACHE_FILE.read_text(encoding="utf-8"))
    assert cache["schema_version"] == 2
    assert "freshness" not in cache  # cache stores provider data, not a pre-labelled response


@pytest.mark.parametrize(
    "start,end",
    [("2026-13-01", None), ("2026-05-30", "2026-05-01"), ("2026-01-01", "2026-03-01")],
)
def test_explicit_range_validation(start, end):
    with pytest.raises(ValueError):
        external_apis._validate_range(start, end)


def test_explicit_range_failure_does_not_reuse_recent_cache(data_dirs, provider):
    get_environment_data(now=NOW)
    provider["fail"]()
    result = get_environment_data(start_date="2026-05-18", end_date="2026-05-20", now=NOW)
    assert result["freshness"] == "unavailable"


def test_cache_with_future_fetch_time_is_not_treated_as_fresh(data_dirs, provider):
    get_environment_data(now=NOW)
    cache = json.loads(config.PROCESSED_OPEN_METEO_CACHE_FILE.read_text(encoding="utf-8"))
    cache["fetched_at"] = (NOW + timedelta(days=2)).isoformat()  # clock was moved back after caching
    config.PROCESSED_OPEN_METEO_CACHE_FILE.write_text(json.dumps(cache), encoding="utf-8")
    result = get_environment_data(now=NOW + timedelta(minutes=1))
    assert provider["calls"] == 2
    assert result["freshness"] == "live"


def test_provider_with_only_null_values_is_unavailable_not_zero(data_dirs, provider):
    payload = provider_payload(NOW)
    payload["hourly"]["pm2_5"] = [None] * len(payload["hourly"]["pm2_5"])
    payload["hourly"]["pm10"] = [None] * len(payload["hourly"]["pm10"])
    payload["current"] = {"time": "2026-10-27T17:00", "pm2_5": None, "pm10": None}
    provider["set_payload"](payload)
    result = get_environment_data(now=NOW)
    assert result["freshness"] == "unavailable"
    assert result["pm_stress_source"] == "fallback"
    assert result["stress_score"] == 60.0
    assert result["averages_24h"]["pm2_5"] is None


def test_explicit_range_limit_is_inclusive():
    assert external_apis._validate_range("2026-05-01", "2026-05-31") == ("2026-05-01", "2026-05-31")
    with pytest.raises(ValueError):
        external_apis._validate_range("2026-05-01", "2026-06-01")
    assert external_apis._validate_range("2026-05-18", None) == ("2026-05-18", "2026-05-18")


def test_cached_forecast_hours_are_not_promoted_to_history(data_dirs, provider):
    payload = provider_payload(NOW, future_hours=1)
    payload["hourly"]["pm2_5"][-1] = 600.0  # the forecast hour after NOW
    payload["hourly"]["pm10"][-1] = 900.0
    provider["set_payload"](payload)
    get_environment_data(now=NOW)
    provider["fail"]()
    later = get_environment_data(now=NOW + timedelta(hours=2))  # the forecast hour is now in the past
    assert later["freshness"] == "stale"
    assert later["data_quality"]["forecast_records_excluded"] == 1
    assert later["averages_24h"]["pm2_5"] == 30.0 and later["averages_24h"]["pm10"] == 50.0
    assert all(record["pm2_5"] != 600.0 for record in later["records"])
    assert later["last_updated"] <= "2026-10-27T17:17"


def test_future_dated_cache_has_unknown_age_when_provider_fails(data_dirs, provider):
    get_environment_data(now=NOW)
    cache = json.loads(config.PROCESSED_OPEN_METEO_CACHE_FILE.read_text(encoding="utf-8"))
    cache["fetched_at"] = (NOW + timedelta(days=2)).isoformat()
    config.PROCESSED_OPEN_METEO_CACHE_FILE.write_text(json.dumps(cache), encoding="utf-8")
    provider["fail"]()
    result = get_environment_data(now=NOW + timedelta(minutes=1))
    assert result["freshness"] == "stale"
    assert result["cache_age_seconds"] is None
    assert result["averages_24h"]["record_count"] == 24


def test_short_history_request_does_not_shrink_the_shared_cache(data_dirs, provider):
    short = get_environment_data(history_hours=24, now=NOW)
    assert provider["last_params"]["past_hours"] == 168
    assert len(short["records"]) == 24
    cache = json.loads(config.PROCESSED_OPEN_METEO_CACHE_FILE.read_text(encoding="utf-8"))
    assert len(cache["records"]) == 31  # 30 past hours + 1 forecast hour, as returned
    full = get_environment_data(now=NOW + timedelta(minutes=1))
    assert full["freshness"] == "cached" and len(full["records"]) == 30
    assert provider["calls"] == 1


def test_single_pollutant_response_does_not_replace_a_good_cache(data_dirs, provider):
    get_environment_data(now=NOW)
    payload = provider_payload(NOW + timedelta(minutes=20))
    payload["hourly"]["pm10"] = [None] * len(payload["hourly"]["pm10"])
    payload["current"]["pm10"] = None
    provider["set_payload"](payload)
    result = get_environment_data(now=NOW + timedelta(minutes=20))
    assert result["provider_status"]["error"] == "empty"
    assert result["freshness"] == "stale"
    assert result["pm_stress_source"] == "modelled" and result["stress_score"] == 50.0
    cache = json.loads(config.PROCESSED_OPEN_METEO_CACHE_FILE.read_text(encoding="utf-8"))
    assert cache["records"][0]["pm10"] == 50.0


def test_provider_outage_backs_off_instead_of_retrying_every_request(data_dirs, provider):
    provider["fail"](requests.Timeout("slow"))
    for seconds in (0, 5, 10, 20):
        result = get_environment_data(now=NOW + timedelta(seconds=seconds))
        assert result["freshness"] == "unavailable"
        assert result["provider_status"]["error"] == "timeout"
    forced = get_environment_data(force_refresh=True, now=NOW + timedelta(seconds=30))
    assert forced["provider_status"]["error"] == "timeout"
    assert "not queried again yet" in forced["note"]
    assert provider["calls"] == 1
    provider["set_payload"](provider_payload(NOW))
    recovered = get_environment_data(now=NOW + timedelta(seconds=61))
    assert recovered["freshness"] == "live"
    assert provider["calls"] == 2


def test_explicit_range_returns_every_hour_it_covers(data_dirs, provider):
    start = datetime(2026, 5, 1)
    labels = [(start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(31 * 24)]
    provider["set_payload"]({"hourly": {"time": labels, "pm2_5": [20.0] * len(labels), "pm10": [40.0] * len(labels)}})
    result = get_environment_data(start_date="2026-05-01", end_date="2026-05-31", now=NOW)
    assert len(result["records"]) == 744
    assert result["records"][0]["time"] == "2026-05-01T00:00"


def test_averaging_window_reports_gaps_instead_of_claiming_24_hours():
    start = datetime(2026, 10, 26, 12, 0)
    raw = [hourly((start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M"), 30, 50) for h in range(30)]
    for h in range(20, 26):  # six empty hours inside the latest day
        raw[h]["pm2_5"] = None
    history, _ = sanitize_records(raw, NOW)
    window = averaging_window(history)
    assert window["record_count"] == 24
    assert window["span_hours"] == 30
    assert window["complete"] is False


def test_cache_slightly_in_the_future_is_not_fresh(data_dirs, provider):
    get_environment_data(now=NOW)
    cache = json.loads(config.PROCESSED_OPEN_METEO_CACHE_FILE.read_text(encoding="utf-8"))
    cache["fetched_at"] = (NOW + timedelta(seconds=120)).isoformat()
    config.PROCESSED_OPEN_METEO_CACHE_FILE.write_text(json.dumps(cache), encoding="utf-8")
    result = get_environment_data(now=NOW + timedelta(seconds=30))
    assert provider["calls"] == 2
    assert result["freshness"] == "live"
