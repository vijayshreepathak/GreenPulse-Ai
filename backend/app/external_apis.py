"""Open-Meteo (CAMS) modelled PM2.5 / PM10 client with honest freshness semantics.

Freshness values returned to clients:

* ``live``        - fetched from the provider during this request.
* ``cached``      - served from the local cache, fetched less than the TTL ago.
* ``stale``       - the provider failed; an older last-good response is shown.
* ``unavailable`` - no usable modelled data; scoring uses the documented fallback.

Provider timestamps are naive local times in Asia/Kolkata (UTC+05:30).
"""

import json
import logging
import math
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd
import requests

from . import config
from .data_loader import atomic_write_text, write_csv
from .scoring import pm_stress_components

logger = logging.getLogger("greenpulse.air_quality")

IST = timezone(timedelta(minutes=config.THAPAR_UTC_OFFSET_MINUTES))
CACHE_SCHEMA_VERSION = 2
FORCED_REFRESH_MIN_INTERVAL_SECONDS = 30
# After a provider failure, requests reuse that failure instead of queueing another slow attempt.
FAILURE_BACKOFF_SECONDS = 60
# The cache is written with this machine's clock, so only tiny future offsets are tolerated.
CLOCK_SKEW_TOLERANCE_SECONDS = 5
MAX_HISTORY_HOURS = 168
_fetch_lock = threading.Lock()
_last_failure: dict[str, Any] = {"at": None, "error": None}


class ProviderError(Exception):
    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind
        self.message = message


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_local_time(value: Any) -> datetime | None:
    """Parse an ISO timestamp; naive values are interpreted as Asia/Kolkata."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=IST)
    return parsed


def _parse_utc(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _local_label(moment: datetime) -> str:
    return moment.astimezone(IST).strftime("%Y-%m-%dT%H:%M")


def _concentration(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number < 0:
        return None
    return number


def hourly_payload_to_records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    hourly = payload.get("hourly") if isinstance(payload, dict) else None
    if not isinstance(hourly, dict):
        return []
    times = hourly.get("time") if isinstance(hourly.get("time"), list) else []
    pm10_values = hourly.get("pm10") if isinstance(hourly.get("pm10"), list) else []
    pm25_values = hourly.get("pm2_5") if isinstance(hourly.get("pm2_5"), list) else []
    return [
        {
            "time": timestamp,
            "pm10": pm10_values[index] if index < len(pm10_values) else None,
            "pm2_5": pm25_values[index] if index < len(pm25_values) else None,
        }
        for index, timestamp in enumerate(times)
    ]


def sanitize_records(raw_records: Any, now: datetime) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Validate, sort and de-duplicate hourly records; exclude hours after ``now``."""
    quality = {
        "input_records": 0,
        "invalid_timestamps": 0,
        "invalid_values": 0,
        "duplicate_timestamps": 0,
        "out_of_order": False,
        "forecast_records_excluded": 0,
        "partial_records": 0,
    }
    if not isinstance(raw_records, list):
        return [], quality
    quality["input_records"] = len(raw_records)

    parsed: list[tuple[datetime, dict[str, Any]]] = []
    for raw in raw_records:
        if not isinstance(raw, dict):
            quality["invalid_timestamps"] += 1
            continue
        moment = parse_local_time(raw.get("time"))
        if moment is None:
            quality["invalid_timestamps"] += 1
            continue
        values = {}
        for field in ("pm2_5", "pm10"):
            raw_value = raw.get(field)
            values[field] = _concentration(raw_value)
            if raw_value is not None and values[field] is None:
                quality["invalid_values"] += 1
        parsed.append((moment, {"time": _local_label(moment), **values}))

    quality["out_of_order"] = any(parsed[i][0] > parsed[i + 1][0] for i in range(len(parsed) - 1))
    by_time: dict[datetime, dict[str, Any]] = {}
    for moment, record in parsed:
        if moment in by_time:
            quality["duplicate_timestamps"] += 1
        by_time[moment] = record  # keep the last occurrence

    history = []
    for moment in sorted(by_time):
        if moment > now:
            quality["forecast_records_excluded"] += 1
            continue
        record = by_time[moment]
        if (record["pm2_5"] is None) != (record["pm10"] is None):
            quality["partial_records"] += 1
        history.append(record)
    return history, quality


