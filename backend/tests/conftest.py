import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from fastapi.testclient import TestClient

from app import config, external_apis, spatial

REPO_RAW_DIR = Path(__file__).resolve().parents[1] / "data" / "raw"
IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture()
def data_dirs(tmp_path, monkeypatch):
    """Isolated copies of the committed raw datasets plus an empty processed dir."""
    raw = tmp_path / "raw"
    processed = tmp_path / "processed"
    shutil.copytree(REPO_RAW_DIR, raw)
    processed.mkdir()
    monkeypatch.setattr(config, "RAW_DATA_DIR", raw)
    monkeypatch.setattr(config, "PROCESSED_DATA_DIR", processed)
    monkeypatch.setattr(config, "PROCESSED_PRIORITY_FILE", processed / "zone_environmental_priority.csv")
    monkeypatch.setattr(config, "PROCESSED_OPEN_METEO_FILE", processed / "open_meteo_recent_hourly.csv")
    monkeypatch.setattr(config, "PROCESSED_OPEN_METEO_CACHE_FILE", processed / "open_meteo_last_good.json")
    monkeypatch.setattr(config, "PROCESSED_DASHBOARD_FILE", processed / "dashboard_summary.json")
    spatial._feature_cache.update(key=None, payload=None)
    return {"raw": raw, "processed": processed}


class FakeResponse:
    def __init__(self, payload=None, status_code=200, json_error=False):
        self._payload = payload
        self.status_code = status_code
        self._json_error = json_error

    def json(self):
        if self._json_error:
            raise ValueError("not json")
        return self._payload


def provider_payload(now=None, hours=30, pm25=30.0, pm10=50.0, future_hours=1):
    """Open-Meteo-shaped payload with naive Asia/Kolkata timestamps ending at ``now``."""
    now = (now or datetime.now(timezone.utc)).astimezone(IST).replace(minute=0, second=0, microsecond=0, tzinfo=None)
    times = [now - timedelta(hours=offset) for offset in range(hours - 1, -1, -1)]
    times += [now + timedelta(hours=offset) for offset in range(1, future_hours + 1)]
    labels = [moment.strftime("%Y-%m-%dT%H:%M") for moment in times]
    count = len(labels)
    return {
        "current": {"time": labels[hours - 1], "pm2_5": pm25, "pm10": pm10},
        "hourly": {"time": labels, "pm2_5": [pm25] * count, "pm10": [pm10] * count},
    }


@pytest.fixture()
def provider(monkeypatch):
    """Controls what the mocked Open-Meteo endpoint returns. No real network access."""
    state = {"calls": 0, "response": FakeResponse(provider_payload()), "error": None}

    def fake_get(url, params=None, timeout=None):
        state["calls"] += 1
        state["last_params"] = params
        if state["error"] is not None:
            raise state["error"]
        return state["response"]

    monkeypatch.setattr(external_apis.requests, "get", fake_get)
    monkeypatch.setattr(external_apis, "_last_failure", {"at": None, "error": None})
    state["set_payload"] = lambda payload, status=200: state.update(response=FakeResponse(payload, status), error=None)
    state["fail"] = lambda error=requests.ConnectionError("down"): state.update(error=error)
    return state


@pytest.fixture(autouse=True)
def isolated_ai(tmp_path, monkeypatch):
    """Never read the real backend/.env or reach Gemini: every test gets a fresh AI service.

    Tests that need the Copilot configure it through ``ai_service`` (see test_ai.py).
    """
    from app.ai import routes

    monkeypatch.setattr(config, "ENV_FILE", tmp_path / "no-such.env")
    for name in ("GEMINI_API_KEY", "GEMINI_MODEL", "AI_ASSISTANT_ENABLED", "AI_MAX_TOOL_CALLS", "AI_MAX_HISTORY_MESSAGES", "AI_TIMEOUT_SECONDS"):
        monkeypatch.delenv(name, raising=False)

    def no_real_provider(_settings):
        raise AssertionError("Tests must not create a real Gemini client.")

    service = routes.AIService(provider_factory=no_real_provider)
    monkeypatch.setattr(routes, "service", service)
    return service


@pytest.fixture()
def client(data_dirs, provider):
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
