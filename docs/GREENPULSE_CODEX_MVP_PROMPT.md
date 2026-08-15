# Codex Prompt — GreenPulse AI MVP Setup

You are a senior full-stack engineer. Build a complete runnable MVP repository for a project called **GreenPulse AI**.

## 1. Project Summary

GreenPulse AI is a campus-scale environmental intelligence dashboard for Thapar campus. The MVP uses already-exported Google Earth Engine and AQI/climate datasets to show:

- Campus-level vegetation summary
- Zone-wise NDVI and green-cover percentage
- Zone-wise land-cover pressure
- Historical Sentinel-2 NDVI trend from 2018–2025
- Optional Landsat historical context from 2014–2025
- Recent modeled PM2.5 / PM10 data from Open-Meteo using Thapar coordinates
- Environmental priority ranking by zone using an explainable rule-based score

The MVP must not include ML, ESP32, drone, plant species recommendation, PostGIS, or complex GeoTIFF rendering yet. Those should be mentioned as future scope only.

## 2. Build Goal

Create a clean, minimal, runnable repo with:

```text
greenpulse-ai/
  backend/
  frontend/
  data/
  docs/
  README.md
```

The app must run locally with:

```bash
# backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# frontend
cd frontend
npm install
npm run dev
```

## 3. Dataset Inputs

Assume the following CSV files will be provided by the user and placed in:

```text
backend/data/raw/
```

Required files:

```text
thapar_campus_summary.csv
thapar_zone_ndvi_green_cover.csv
thapar_zone_land_cover.csv
thapar_historical_zone_ndvi_2018_2025.csv
```

Optional files:

```text
thapar_landsat_historical_zone_ndvi_2014_2025.csv
openaq_location_5544_measurements.csv
```

Also assume this GeoJSON file will be placed in:

```text
frontend/public/thapar_zones.geojson
```

If `thapar_zones.geojson` is missing, the frontend should still work without crashing and should show a message: "Zone map file not found. Priority table and charts are still available."

## 4. Current MVP Scope

### Include

- FastAPI backend
- React + Vite frontend
- Tailwind CSS or plain CSS with clean styling
- Recharts charts
- React Leaflet map if GeoJSON exists
- CSV-first data loading
- Local file-based processing
- Open-Meteo recent PM2.5 / PM10 API fetch with cache fallback
- Explainable priority scoring

### Exclude for MVP

- ML model
- Deep learning
- ESP32 sensor ingestion
- Drone upload
- Plant species recommendation
- PostgreSQL/PostGIS
- Authentication
- Direct browser rendering of GeoTIFF files
- Complex deployment scripts

## 5. Backend Requirements

Use FastAPI.

### Backend structure

```text
backend/
  app/
    __init__.py
    main.py
    config.py
    data_loader.py
    scoring.py
    external_apis.py
    schemas.py
  data/
    raw/
      .gitkeep
    processed/
      .gitkeep
  requirements.txt
  README.md
```

### Backend dependencies

`backend/requirements.txt`:

```text
fastapi
uvicorn
pandas
numpy
requests
python-multipart
```

### Backend behavior

The backend should load CSVs from:

```text
backend/data/raw/
```

and generate processed outputs in:

```text
backend/data/processed/
```

Processed output required:

```text
zone_environmental_priority.csv
open_meteo_recent_hourly.csv
dashboard_summary.json
```

### Backend API endpoints

Implement these endpoints:

#### `GET /`

Return project status.

Response:

```json
{
  "project": "GreenPulse AI",
  "status": "running",
  "scope": "CSV-first MVP"
}
```

#### `GET /health`

Return:

```json
{
  "ok": true
}
```

#### `GET /summary`

Load `thapar_campus_summary.csv` and return the first row as JSON. If the file is missing, return HTTP 404 with a clear message.

#### `GET /zones/ndvi`

Load `thapar_zone_ndvi_green_cover.csv` and return records.

#### `GET /zones/land-cover`

Load `thapar_zone_land_cover.csv` and return records.

#### `GET /zones/historical-ndvi`

Load `thapar_historical_zone_ndvi_2018_2025.csv` and return records.

#### `GET /zones/landsat-history`

Optional. If `thapar_landsat_historical_zone_ndvi_2014_2025.csv` exists, return records. If missing, return an empty list with a message.

#### `GET /aqi/open-meteo/recent`

Query Open-Meteo Air Quality API with default params:

```text
latitude=30.356
longitude=76.367
hourly=pm10,pm2_5
timezone=Asia/Kolkata
start_date=2026-05-18
end_date=2026-05-30
```

Allow query params:

```text
start_date
end_date
```

Fetch URL:

```text
https://air-quality-api.open-meteo.com/v1/air-quality
```

Cache the returned hourly data to:

```text
backend/data/processed/open_meteo_recent_hourly.csv
```

If the API fails and cache exists, serve the cached CSV.

Return:

```json
{
  "source": "Open-Meteo Air Quality API",
  "note": "Modeled air-quality estimate near Thapar campus, not a campus sensor.",
  "location": {
    "latitude": 30.356,
    "longitude": 76.367
  },
  "stress_score": 72.4,
  "records": []
}
```

#### `GET /priority`

Generate the final environmental priority table by combining:

