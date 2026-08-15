from typing import Any

import pandas as pd
import requests

from .config import (
    DEFAULT_AQI_STRESS_SCORE,
    DEFAULT_OPEN_METEO_END_DATE,
    DEFAULT_OPEN_METEO_START_DATE,
    OPEN_METEO_URL,
    PROCESSED_OPEN_METEO_FILE,
    THAPAR_LATITUDE,
    THAPAR_LONGITUDE,
    THAPAR_TIMEZONE,
)
from .data_loader import records_from_df


def calculate_aqi_stress_score(records: list[dict[str, Any]]) -> float:
    if not records:
        return DEFAULT_AQI_STRESS_SCORE

    df = pd.DataFrame(records)
    if "pm2_5" not in df.columns or "pm10" not in df.columns:
        return DEFAULT_AQI_STRESS_SCORE

    recent = df[["pm2_5", "pm10"]].apply(pd.to_numeric, errors="coerce").dropna().tail(24)
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

    records = []
    for index, timestamp in enumerate(times):
        records.append(
            {
                "time": timestamp,
                "pm10": pm10_values[index] if index < len(pm10_values) else None,
                "pm2_5": pm25_values[index] if index < len(pm25_values) else None,
            }
        )
    return records


def _read_open_meteo_cache() -> list[dict[str, Any]]:
    if not PROCESSED_OPEN_METEO_FILE.exists():
        return []
    return records_from_df(pd.read_csv(PROCESSED_OPEN_METEO_FILE))


def _write_open_meteo_cache(records: list[dict[str, Any]]) -> None:
    PROCESSED_OPEN_METEO_FILE.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(records, columns=["time", "pm10", "pm2_5"]).to_csv(PROCESSED_OPEN_METEO_FILE, index=False)


def get_recent_open_meteo(start_date: str | None = None, end_date: str | None = None) -> dict[str, Any]:
    params = {
        "latitude": THAPAR_LATITUDE,
        "longitude": THAPAR_LONGITUDE,
        "hourly": "pm10,pm2_5",
        "timezone": THAPAR_TIMEZONE,
        "start_date": start_date or DEFAULT_OPEN_METEO_START_DATE,
        "end_date": end_date or DEFAULT_OPEN_METEO_END_DATE,
    }

    records: list[dict[str, Any]] = []
    served_from_cache = False
    error_note = None

    try:
        response = requests.get(OPEN_METEO_URL, params=params, timeout=12)
        response.raise_for_status()
        records = _hourly_payload_to_records(response.json())
        if records:
            _write_open_meteo_cache(records)
    except Exception as exc:
        records = _read_open_meteo_cache()
        served_from_cache = bool(records)
        error_note = f"Open-Meteo request failed; served cached data." if served_from_cache else f"Open-Meteo request failed and no cache exists: {exc}"

    if not records and not PROCESSED_OPEN_METEO_FILE.exists():
        _write_open_meteo_cache([])

    note = "Modeled air-quality estimate near Thapar campus, not a campus sensor."
    if error_note:
        note = f"{note} {error_note}"

    return {
        "source": "Open-Meteo Air Quality API",
        "note": note,
        "location": {
            "latitude": THAPAR_LATITUDE,
            "longitude": THAPAR_LONGITUDE,
        },
        "stress_score": calculate_aqi_stress_score(records),
        "records": records,
        "served_from_cache": served_from_cache,
    }


def get_cached_or_default_aqi_stress() -> float:
    return calculate_aqi_stress_score(_read_open_meteo_cache())
