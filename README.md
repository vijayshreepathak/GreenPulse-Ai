# GreenPulse AI

GreenPulse AI is a campus-scale environmental intelligence product for Thapar Institute of Engineering and Technology. It converts satellite vegetation, GIS land-cover, historical change, 50 m spatial features, and modeled air-quality context into explainable environmental intervention priorities.

## Product Capabilities

- Compact campus overview with six live/data-derived metrics
- Five-zone explainable environmental priority ranking
- 447 usable 50 m spatial analysis cells
- Interactive layers for priority, NDVI, green cover, built-up pressure, tree cover, NDBI, NDWI, plantable potential, and historical NDVI decline
- Zone and cell detail panels with transparent score contributors
- Sentinel-2 zone/cell trends for 2018-2025
- Separate Landsat long-term context for 2014-2025
- Live modeled PM2.5 / PM10 context with 24H, 48H, and 7D views
- Last-good Open-Meteo cache and 12-minute frontend refresh
- Deterministic insights and a source/limitations methodology view

No ML, local sensor, drone, or plant-species module is represented as implemented.

## Architecture

```text
greenpulse_ai/
  backend/                 FastAPI API, scoring, processing, provider cache
  frontend/                React + Vite product interface
  data/                    Project data guidance
  docs/                    Project context and source documentation
  README.md
```

The frontend uses React, React Leaflet, Recharts, Framer Motion, Lucide icons, and plain CSS. The backend uses FastAPI, pandas, NumPy, and requests.

## Dataset Placement

Place the tabular exports in `backend/data/raw/`.

Required campus and zone files:

```text
thapar_campus_summary.csv
thapar_zone_ndvi_green_cover.csv
thapar_zone_land_cover.csv
thapar_historical_zone_ndvi_2018_2025.csv
```

Enhanced spatial and historical files:

```text
thapar_50m_master_current_2025.csv
thapar_50m_historical_ndvi_2018_2025.csv
thapar_landsat_historical_zone_ndvi_2014_2025.csv
```

Optional OpenAQ reference export:

```text
openaq_location_5544_measurements.csv
```

Place the five-zone map at `frontend/public/thapar_zones.geojson`. If it is missing, the frontend keeps tables and charts available and shows the required fallback message.

## Run Locally

Backend:

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open:

```text
Frontend: http://127.0.0.1:5173
Backend API: http://127.0.0.1:8000
API docs: http://127.0.0.1:8000/docs
```

Set `VITE_API_BASE_URL` when the API is not running at `http://localhost:8000`.

## API Endpoints

Core:

```text
GET /
GET /health
GET /summary
GET /zones/ndvi
GET /zones/land-cover
GET /zones/historical-ndvi
GET /zones/landsat-history
GET /priority
GET /dashboard
```

Spatial intelligence:

```text
GET /api/spatial/cells
GET /api/spatial/cells/history?cell_id=C_12613%2C67168
GET /api/spatial/cells/history?zone_id=Z01
```

Live modeled environment:

```text
GET /api/environment/current
GET /api/environment/current?refresh=true
GET /api/environment/air-quality/history?hours=24
GET /api/environment/air-quality/history?hours=48
GET /api/environment/air-quality/history?hours=168
GET /aqi/open-meteo/recent
```

Open-Meteo responses expose `data_mode`, `freshness`, `last_updated`, current PM values, 24-hour averages, PM stress, and hourly records. Successful provider responses are saved as the last-good cache. Provider failure serves cached values without claiming they are live measurements.

## Priority Formula

```text
Low Green Cover Score = 100 - green_cover_percent
Tree Gap Score = 100 - tree_percent
Built-up Pressure Score = built_up_percent
NDVI Change = latest_year_mean_ndvi - first_year_mean_ndvi
NDVI Decline Score = min(abs(ndvi_change) / 0.10 * 100, 100), only when change < 0
```

The last 24 modeled hourly PM records produce:

```text
pm25_score = min((pm25_avg / 60) * 100, 100)
pm10_score = min((pm10_avg / 100) * 100, 100)
AQI Stress = 0.6 * pm25_score + 0.4 * pm10_score
```

Final zone score:

```text
0.35 * Low Green Cover Score
+ 0.25 * NDVI Decline Score
+ 0.20 * Built-up Pressure Score
+ 0.10 * Tree Gap Score
+ 0.10 * AQI Stress Score
```

Classes: `Low` 0-30, `Moderate` 31-50, `High` 51-70, and `Urgent` 71-100.

## Generated Outputs

Runtime outputs are written to `backend/data/processed/`:

```text
zone_environmental_priority.csv
open_meteo_recent_hourly.csv
open_meteo_last_good.json
dashboard_summary.json
```

They are intentionally ignored by Git except for folder documentation.

## Scientific Limitations

- NDVI thresholds are project-calibrated, not universal ecological classifications.
- Dynamic World is a supporting land-cover classification, not building-level ground truth.
- Open-Meteo / CAMS values are modeled regional context near one campus coordinate, not campus sensor or zone-level measurements.
- Sentinel-2 and Landsat have different spatial characteristics and are shown as separate series.
- Cell-level satellite features are available, but the formal priority score remains zone-level until a validated cell scoring method is approved.
- Priority logic is transparent and rule-based; no causal relationship between vegetation and air quality is claimed.

## Future Validation Layers

- Local PM sensor validation
- Field and drone validation workflows
- Reviewed cell-level intervention scoring
- ML only after suitable labeled training data exists
- PostGIS and production deployment architecture