- zone NDVI CSV
- zone land-cover CSV
- historical Sentinel NDVI CSV
- recent Open-Meteo PM stress score, if available

Save to:

```text
backend/data/processed/zone_environmental_priority.csv
```

Return the priority table as JSON.

#### `GET /dashboard`

Return a single object containing:

```json
{
  "summary": {},
  "priority": [],
  "historical_ndvi": [],
  "recent_aqi": {},
  "notes": []
}
```

This endpoint should support the frontend loading most data in one request.

## 6. Scoring Logic

Use an explainable rule-based score. Do not use ML.

### Variables

```text
Low Green Cover Score = 100 - green_cover_percent

Tree Gap Score = 100 - tree_percent

Built-up Pressure Score = built_up_percent

NDVI Change = latest_year_mean_ndvi - first_year_mean_ndvi

NDVI Decline Score:
- 0 if NDVI change >= 0
- abs(ndvi_change) / 0.10 * 100 if NDVI declines
- capped at 100

AQI Stress Score:
- calculated from recent Open-Meteo PM data
- use last 24 available hourly records
- pm25_score = min((pm25_avg / 60) * 100, 100)
- pm10_score = min((pm10_avg / 100) * 100, 100)
- AQI stress = 0.6 * pm25_score + 0.4 * pm10_score
- if no AQI data exists, use default 60
```

### Final score

```text
Environmental Priority Score =
0.35 × Low Green Cover Score
+ 0.25 × NDVI Decline Score
+ 0.20 × Built-up Pressure Score
+ 0.10 × Tree Gap Score
+ 0.10 × AQI Stress Score
```

### Priority class

```text
0–30 = Low
31–50 = Moderate
51–70 = High
71–100 = Urgent
```

### Reason generation

For each zone, generate a readable reason.

Examples:

```text
Priority is driven by low green-cover percentage, declining NDVI trend, and high built-up pressure.
```

```text
Zone has relatively stable vegetation and lower intervention priority.
```

Important: do not mention plant species.

## 7. Frontend Requirements

Use React + Vite.

### Frontend structure

```text
frontend/
  src/
    main.jsx
    App.jsx
    api.js
    components/
      SummaryCards.jsx
      PriorityTable.jsx
      NDVITrendChart.jsx
      AQIChart.jsx
      CampusMap.jsx
      ZoneDetails.jsx
      DataNotes.jsx
    styles.css
  public/
    thapar_zones.geojson
  package.json
  README.md
```

### Frontend UI

Single-page dashboard with these sections:

1. Header
2. Summary cards
3. Zone priority ranking
4. Campus zone map
5. Selected zone detail panel
6. Historical NDVI trend chart
7. Recent PM2.5 / PM10 chart
8. Data notes / limitations

### Summary cards

Cards should show:

- Total campus area in hectares
- Green cover %
- Average NDVI
- Highest priority zone
- Recent PM stress score

### Priority table

Columns:

```text
Rank
Zone
Green Cover %
NDVI Change
Built-up %
Priority Score
Priority Class
Reason
```

Sort descending by priority score.

### Zone map

Use React Leaflet if `thapar_zones.geojson` exists.

Color zones by priority class:

```text
Low = green
Moderate = yellow
High = orange
Urgent = red
```

If GeoJSON feature properties contain `zone_id`, match priority records by `zone_id`.

On zone click, select that zone and show details in `ZoneDetails`.

If GeoJSON is missing or fails to load, show a clean fallback box and keep the rest of the dashboard working.

### NDVI trend chart

Use Recharts.

Default chart:

- x-axis: year
- y-axis: mean_ndvi
- series: selected zone
- if no selected zone, show all zones or the highest-priority zone

### AQI chart

Use Recharts.

Chart:

- x-axis: time
- y-axis: µg/m³
- lines: pm2_5 and pm10

Label clearly:

```text
Modeled PM estimate near Thapar campus from Open-Meteo.
```

### Data notes

Show these notes:

```text
- NDVI and land-cover data were generated from Google Earth Engine.
- Dynamic World land-cover outputs are used as zone-level indicators, not building-level ground truth.
- Open-Meteo PM2.5 / PM10 values are modeled estimates near the campus coordinates, not direct campus sensor readings.
- ML, ESP32 sensing, drone validation, and plant species recommendation are future-scope modules.
```

## 8. README Requirements

Create a root `README.md` with:

- Project overview
- MVP scope
- Dataset list
- How to place CSV files
- How to run backend
- How to run frontend
- API endpoints
- Scoring formula
- Known limitations
- Future scope

## 9. Quality Requirements

- Code should be clean and readable.
- Handle missing files gracefully.
- Do not crash frontend if one dataset is missing.
- Keep all formulas transparent.
- No ML implementation in this MVP.
- No fake data unless explicitly placed in a sample fallback file.
- Add useful comments where the logic is non-obvious.
- Use stable, simple UI over fancy animation.

## 10. Deliverables

Build the full repo with:

```text
backend app
frontend app
README.md
docs/PROJECT_CONTEXT.md
```

Also include:

```text
backend/data/raw/README.md
backend/data/processed/README.md
frontend/public/README.md
```

The project should be runnable locally and demo-ready with the provided CSV files.
