import logging
import math
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Callable

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .ai.routes import BodySizeLimitMiddleware, router as ai_router
from .analysis import official_priority_table
from .data_loader import (
    dataset_status,
    ensure_data_dirs,
    first_row_from_df,
    load_optional_dataset,
    load_required_dataset,
    records_from_df,
    write_csv,
    write_json,
)
from .external_apis import get_environment_data, get_recent_open_meteo
from .schemas import HealthResponse, StatusResponse
from .scoring import DataValidationError, priority_table_for_csv, scoring_methodology
from .spatial import cell_feature_collection, cell_history_records, spatial_summary

logger = logging.getLogger("greenpulse.api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_data_dirs()
    yield


app = FastAPI(title=config.PROJECT_NAME, version=config.API_VERSION, lifespan=lifespan)

app.add_middleware(BodySizeLimitMiddleware, path_prefix="/api/ai/", max_bytes=config.AI_MAX_REQUEST_BYTES)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    # POST is used only by the AI Copilot endpoints; every data endpoint is read-only GET.
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.include_router(ai_router)


@app.exception_handler(DataValidationError)
async def data_validation_handler(_: Request, exc: DataValidationError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": f"Dataset validation failed: {exc}"})


@app.exception_handler(Exception)
async def unexpected_error_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled API error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error. See the server log for details."})


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _priority_payload(environment: dict[str, Any] | None) -> tuple[list[dict[str, Any]], list[str]]:
    """Score zones with the PM stress of ``environment`` so display and ranking agree."""
    table, issues = official_priority_table(environment)
    write_csv(config.PROCESSED_PRIORITY_FILE, priority_table_for_csv(table))
    return records_from_df(table), issues


def _history_metadata(records: list[dict[str, Any]], dataset: str) -> dict[str, Any]:
    numeric = pd.to_numeric(pd.Series([r.get("year") for r in records], dtype=object), errors="coerce")
    years = sorted({int(year) for year in numeric if math.isfinite(year)})
    seasons = sorted({str(r.get("season")) for r in records if r.get("season")})
    return {
        "dataset": dataset,
        "available": bool(years),
        "baseline_year": years[0] if years else None,
        "latest_year": years[-1] if years else None,
        "years": years,
        "season": ", ".join(seasons) if seasons else None,
        "record_count": len(records),
    }


@app.get("/", response_model=StatusResponse)
def root() -> dict[str, str]:
    return {"project": config.PROJECT_NAME, "status": "running", "scope": "CSV-first MVP"}


@app.get("/health", response_model=HealthResponse)
def health() -> dict[str, Any]:
    status = dataset_status()
    return {
        "ok": True,
        "version": config.API_VERSION,
        "required_datasets_available": status["required_available"],
        "datasets": status,
    }


@app.get("/summary")
def summary() -> dict:
    return first_row_from_df(load_required_dataset("summary"))


@app.get("/zones/ndvi")
def zones_ndvi() -> list[dict]:
    return records_from_df(load_required_dataset("zone_ndvi"))


@app.get("/zones/land-cover")
def zones_land_cover() -> list[dict]:
    return records_from_df(load_required_dataset("land_cover"))


@app.get("/zones/historical-ndvi")
def zones_historical_ndvi() -> list[dict]:
    return records_from_df(load_required_dataset("historical_ndvi"))


@app.get("/zones/landsat-history")
def zones_landsat_history() -> dict:
    df = load_optional_dataset("landsat_history")
    if df.empty:
        return {"message": "Optional Landsat historical NDVI file is not available.", "records": [], "metadata": None}
    records = records_from_df(df)
    return {
        "message": "Optional Landsat historical NDVI file loaded.",
        "records": records,
        "metadata": _history_metadata(records, "Landsat annual composite (secondary context)"),
    }


@app.get("/aqi/open-meteo/recent")
def aqi_open_meteo_recent(
    start_date: str | None = Query(default=None, max_length=10),
    end_date: str | None = Query(default=None, max_length=10),
) -> dict:
    try:
        return get_recent_open_meteo(start_date=start_date, end_date=end_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/environment/current")
def environment_current(refresh: bool = Query(default=False)) -> dict:
    return get_environment_data(history_hours=168, force_refresh=refresh)


@app.get("/api/environment/air-quality/history")
def environment_air_quality_history(
    hours: int = Query(default=168, ge=24, le=168),
    refresh: bool = Query(default=False),
) -> dict:
    return get_environment_data(history_hours=hours, force_refresh=refresh)


@app.get("/api/analysis/current")
def analysis_current(refresh: bool = Query(default=False)) -> dict:
    """Modelled PM context and the official ranking computed from the same PM stress."""
    environment = get_environment_data(history_hours=168, force_refresh=refresh)
    priority, issues = _priority_payload(environment)
    return {
        "environment": environment,
        "priority": priority,
        "scoring": scoring_methodology(),
        "data_issues": issues,
        "generated_at": _utc_now_iso(),
    }


@app.get("/api/spatial/cells")
def spatial_cells() -> dict:
    payload = dict(cell_feature_collection())
    if not payload["available"]:
        payload["message"] = "Optional 50 m spatial cell dataset is not available."
    return payload


@app.get("/api/spatial/cells/history")
def spatial_cell_history(
    cell_id: str | None = Query(default=None, max_length=64, pattern=r"^[A-Za-z0-9_,.\-]+$"),
    zone_id: str | None = Query(default=None, max_length=32, pattern=r"^[A-Za-z0-9_\-]+$"),
) -> dict:
    if not cell_id and not zone_id:
        raise HTTPException(status_code=422, detail="Provide cell_id or zone_id.")
    records = cell_history_records(cell_id=cell_id, zone_id=zone_id)
    return {"count": len(records), "records": records}


@app.get("/priority")
def priority() -> list[dict]:
    records, _ = _priority_payload(get_environment_data())
    return records


@app.get("/dashboard")
def dashboard() -> dict:
    notes = list(config.DASHBOARD_NOTES)

    def safe_load(label: str, loader: Callable[[], Any], fallback: Any) -> Any:
        try:
            return loader()
        except HTTPException as exc:
            notes.append(f"{label}: {exc.detail}")
        except DataValidationError as exc:
            notes.append(f"{label}: dataset validation failed: {exc}")
        except Exception:
            logger.exception("Dashboard section failed: %s", label)
            notes.append(f"{label}: could not be prepared. See the server log for details.")
        return fallback

    summary_payload = safe_load("Campus summary", lambda: first_row_from_df(load_required_dataset("summary")), {})
    historical_payload = safe_load(
        "Historical NDVI", lambda: records_from_df(load_required_dataset("historical_ndvi")), []
    )
    recent_aqi_payload = safe_load("Modelled air quality", get_environment_data, {})
    spatial_payload = safe_load("50 m spatial analysis", spatial_summary, {})
    priority_payload, data_issues = safe_load(
        "Priority table", lambda: _priority_payload(recent_aqi_payload or None), ([], [])
    )

    payload = {
        "summary": summary_payload,
        "priority": priority_payload,
        "historical_ndvi": historical_payload,
        "recent_aqi": recent_aqi_payload,
        "spatial_analysis": spatial_payload,
        "scoring": scoring_methodology(),
        "datasets": {
            "sentinel2_zone_history": _history_metadata(historical_payload, "Sentinel-2 seasonal composite"),
        },
        "data_issues": data_issues,
        "notes": notes,
        "generated_at": _utc_now_iso(),
    }
    write_json(config.PROCESSED_DASHBOARD_FILE, payload)
    return payload
