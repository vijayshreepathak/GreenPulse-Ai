# GreenPulse AI

GreenPulse AI is a campus-scale environmental intelligence dashboard for Thapar Institute of Engineering and Technology. This MVP converts already-exported Google Earth Engine CSVs and recent modeled PM data into a simple, explainable dashboard for vegetation health and zone-level environmental priority.

## MVP Scope

Included:

- FastAPI backend with CSV-first local data loading
- React + Vite frontend
- Recharts visualizations
- React Leaflet campus zone map when `thapar_zones.geojson` is available
- Open-Meteo modeled PM2.5 / PM10 fetch with CSV cache fallback
- Explainable rule-based environmental priority scoring

Excluded for this MVP:

- ML or deep learning
- ESP32 sensor ingestion
- Drone upload or validation workflow
- Plant species recommendation
- PostgreSQL/PostGIS
- Authentication
- Direct browser GeoTIFF rendering
- Complex deployment scripts

## Repository Structure

```text
backend/
frontend/
data/
docs/
README.md
```

## Dataset Placement

Place required CSV files in:

```text
backend/data/raw/
```

Required:

```text
thapar_campus_summary.csv
thapar_zone_ndvi_green_cover.csv
thapar_zone_land_cover.csv
thapar_historical_zone_ndvi_2018_2025.csv
```

Optional:

```text
thapar_landsat_historical_zone_ndvi_2014_2025.csv
openaq_location_5544_measurements.csv
```

Place the optional GeoJSON map file in:

```text
frontend/public/thapar_zones.geojson
```

If the GeoJSON is missing, the frontend shows a map fallback and keeps the priority table and charts available.

## Run Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend URL:

```text
http://localhost:8000
```

## Run Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

Set `VITE_API_BASE_URL` if the backend runs somewhere other than `http://localhost:8000`.

## API Endpoints

```text
GET /
GET /health
GET /summary
GET /zones/ndvi
GET /zones/land-cover
GET /zones/historical-ndvi
GET /zones/landsat-history
GET /aqi/open-meteo/recent
GET /priority
GET /dashboard
```

Processed outputs are written to:

```text
backend/data/processed/
```

Generated files:

```text
zone_environmental_priority.csv
open_meteo_recent_hourly.csv
dashboard_summary.json
```

## Scoring Formula

```text
Low Green Cover Score = 100 - green_cover_percent
Tree Gap Score = 100 - tree_percent
Built-up Pressure Score = built_up_percent
NDVI Change = latest_year_mean_ndvi - first_year_mean_ndvi
```

If NDVI declines:

```text
NDVI Decline Score = min(abs(ndvi_change) / 0.10 * 100, 100)
```

Otherwise:

```text
NDVI Decline Score = 0
```

AQI stress uses the last 24 available Open-Meteo hourly PM records:

```text
pm25_score = min((pm25_avg / 60) * 100, 100)
pm10_score = min((pm10_avg / 100) * 100, 100)
AQI Stress Score = 0.6 * pm25_score + 0.4 * pm10_score
```

If no AQI data exists, AQI stress defaults to `60`.

Final score:

```text
Environmental Priority Score =
0.35 * Low Green Cover Score
+ 0.25 * NDVI Decline Score
+ 0.20 * Built-up Pressure Score
+ 0.10 * Tree Gap Score
+ 0.10 * AQI Stress Score
```

Priority classes:

```text
0-30 = Low
31-50 = Moderate
51-70 = High
71-100 = Urgent
```

## Known Limitations

- NDVI thresholds are project-calibrated, not universal ecological classifications.
- Dynamic World land-cover values are zone-level indicators, not building-level ground truth.
- Open-Meteo PM2.5 / PM10 values are modeled estimates near the campus coordinates, not direct campus sensor readings.
- OpenAQ short-range data should not be used for long-term trend or causality.
- The priority score is explainable and rule-based, not ML-derived.

## Future Scope

- 50m x 50m grid-cell dataset
- K-Means clustering of environmental patterns
- Random Forest priority classification after suitable training data exists
- ESP32 PM2.5 / PM10 sensor node
- Drone or phone-image validation
- Plant species recommendation
- PostGIS database
- GeoTIFF tile rendering
- Render/Vercel deployment
