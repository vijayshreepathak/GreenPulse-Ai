from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import DASHBOARD_NOTES, PROCESSED_DASHBOARD_FILE, PROJECT_NAME
from .data_loader import (
    ensure_data_dirs,
    first_row_from_df,
    load_optional_dataset,
    load_required_dataset,
    records_from_df,
    write_json,
)
from .external_apis import get_cached_or_default_aqi_stress, get_environment_data, get_recent_open_meteo
from .schemas import HealthResponse, StatusResponse
from .scoring import build_priority_table
from .spatial import cell_feature_collection, cell_history_records, spatial_summary

app = FastAPI(title=PROJECT_NAME, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    ensure_data_dirs()


@app.get("/", response_model=StatusResponse)
def root() -> dict[str, str]:
    return {
        "project": PROJECT_NAME,
        "status": "running",
        "scope": "CSV-first MVP",
    }


@app.get("/health", response_model=HealthResponse)
def health() -> dict[str, bool]:
    return {"ok": True}


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
        return {
            "message": "Optional Landsat historical NDVI file is not available.",
            "records": [],
        }
    return {
        "message": "Optional Landsat historical NDVI file loaded.",
        "records": records_from_df(df),
    }


@app.get("/aqi/open-meteo/recent")
def aqi_open_meteo_recent(
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
) -> dict:
    return get_recent_open_meteo(start_date=start_date, end_date=end_date)


@app.get("/api/environment/current")
def environment_current(refresh: bool = Query(default=False)) -> dict:
    return get_environment_data(history_hours=168, force_refresh=refresh)


@app.get("/api/environment/air-quality/history")
def environment_air_quality_history(
    hours: int = Query(default=168, ge=24, le=168),
    refresh: bool = Query(default=False),
) -> dict:
    return get_environment_data(history_hours=hours, force_refresh=refresh)


@app.get("/api/spatial/cells")
def spatial_cells() -> dict:
    payload = cell_feature_collection()
    if not payload["available"]:
        payload["message"] = "Optional 50 m spatial cell dataset is not available."
    return payload


@app.get("/api/spatial/cells/history")
def spatial_cell_history(
    cell_id: str | None = Query(default=None),
    zone_id: str | None = Query(default=None),
) -> dict:
    records = cell_history_records(cell_id=cell_id, zone_id=zone_id)
    return {"count": len(records), "records": records}


@app.get("/priority")
def priority() -> list[dict]:
    try:
        aqi_stress = get_cached_or_default_aqi_stress()
        result = build_priority_table(
            load_required_dataset("zone_ndvi"),
            load_required_dataset("land_cover"),
            load_required_dataset("historical_ndvi"),
            aqi_stress,
        )
        return records_from_df(result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/dashboard")
def dashboard() -> dict:
    notes = list(DASHBOARD_NOTES)

    def safe_load(label: str, loader, fallback):
        try:
            return loader()
        except HTTPException as exc:
            notes.append(f"{label}: {exc.detail}")
            return fallback
        except Exception as exc:
            notes.append(f"{label}: {exc}")
            return fallback

    summary_payload = safe_load("Campus summary", lambda: first_row_from_df(load_required_dataset("summary")), {})
    historical_payload = safe_load("Historical NDVI", lambda: records_from_df(load_required_dataset("historical_ndvi")), [])
    recent_aqi_payload = safe_load("Recent AQI", lambda: get_environment_data(), {})
    spatial_payload = safe_load("50 m spatial analysis", spatial_summary, {})

    def load_priority():
        aqi_stress = recent_aqi_payload.get("stress_score") if isinstance(recent_aqi_payload, dict) else None
        return records_from_df(
            build_priority_table(
                load_required_dataset("zone_ndvi"),
                load_required_dataset("land_cover"),
                load_required_dataset("historical_ndvi"),
                aqi_stress,
            )
        )

    priority_payload = safe_load("Priority table", load_priority, [])

    payload = {
        "summary": summary_payload,
        "priority": priority_payload,
        "historical_ndvi": historical_payload,
        "recent_aqi": recent_aqi_payload,
        "spatial_analysis": spatial_payload,
        "notes": notes,
    }
    write_json(PROCESSED_DASHBOARD_FILE, payload)
    return payload
