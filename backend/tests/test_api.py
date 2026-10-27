import pandas as pd

from app import config, spatial


def test_root_and_health(client):
    assert client.get("/").json()["status"] == "running"
    health = client.get("/health").json()
    assert health["ok"] is True
    assert health["required_datasets_available"] is True
    assert health["datasets"]["optional"]["cell_current"] is True


def test_dashboard_priority_uses_displayed_pm_stress(client):
    payload = client.get("/dashboard").json()
    assert {"summary", "priority", "historical_ndvi", "recent_aqi", "spatial_analysis", "scoring", "datasets", "notes"} <= payload.keys()
    stress = payload["recent_aqi"]["stress_score"]
    assert payload["recent_aqi"]["freshness"] == "live"
    assert stress == 50.0
    assert {row["pm_stress_score"] for row in payload["priority"]} == {stress}
    assert [row["zone_id"] for row in payload["priority"]] == ["Z01", "Z05", "Z03", "Z04", "Z02"]
    assert payload["datasets"]["sentinel2_zone_history"]["latest_year"] == 2025
    assert payload["datasets"]["sentinel2_zone_history"]["baseline_year"] == 2018
    assert payload["scoring"]["weights"] == config.SCORING_WEIGHTS
    assert payload["spatial_analysis"]["cell_count"] == 447


def test_analysis_current_is_internally_consistent(client, provider):
    from .conftest import provider_payload

    provider["set_payload"](provider_payload(pm25=120, pm10=300))
    payload = client.get("/api/analysis/current?refresh=true").json()
    assert payload["environment"]["stress_score"] == 100.0
    assert {row["pm_stress_score"] for row in payload["priority"]} == {100.0}
    assert payload["priority"][0]["priority_score"] == 67.43


def test_priority_endpoint_matches_fallback_reference_when_provider_down(client, provider):
    provider["fail"]()
    rows = client.get("/priority").json()
    assert [(row["zone_id"], row["priority_score"]) for row in rows] == [
        ("Z01", 63.43), ("Z05", 61.11), ("Z03", 53.51), ("Z04", 51.73), ("Z02", 38.5),
    ]
    assert {row["pm_stress_source"] for row in rows} == {"fallback"}


def test_environment_endpoints(client):
    current = client.get("/api/environment/current").json()
    assert current["data_mode"] == "modelled"
    assert current["label"].startswith("Modelled air-quality estimates near TIET campus")
    history = client.get("/api/environment/air-quality/history?hours=24").json()
    assert len(history["records"]) == 24
    assert history["freshness"] == "cached"
    assert client.get("/api/environment/air-quality/history?hours=5").status_code == 422


def test_legacy_range_endpoint_validates_dates(client):
    assert client.get("/aqi/open-meteo/recent?start_date=2026-05-30&end_date=2026-05-01").status_code == 422
    assert client.get("/aqi/open-meteo/recent?start_date=yesterday").status_code == 422


def test_spatial_cells_geojson(client):
    payload = client.get("/api/spatial/cells").json()
    assert payload["available"] is True
    assert payload["count"] == 447
    features = payload["geojson"]["features"]
    assert len(features) == 447
    first = features[0]
    assert first["geometry"]["type"] in {"Polygon", "MultiPolygon"}
    assert ".geo" not in first["properties"]
    assert "ndvi_change" in first["properties"]
    assert payload["level"] == "cell"


def test_invalid_cell_geometry_is_skipped(client, data_dirs):
    path = data_dirs["raw"] / config.OPTIONAL_FILES["cell_current"]
    frame = pd.read_csv(path)
    frame.loc[0, ".geo"] = '{"type":"Polygon","coordinates":[[[1,2]]]}'
    frame.loc[1, ".geo"] = "not json"
    frame.loc[2, ".geo"] = '{"type":"Polygon","coordinates":[[[76.3,95.0],[76.4,95.0],[76.4,95.1],[76.3,95.0]]]}'
    frame.loc[3, ".geo"] = '{"type":"Polygon","coordinates":[[[true,30.3],[76.4,30.3],[76.4,30.4],[true,30.3]]]}'
    frame.to_csv(path, index=False)
    spatial._feature_cache.update(key=None, payload=None)
    payload = client.get("/api/spatial/cells").json()
    assert payload["count"] == 443
    assert payload["skipped_invalid_geometry"] == 4


def test_cell_history_validation(client):
    ok = client.get("/api/spatial/cells/history", params={"cell_id": "C_12613,67168"}).json()
    assert ok["count"] == 8
    assert [row["year"] for row in ok["records"]] == sorted(row["year"] for row in ok["records"])
    assert client.get("/api/spatial/cells/history").status_code == 422
    assert client.get("/api/spatial/cells/history", params={"cell_id": "<script>"}).status_code == 422
    assert client.get("/api/spatial/cells/history", params={"zone_id": "Z01"}).json()["count"] == 888