def averaging_window(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Mean of the latest 24 records with both PM2.5 and PM10 (the documented project rule).

    ``complete`` is true only when those records are 24 consecutive hours; gaps widen
    ``span_hours`` beyond 24 and are reported rather than hidden.
    """
    complete = [record for record in records if record["pm2_5"] is not None and record["pm10"] is not None]
    window = complete[-config.PM_AVERAGING_RECORDS:]
    if not window:
        return {
            "pm2_5": None, "pm10": None, "record_count": 0, "window_start": None, "window_end": None,
            "span_hours": None, "complete": False,
        }
    start, end = parse_local_time(window[0]["time"]), parse_local_time(window[-1]["time"])
    span_hours = round((end - start).total_seconds() / 3600) + 1
    return {
        "pm2_5": round(sum(record["pm2_5"] for record in window) / len(window), 2),
        "pm10": round(sum(record["pm10"] for record in window) / len(window), 2),
        "record_count": len(window),
        "window_start": window[0]["time"],
        "window_end": window[-1]["time"],
        "span_hours": span_hours,
        "complete": len(window) == config.PM_AVERAGING_RECORDS and span_hours == config.PM_AVERAGING_RECORDS,
    }


def calculate_aqi_stress_score(records: list[dict[str, Any]], now: datetime | None = None) -> float:
    """PM stress from the most recent complete hourly records (fallback 60 if none)."""
    history, _ = sanitize_records(records, now or utc_now())
    averages = averaging_window(history)
    stress = pm_stress_components(averages["pm2_5"], averages["pm10"])["stress_score"]
    return config.DEFAULT_AQI_STRESS_SCORE if stress is None else stress


def _current_values(current: Any, history: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    if isinstance(current, dict):
        moment = parse_local_time(current.get("time"))
        pm25 = _concentration(current.get("pm2_5"))
        pm10 = _concentration(current.get("pm10"))
        if moment is not None and moment <= now + timedelta(minutes=5) and pm25 is not None and pm10 is not None:
            return {"pm2_5": pm25, "pm10": pm10, "time": _local_label(moment), "source": "provider_current"}
    for record in reversed(history):
        if record["pm2_5"] is not None and record["pm10"] is not None:
            return {"pm2_5": record["pm2_5"], "pm10": record["pm10"], "time": record["time"], "source": "latest_hourly"}
    return {"pm2_5": None, "pm10": None, "time": None, "source": None}


def _iso(moment: datetime | None) -> str | None:
    return moment.astimezone(timezone.utc).isoformat() if moment else None


def build_environment_response(
    provider_data: dict[str, Any] | None,
    *,
    freshness: str,
    served_from_cache: bool,
    fetched_at: datetime | None,
    now: datetime,
    history_hours: int = 168,
    provider_error: ProviderError | None = None,
    extra_notes: list[str] | None = None,
) -> dict[str, Any]:
    provider_data = provider_data or {}
    # Hours after the fetch were forecasts when the provider returned them; serving the
    # cache later must not promote them to history just because the clock moved on.
    cutoff = min(now, fetched_at) if served_from_cache and fetched_at is not None else now
    history, quality = sanitize_records(provider_data.get("records"), cutoff)
    current = _current_values(provider_data.get("current"), history, cutoff)
    averages = averaging_window(history)
    components = pm_stress_components(averages["pm2_5"], averages["pm10"])
    modelled = components["stress_score"] is not None
    if not modelled and freshness != "unavailable" and not history:
        freshness = "unavailable"

    cache_age = None
    if fetched_at is not None:
        age = (now - fetched_at).total_seconds()
        # A fetch time in the future means the system clock changed, so the age is unknown.
        cache_age = max(0, int(age)) if age >= -CLOCK_SKEW_TOLERANCE_SECONDS else None

    notes = [config.AIR_QUALITY_LABEL]
    if freshness == "live":
        notes.append("Fetched from the provider during this request.")
    elif freshness == "cached":
        notes.append("Served from the local cache; the provider was queried less than 10 minutes ago.")
    elif freshness == "stale":
        notes.append("The provider is unavailable; the last good modelled response is shown.")
    else:
        notes.append("No usable modelled PM data is available.")
    if not modelled:
        notes.append(f"Scoring uses the documented fallback PM stress of {config.DEFAULT_AQI_STRESS_SCORE:g}.")
    elif averages["record_count"] < config.PM_AVERAGING_RECORDS:
        notes.append(f"Only {averages['record_count']} complete hourly records were available for averaging.")
    elif not averages["complete"]:
        notes.append(f"The latest {averages['record_count']} complete hourly records span {averages['span_hours']} hours because of missing hours.")
    notes.extend(extra_notes or [])

    last_updated = current["time"] or (history[-1]["time"] if history else None)
    return {
        "source": "Open-Meteo / CAMS modelled estimate",
        "provider": "Open-Meteo Air Quality API",
        "data_mode": "modelled",
        "label": config.AIR_QUALITY_LABEL,
        "freshness": freshness,
        "served_from_cache": served_from_cache,
        "fetched_at": _iso(fetched_at),
        "checked_at": _iso(now),
        "cache_age_seconds": cache_age,
        "cache_ttl_seconds": config.OPEN_METEO_CACHE_TTL_MINUTES * 60,
        "last_updated": last_updated,
        "timezone": config.THAPAR_TIMEZONE,
        "utc_offset": "+05:30",
        "location": {"latitude": config.THAPAR_LATITUDE, "longitude": config.THAPAR_LONGITUDE},
        "current": current,
        "averages_24h": averages,
        "stress_score": components["stress_score"] if modelled else config.DEFAULT_AQI_STRESS_SCORE,
        "stress_components": {"pm25_score": components["pm25_score"], "pm10_score": components["pm10_score"]},
        "pm_stress_source": "modelled" if modelled else "fallback",
        "records": history[-history_hours:],
        "data_quality": quality,
        "provider_status": {
            "ok": provider_error is None,
            "error": provider_error.kind if provider_error else None,
            "message": provider_error.message if provider_error else None,
        },
        "note": " ".join(notes),
    }


def _read_response_cache() -> tuple[dict[str, Any] | None, str | None]:
    path = config.PROCESSED_OPEN_METEO_CACHE_FILE
    if not path.exists():
        return None, None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("Ignoring unreadable air-quality cache %s", path, exc_info=True)
        return None, "The local air-quality cache was unreadable and was ignored."
    if not isinstance(payload, dict) or not isinstance(payload.get("records"), list) or _parse_utc(payload.get("fetched_at")) is None:
        return None, "The local air-quality cache was malformed and was ignored."
    return payload, None


def _write_response_cache(provider_data: dict[str, Any], fetched_at: datetime) -> bool:
    payload = {
        "schema_version": CACHE_SCHEMA_VERSION,
        "fetched_at": _iso(fetched_at),
        "records": provider_data["records"],
        "current": provider_data.get("current"),
    }
    return atomic_write_text(config.PROCESSED_OPEN_METEO_CACHE_FILE, json.dumps(payload, indent=2))


def _write_hourly_csv(records: list[dict[str, Any]]) -> bool:
    frame = pd.DataFrame(records, columns=["time", "pm10", "pm2_5"])
    return write_csv(config.PROCESSED_OPEN_METEO_FILE, frame)


def _read_hourly_csv() -> tuple[list[dict[str, Any]], datetime | None]:
    path = config.PROCESSED_OPEN_METEO_FILE
    if not path.exists():
        return [], None
    try:
        frame = pd.read_csv(path)
        modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    except Exception:
        logger.warning("Ignoring unreadable hourly CSV cache %s", path, exc_info=True)
        return [], None
    if "time" not in frame.columns:
        return [], None
    records = [
        {"time": row.get("time"), "pm10": row.get("pm10"), "pm2_5": row.get("pm2_5")}
        for row in frame.astype(object).where(frame.notna(), None).to_dict(orient="records")
    ]
    return records, modified


def _fetch_provider(params: dict[str, Any]) -> dict[str, Any]:
    try:
        response = requests.get(
            config.OPEN_METEO_URL,
            params=params,
            timeout=(config.OPEN_METEO_CONNECT_TIMEOUT_SECONDS, config.OPEN_METEO_READ_TIMEOUT_SECONDS),
        )
    except requests.Timeout as exc:
        raise ProviderError("timeout", "The air-quality provider did not respond in time.") from exc
    except requests.RequestException as exc:
        raise ProviderError("network", "The air-quality provider could not be reached.") from exc
    if response.status_code >= 400:
        raise ProviderError("http", f"The air-quality provider returned HTTP {response.status_code}.")
    try:
        payload = response.json()
    except ValueError as exc:
        raise ProviderError("invalid_payload", "The air-quality provider returned an unreadable response.") from exc
    records = hourly_payload_to_records(payload)
    if not records:
        raise ProviderError("empty", "The air-quality provider returned no hourly records.")
    current = payload.get("current") if isinstance(payload.get("current"), dict) else None
    return {"records": records, "current": current}


def _validate_range(start_date: str | None, end_date: str | None) -> tuple[str, str]:
    def parse(value: str, name: str) -> date:
        try:
            return date.fromisoformat(value)
        except (TypeError, ValueError):
            raise ValueError(f"{name} must be a date in YYYY-MM-DD format.") from None

    start = parse(start_date, "start_date") if start_date else None
    end = parse(end_date, "end_date") if end_date else None
    start = start or end
    end = end or start
    if end < start:
        raise ValueError("end_date must not be earlier than start_date.")
    if (end - start).days + 1 > config.OPEN_METEO_MAX_RANGE_DAYS:
        raise ValueError(f"Date ranges are limited to {config.OPEN_METEO_MAX_RANGE_DAYS} days.")
    return start.isoformat(), end.isoformat()


def _cache_age_seconds(cached: dict[str, Any], now: datetime) -> float:
    fetched = _parse_utc(cached.get("fetched_at"))
    if fetched is None:
        return math.inf
    age = (now - fetched).total_seconds()
    # A fetch time in the future means the clock changed; never treat that cache as fresh.
    if age < -CLOCK_SKEW_TOLERANCE_SECONDS:
        return math.inf
    return max(0.0, age)


def _has_complete_pair(records: list[dict[str, Any]]) -> bool:
    return any(record["pm2_5"] is not None and record["pm10"] is not None for record in records)


def _recent_failure(now: datetime) -> ProviderError | None:
    failed_at = _last_failure["at"]
    if failed_at is None:
        return None
    age = (now - failed_at).total_seconds()
    return _last_failure["error"] if 0 <= age < FAILURE_BACKOFF_SECONDS else None


def get_environment_data(
    history_hours: int = MAX_HISTORY_HOURS,
    *,
    force_refresh: bool = False,
    start_date: str | None = None,
    end_date: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    use_clock = now is None
    now = now or utc_now()
    history_hours = max(24, min(int(history_hours), MAX_HISTORY_HOURS))
    explicit_range = bool(start_date or end_date)
    ttl_seconds = config.OPEN_METEO_CACHE_TTL_MINUTES * 60
    # An explicit range returns every hour it covers; the rolling view returns the requested hours.
    record_limit = config.OPEN_METEO_MAX_RANGE_DAYS * 24 if explicit_range else history_hours

    params: dict[str, Any] = {
        "latitude": config.THAPAR_LATITUDE,
        "longitude": config.THAPAR_LONGITUDE,
        "current": "pm10,pm2_5",
        "hourly": "pm10,pm2_5",
        "timezone": config.THAPAR_TIMEZONE,
    }
    if explicit_range:
        params["start_date"], params["end_date"] = _validate_range(start_date, end_date)
    else:
        # Always fetch the full window: the cache is shared by every endpoint, whatever hours they display.
        params["past_hours"] = MAX_HISTORY_HOURS
        params["forecast_hours"] = 1

    def from_cache(cached: dict[str, Any], freshness: str, error: ProviderError | None = None, notes=None):
        return build_environment_response(
            cached,
            freshness=freshness,
            served_from_cache=True,
            fetched_at=_parse_utc(cached.get("fetched_at")),
            now=now,
            history_hours=record_limit,
            provider_error=error,
            extra_notes=notes,
        )

    if not explicit_range and not force_refresh:
        cached, _ = _read_response_cache()
        if cached and _cache_age_seconds(cached, now) < ttl_seconds:
            return from_cache(cached, "cached")

    notes: list[str] = []
    with _fetch_lock:
        if use_clock:
            now = utc_now()  # the wait for the lock may have been long
        cached, cache_issue = (None, None) if explicit_range else _read_response_cache()
        if cached:
            # Another request may have refreshed the cache while this one waited.
            age = _cache_age_seconds(cached, now)
            limit = FORCED_REFRESH_MIN_INTERVAL_SECONDS if force_refresh else ttl_seconds
            if age < limit:
                return from_cache(cached, "cached")

        provider_error = None if explicit_range else _recent_failure(now)
        if provider_error is not None:
            notes.append(f"The provider failed less than {FAILURE_BACKOFF_SECONDS} seconds ago, so it was not queried again yet.")
        else:
            try:
                provider_data = _fetch_provider(params)
                history, _ = sanitize_records(provider_data["records"], now)
                # A response without a single complete PM2.5/PM10 hour cannot be scored and must not replace a good cache.
                if not _has_complete_pair(history):
                    raise ProviderError("empty", "The air-quality provider returned no complete PM2.5/PM10 hourly records.")
            except ProviderError as error:
                logger.warning("Air-quality provider error: %s", error.kind)
                provider_error = error
                if not explicit_range:
                    _last_failure.update(at=now, error=error)
            else:
                if not explicit_range:
                    _last_failure.update(at=None, error=None)
                    if not _write_response_cache(provider_data, now):
                        notes.append("The local cache could not be updated.")
                    _write_hourly_csv(history)
                return build_environment_response(
                    provider_data,
                    freshness="live",
                    served_from_cache=False,
                    fetched_at=now,
                    now=now,
                    history_hours=record_limit,
                    extra_notes=notes,
                )

    if cache_issue:
        notes.append(cache_issue)
    if explicit_range:
        return build_environment_response(
            None, freshness="unavailable", served_from_cache=False, fetched_at=None, now=now,
            history_hours=record_limit, provider_error=provider_error,
        )
    if cached:
        freshness = "cached" if _cache_age_seconds(cached, now) < ttl_seconds else "stale"
        return from_cache(cached, freshness, provider_error, notes)

    csv_records, modified = _read_hourly_csv()
    if csv_records:
        return build_environment_response(
            {"records": csv_records}, freshness="stale", served_from_cache=True, fetched_at=modified,
            now=now, history_hours=history_hours, provider_error=provider_error, extra_notes=notes,
        )
    return build_environment_response(
        None, freshness="unavailable", served_from_cache=False, fetched_at=None, now=now,
        history_hours=history_hours, provider_error=provider_error, extra_notes=notes,
    )


def get_recent_open_meteo(start_date: str | None = None, end_date: str | None = None) -> dict[str, Any]:
    return get_environment_data(start_date=start_date, end_date=end_date)


def pm_stress_for_scoring(environment: dict[str, Any] | None) -> tuple[float | None, str]:
    """Return the PM stress value the official ranking should use, plus its source."""
    if isinstance(environment, dict) and environment.get("pm_stress_source") == "modelled":
        return environment.get("stress_score"), "modelled"
    return None, "fallback"
