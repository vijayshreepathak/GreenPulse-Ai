import json
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import requests

from .config import (
    DEFAULT_AQI_STRESS_SCORE,
    DEFAULT_OPEN_METEO_END_DATE,
    DEFAULT_OPEN_METEO_START_DATE,
    OPEN_METEO_CACHE_TTL_MINUTES,
    OPEN_METEO_URL,
    PROCESSED_OPEN_METEO_CACHE_FILE,
    PROCESSED_OPEN_METEO_FILE,
    THAPAR_LATITUDE,
    THAPAR_LONGITUDE,
    THAPAR_TIMEZONE,
)
from .data_loader import records_from_df


def calculate_aqi_stress_score(records: list[dict[str, Any]]) -> float:
    if not records:
        return DEFAULT_AQI_STRESS_SCORE

    frame = pd.DataFrame(records)
    if "pm2_5" not in frame.columns or "pm10" not in frame.columns:
        return DEFAULT_AQI_STRESS_SCORE

    recent = frame[["pm2_5", "pm10"]].apply(pd.to_numeric, errors="coerce").dropna().tail(24)
    if recent.empty:
        return DEFAULT_AQI_STRESS_SCORE

    pm25_avg = recent["pm2_5"].mean()
    pm10_avg = recent["pm10"].mean()
    pm25_score = min((pm25_avg / 60) * 100, 100)
    pm10_score = min((pm10_avg / 100) * 100, 100)
    return round((0.6 * pm25_score) + (0.4 * pm10_score), 2)


def _hourly_payload_to_records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    hourly = payload.get("hourly", {})
    times = hourly.get("time", [])
    pm10_values = hourly.get("pm10", [])
    pm25_values = hourly.get("pm2_5", [])
    return [
        {
            "time": timestamp,
            "pm10": pm10_values[index] if index < len(pm10_values) else None,
            "pm2_5": pm25_values[index] if index < len(pm25_values) else None,
        }
        for index, timestamp in enumerate(times)
    ]


def _read_open_meteo_cache() -> list[dict[str, Any]]:
    if not PROCESSED_OPEN_METEO_FILE.exists():
        return []
    return records_from_df(pd.read_csv(PROCESSED_OPEN_METEO_FILE))


def _write_open_meteo_cache(records: list[dict[str, Any]]) -> None:
    PROCESSED_OPEN_METEO_FILE.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(records, columns=["time", "pm10", "pm2_5"]).to_csv(PROCESSED_OPEN_METEO_FILE, index=False)


