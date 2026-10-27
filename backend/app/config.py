import os
from pathlib import Path


PROJECT_NAME = "GreenPulse AI"
API_VERSION = "0.2.0"
BASE_DIR = Path(__file__).resolve().parents[1]
RAW_DATA_DIR = BASE_DIR / "data" / "raw"
PROCESSED_DATA_DIR = BASE_DIR / "data" / "processed"

# The provider URL can be overridden (for example to an unreachable host) to
# demonstrate offline behaviour without touching code.
OPEN_METEO_URL = os.getenv("GREENPULSE_OPEN_METEO_URL", "https://air-quality-api.open-meteo.com/v1/air-quality")
THAPAR_LATITUDE = 30.356
THAPAR_LONGITUDE = 76.367
THAPAR_TIMEZONE = "Asia/Kolkata"
THAPAR_UTC_OFFSET_MINUTES = 330
DEFAULT_OPEN_METEO_START_DATE = "2026-05-18"
DEFAULT_OPEN_METEO_END_DATE = "2026-05-30"
OPEN_METEO_CACHE_TTL_MINUTES = 10
OPEN_METEO_CONNECT_TIMEOUT_SECONDS = 5
OPEN_METEO_READ_TIMEOUT_SECONDS = 12
OPEN_METEO_MAX_RANGE_DAYS = 31
AIR_QUALITY_LABEL = "Modelled air-quality estimates near TIET campus, not readings from campus sensors."

# --- Official MVP scoring methodology (documented in docs/GREENPULSE_PROJECT_CONTEXT.md) ---
# Changing any of these values changes the official ranking; the Scenario Lab in
# the frontend explores alternative weights without touching these.
SCORING_WEIGHTS = {
    "low_green_cover": 0.35,
    "ndvi_decline": 0.25,
    "built_up_pressure": 0.20,
    "tree_gap": 0.10,
    "pm_stress": 0.10,
}
NDVI_DECLINE_FULL_SCALE = 0.10
PM25_FULL_SCALE = 60.0
PM10_FULL_SCALE = 100.0
PM25_STRESS_WEIGHT = 0.6
PM10_STRESS_WEIGHT = 0.4
PM_AVERAGING_RECORDS = 24
DEFAULT_AQI_STRESS_SCORE = 60.0
# Upper bounds (inclusive) of each class; scores above the last bound are Urgent.
PRIORITY_CLASS_BOUNDS = [(30.0, "Low"), (50.0, "Moderate"), (70.0, "High")]
PRIORITY_CLASS_TOP = "Urgent"
PRIORITY_CLASS_UNAVAILABLE = "Unavailable"
# Percentages are accepted when they are within this tolerance of 0-100.
PERCENT_TOLERANCE = 1e-6

# Local development origins only. Override with a comma-separated list when
# serving the frontend from another local port.
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "GREENPULSE_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    ).split(",")
    if origin.strip()
]

# --- AI Copilot (Gemini). Secrets live only in backend/.env or the process environment. ---
ENV_FILE = BASE_DIR / ".env"
AI_DEFAULT_MODEL = "gemini-3.5-flash-lite"
# Optional second model (GEMINI_FALLBACK_MODEL), tried once when the primary is rate-limited,
# out of quota, unavailable or overloaded. Empty means no fallback.
AI_DEFAULT_FALLBACK_MODEL = ""
AI_DEFAULT_MAX_TOOL_CALLS = 4
AI_TOOL_CALL_CEILING = 4
AI_DEFAULT_MAX_HISTORY_MESSAGES = 12
AI_HISTORY_CEILING = 20
AI_DEFAULT_TIMEOUT_SECONDS = 30
AI_TIMEOUT_RANGE_SECONDS = (5, 120)
AI_MAX_MESSAGE_CHARS = 2000
AI_MAX_HISTORY_MESSAGE_CHARS = 4000
AI_MAX_REQUEST_BYTES = 64_000
AI_MAX_ANSWER_CHARS = 8000
# Per-client throttling for the unauthenticated local API.
AI_RATE_LIMIT_REQUESTS = 12
AI_RATE_LIMIT_WINDOW_SECONDS = 60
AI_MAX_CONCURRENT_PER_CLIENT = 2
AI_MAX_CONCURRENT_TOTAL = 6
AI_STATUS_VERIFY_TTL_SECONDS = 120

REQUIRED_FILES = {
    "summary": "thapar_campus_summary.csv",
    "zone_ndvi": "thapar_zone_ndvi_green_cover.csv",
    "land_cover": "thapar_zone_land_cover.csv",
    "historical_ndvi": "thapar_historical_zone_ndvi_2018_2025.csv",
}

OPTIONAL_FILES = {
    "landsat_history": "thapar_landsat_historical_zone_ndvi_2014_2025.csv",
    "openaq": "openaq_location_5544_measurments.csv",
    "cell_current": "thapar_50m_master_current_2025.csv",
    "cell_history": "thapar_50m_historical_ndvi_2018_2025.csv",
}

OPTIONAL_FILE_ALIASES = {
    "openaq": ["openaq_location_5544_measurements.csv"],
}

PROCESSED_PRIORITY_FILE = PROCESSED_DATA_DIR / "zone_environmental_priority.csv"
PROCESSED_OPEN_METEO_FILE = PROCESSED_DATA_DIR / "open_meteo_recent_hourly.csv"
PROCESSED_OPEN_METEO_CACHE_FILE = PROCESSED_DATA_DIR / "open_meteo_last_good.json"
PROCESSED_DASHBOARD_FILE = PROCESSED_DATA_DIR / "dashboard_summary.json"

DASHBOARD_NOTES = [
    "NDVI and land-cover data were generated from Google Earth Engine.",
    "The campus analysis includes five zones and 447 usable 50 m spatial cells.",
    "Dynamic World land-cover outputs are supporting indicators, not building-level ground truth.",
    "Open-Meteo PM2.5 / PM10 values are modelled estimates near the campus coordinates, not direct campus sensor readings.",
    "ML, ESP32 sensing, drone validation, and plant species recommendation are future-scope modules.",
]