def test_landsat_metadata(client):
    payload = client.get("/zones/landsat-history").json()
    assert payload["metadata"]["baseline_year"] == 2014
    assert payload["metadata"]["latest_year"] == 2025
    assert len(payload["records"]) == 60


def test_missing_optional_datasets_degrade_gracefully(client, data_dirs):
    for key in ["cell_current", "cell_history", "landsat_history"]:
        (data_dirs["raw"] / config.OPTIONAL_FILES[key]).unlink()
    spatial._feature_cache.update(key=None, payload=None)
    assert client.get("/api/spatial/cells").json()["available"] is False
    assert client.get("/zones/landsat-history").json()["records"] == []
    dashboard = client.get("/dashboard")
    assert dashboard.status_code == 200
    assert len(dashboard.json()["priority"]) == 5


def test_missing_required_dataset(client, data_dirs):
    (data_dirs["raw"] / config.REQUIRED_FILES["land_cover"]).unlink()
    response = client.get("/priority")
    assert response.status_code == 404
    assert "thapar_zone_land_cover.csv" in response.json()["detail"]
    dashboard = client.get("/dashboard").json()
    assert dashboard["priority"] == []
    assert any("Priority table" in note for note in dashboard["notes"])


def test_corrupt_required_csv_returns_sanitised_error(client, data_dirs):
    (data_dirs["raw"] / config.REQUIRED_FILES["summary"]).write_bytes(b'a,b\n"unterminated,1\n')
    response = client.get("/summary")
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "could not be parsed" in detail
    assert "Traceback" not in detail and "Error tokenizing" not in detail


def test_duplicate_zone_ids_return_validation_error(client, data_dirs):
    path = data_dirs["raw"] / config.REQUIRED_FILES["zone_ndvi"]
    frame = pd.read_csv(path)
    pd.concat([frame, frame.iloc[[0]]]).to_csv(path, index=False)
    response = client.get("/priority")
    assert response.status_code == 503
    assert "duplicate zone_id" in response.json()["detail"]


def test_cors_allows_only_local_frontend_origins(client):
    allowed = client.get("/health", headers={"Origin": "http://127.0.0.1:5173"})
    assert allowed.headers.get("access-control-allow-origin") == "http://127.0.0.1:5173"
    assert "access-control-allow-credentials" not in allowed.headers
    denied = client.get("/health", headers={"Origin": "https://example.com"})
    assert "access-control-allow-origin" not in denied.headers


def test_processed_outputs_are_written(client, data_dirs):
    client.get("/dashboard")
    processed = data_dirs["processed"]
    assert (processed / "zone_environmental_priority.csv").exists()
    assert (processed / "dashboard_summary.json").exists()
    assert (processed / "open_meteo_last_good.json").exists()


def test_csv_with_byte_order_mark_and_padded_headers(client, data_dirs):
    path = data_dirs["raw"] / config.REQUIRED_FILES["land_cover"]
    frame = pd.read_csv(path)
    frame.columns = [f" {column} " for column in frame.columns]
    path.write_text("﻿" + frame.to_csv(index=False), encoding="utf-8")
    rows = client.get("/priority").json()
    assert [row["zone_id"] for row in rows] == ["Z01", "Z05", "Z03", "Z04", "Z02"]


def test_empty_required_csv_returns_clear_error(client, data_dirs):
    (data_dirs["raw"] / config.REQUIRED_FILES["zone_ndvi"]).write_text("", encoding="utf-8")
    response = client.get("/priority")
    assert response.status_code == 422
    assert "is empty" in response.json()["detail"]
    assert client.get("/dashboard").status_code == 200


def test_header_only_zone_csv_returns_empty_ranking(client, data_dirs):
    path = data_dirs["raw"] / config.REQUIRED_FILES["zone_ndvi"]
    path.write_text(path.read_text(encoding="utf-8").splitlines()[0] + "\n", encoding="utf-8")
    assert client.get("/priority").json() == []


def test_infinite_year_in_history_files_does_not_break_endpoints(client, data_dirs):
    for key in ("historical_ndvi",):
        path = data_dirs["raw"] / config.REQUIRED_FILES[key]
        frame = pd.read_csv(path)
        frame.loc[0, "year"] = float("inf")
        frame.to_csv(path, index=False)
    path = data_dirs["raw"] / config.OPTIONAL_FILES["cell_history"]
    frame = pd.read_csv(path)
    frame.loc[0, "year"] = float("inf")
    frame.to_csv(path, index=False)
    spatial._feature_cache.update(key=None, payload=None)
    assert client.get("/priority").status_code == 200
    dashboard = client.get("/dashboard")
    assert dashboard.status_code == 200
    assert dashboard.json()["datasets"]["sentinel2_zone_history"]["latest_year"] == 2025
    assert client.get("/api/spatial/cells").status_code == 200