def _read_response_cache() -> dict[str, Any]:
    if not PROCESSED_OPEN_METEO_CACHE_FILE.exists():
        return {}
    try:
        return json.loads(PROCESSED_OPEN_METEO_CACHE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _write_response_cache(payload: dict[str, Any]) -> None:
    PROCESSED_OPEN_METEO_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROCESSED_OPEN_METEO_CACHE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _cache_is_fresh(payload: dict[str, Any]) -> bool:
    fetched_at = payload.get("fetched_at")
    if not fetched_at:
        return False
    try:
        fetched = datetime.fromisoformat(str(fetched_at).replace("Z", "+00:00"))
    except ValueError:
        return False
    if fetched.tzinfo is None:
        fetched = fetched.replace(tzinfo=timezone.utc)
    age_minutes = (datetime.now(timezone.utc) - fetched.astimezone(timezone.utc)).total_seconds() / 60
    return age_minutes < OPEN_METEO_CACHE_TTL_MINUTES


def _latest_values(records: list[dict[str, Any]], current: dict[str, Any] | None = None) -> dict[str, Any]:
    current = current or {}
    pm25 = current.get("pm2_5")
    pm10 = current.get("pm10")
    timestamp = current.get("time")
    if pm25 is None or pm10 is None:
        for record in reversed(records):
            if record.get("pm2_5") is not None and record.get("pm10") is not None:
                pm25 = record.get("pm2_5")
                pm10 = record.get("pm10")
                timestamp = timestamp or record.get("time")
                break
    return {"pm2_5": pm25, "pm10": pm10, "time": timestamp}


def _averages_24h(records: list[dict[str, Any]]) -> dict[str, float | None]:
    if not records:
        return {"pm2_5": None, "pm10": None}
    frame = pd.DataFrame(records)
    values = frame[["pm2_5", "pm10"]].apply(pd.to_numeric, errors="coerce").dropna().tail(24)
    if values.empty:
        return {"pm2_5": None, "pm10": None}
    return {
        "pm2_5": round(float(values["pm2_5"].mean()), 2),
        "pm10": round(float(values["pm10"].mean()), 2),
    }


def _build_environment_response(
    records: list[dict[str, Any]],
    current: dict[str, Any] | None,
    *,
    freshness: str,
    fetched_at: str,
    error_note: str | None = None,
) -> dict[str, Any]:
    current_values = _latest_values(records, current)
    note = "Regional modeled air-quality context near Thapar campus; not a campus sensor measurement."
    if error_note:
        note = f"{note} {error_note}"
    return {
        "source": "Open-Meteo / CAMS modeled estimate",
        "data_mode": "modeled",
        "freshness": freshness,
        "last_updated": current_values.get("time"),
        "fetched_at": fetched_at,
        "location": {"latitude": THAPAR_LATITUDE, "longitude": THAPAR_LONGITUDE},
        "current": current_values,
        "averages_24h": _averages_24h(records),
        "stress_score": calculate_aqi_stress_score(records),
        "records": records,
        "served_from_cache": freshness == "cached",
        "note": note,
    }


def get_environment_data(
    history_hours: int = 168,
    *,
    force_refresh: bool = False,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    history_hours = max(24, min(int(history_hours), 168))
    cached = _read_response_cache()
    explicit_range = bool(start_date or end_date)

    if cached and _cache_is_fresh(cached) and not force_refresh and not explicit_range:
        response = dict(cached)
        response["freshness"] = "live"
        response["served_from_cache"] = False
        response["records"] = (response.get("records") or [])[-history_hours:]
        return response

    params: dict[str, Any] = {
        "latitude": THAPAR_LATITUDE,
        "longitude": THAPAR_LONGITUDE,
        "current": "pm10,pm2_5",
        "hourly": "pm10,pm2_5",
        "timezone": THAPAR_TIMEZONE,
    }
    if explicit_range:
        params["start_date"] = start_date or DEFAULT_OPEN_METEO_START_DATE
        params["end_date"] = end_date or DEFAULT_OPEN_METEO_END_DATE
    else:
        params["past_hours"] = history_hours
        params["forecast_hours"] = 1

    try:
        response = requests.get(OPEN_METEO_URL, params=params, timeout=15)
        response.raise_for_status()
        api_payload = response.json()
        records = _hourly_payload_to_records(api_payload)
        payload = _build_environment_response(
            records,
            api_payload.get("current"),
            freshness="live",
            fetched_at=datetime.now(timezone.utc).isoformat(),
        )
        if records:
            _write_open_meteo_cache(records)
            if not explicit_range:
                _write_response_cache(payload)
        return payload
    except Exception:
        if cached:
            response = dict(cached)
            response["freshness"] = "cached"
            response["served_from_cache"] = True
            response["records"] = (response.get("records") or [])[-history_hours:]
            response["note"] = (
                "Regional modeled air-quality context near Thapar campus; not a campus sensor measurement. "
                "The live provider was unavailable, so the last good response is shown."
            )
            return response

        records = _read_open_meteo_cache()[-history_hours:]
        return _build_environment_response(
            records,
            None,
            freshness="cached" if records else "unavailable",
            fetched_at=datetime.now(timezone.utc).isoformat(),
            error_note=(
                "The live provider was unavailable; cached hourly values are shown."
                if records
                else "No cached values are available."
            ),
        )


def get_recent_open_meteo(start_date: str | None = None, end_date: str | None = None) -> dict[str, Any]:
    return get_environment_data(start_date=start_date, end_date=end_date)


def get_cached_or_default_aqi_stress() -> float:
    cached = _read_response_cache()
    if cached.get("records"):
        return calculate_aqi_stress_score(cached["records"])
    return calculate_aqi_stress_score(_read_open_meteo_cache())
