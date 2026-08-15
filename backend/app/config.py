from pathlib import Path


PROJECT_NAME = "GreenPulse AI"
BASE_DIR = Path(__file__).resolve().parents[1]
RAW_DATA_DIR = BASE_DIR / "data" / "raw"
PROCESSED_DATA_DIR = BASE_DIR / "data" / "processed"

OPEN_METEO_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
THAPAR_LATITUDE = 30.356
THAPAR_LONGITUDE = 76.367
THAPAR_TIMEZONE = "Asia/Kolkata"
DEFAULT_OPEN_METEO_START_DATE = "2026-05-18"
DEFAULT_OPEN_METEO_END_DATE = "2026-05-30"
DEFAULT_AQI_STRESS_SCORE = 60.0

REQUIRED_FILES = {
    "summary": "thapar_campus_summary.csv",
    "zone_ndvi": "thapar_zone_ndvi_green_cover.csv",
    "land_cover": "thapar_zone_land_cover.csv",
    "historical_ndvi": "thapar_historical_zone_ndvi_2018_2025.csv",
}

OPTIONAL_FILES = {
    "landsat_history": "thapar_landsat_historical_zone_ndvi_2014_2025.csv",
    "openaq": "openaq_location_5544_measurments.csv",
}

OPTIONAL_FILE_ALIASES = {
    "openaq": ["openaq_location_5544_measurements.csv"],
}

PROCESSED_PRIORITY_FILE = PROCESSED_DATA_DIR / "zone_environmental_priority.csv"
PROCESSED_OPEN_METEO_FILE = PROCESSED_DATA_DIR / "open_meteo_recent_hourly.csv"
PROCESSED_DASHBOARD_FILE = PROCESSED_DATA_DIR / "dashboard_summary.json"

DASHBOARD_NOTES = [
    "NDVI and land-cover data were generated from Google Earth Engine.",
    "Dynamic World land-cover outputs are used as zone-level indicators, not building-level ground truth.",
    "Open-Meteo PM2.5 / PM10 values are modeled estimates near the campus coordinates, not direct campus sensor readings.",
    "ML, ESP32 sensing, drone validation, and plant species recommendation are future-scope modules.",
]
