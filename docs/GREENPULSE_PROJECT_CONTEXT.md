# GreenPulse AI MVP — Project Context for Codex

## 1. Project Name

**GreenPulse AI**

## 2. Current MVP Positioning

GreenPulse AI is a campus-scale environmental intelligence MVP for Thapar campus. The current version is not a hardware project, not a drone project, not a plant recommendation project, and not an ML-first project.

The MVP should show how satellite and air-quality datasets can be converted into a simple environmental priority dashboard.

The system should help answer:

1. Which campus zones have weaker vegetation?
2. Which zones show vegetation decline over time?
3. Which zones have high built-up pressure?
4. What is the recent PM2.5 / PM10 stress near the campus?
5. Which zones should be reviewed first for environmental intervention?

## 3. Current Scope

### In Scope

- CSV-first backend
- FastAPI APIs
- React dashboard
- Zone-wise NDVI analysis
- Zone-wise land-cover pressure
- Historical Sentinel-2 NDVI trend
- Optional Landsat historical context
- Open-Meteo PM2.5 / PM10 chart
- Explainable environmental priority score
- Zone map using GeoJSON if available

### Out of Scope for Current MVP

- ML model
- Deep learning
- ESP32 sensor integration
- Drone imagery
- Plant species recommendation
- PostgreSQL/PostGIS
- Authentication
- Direct GeoTIFF rendering in the frontend
- AQI prediction

These may be listed as future-scope modules.

## 4. Study Area

Pilot region:

```text
Thapar Institute of Engineering and Technology campus, Patiala, Punjab, India
```

Approximate campus coordinates used for Open-Meteo:

```text
Latitude: 30.356
Longitude: 76.367
Timezone: Asia/Kolkata
```

The campus was manually outlined in Google Earth Engine. The campus was divided into five analysis zones based on visible internal roads, campus blocks, built-up clusters, and open/green areas.

## 5. Available Datasets

### 5.1 Campus Summary CSV

File:

```text
thapar_campus_summary.csv
```

Purpose:

- Overall campus area
- Campus green cover percentage
- Average NDVI
- Low/moderate/dense vegetation area

Use in dashboard summary cards.

### 5.2 Current Zone NDVI CSV

File:

```text
thapar_zone_ndvi_green_cover.csv
```

Purpose:

- Zone-wise current NDVI
- Zone-wise green-cover percentage
- Zone-wise vegetation status

Expected important columns:

```text
zone_id
zone_name
mean_ndvi
green_cover_percent
vegetation_status
zone_area_sq_m
zone_area_hectares
```

Use in:

- Priority table
- Zone detail panel
- Map coloring
- Dashboard summary

### 5.3 Zone Land-Cover CSV

File:

```text
thapar_zone_land_cover.csv
```

Purpose:

- Zone-wise Dynamic World land-cover percentages
- Built-up pressure
- Tree percentage
- Grass/bare/potential plantable indicators

Expected important columns:

```text
zone_id
zone_name
tree_percent
grass_percent
built_up_percent
bare_land_percent
potential_plantable_percent
```

Important limitation:

Dynamic World is useful as a zone-level supporting indicator. It should not be treated as exact building-level ground truth because the campus is small and Sentinel-2/Dynamic World resolution is around 10m.

### 5.4 Historical Sentinel-2 NDVI CSV

File:

```text
thapar_historical_zone_ndvi_2018_2025.csv
```

Purpose:

- Primary historical vegetation trend
- Zone-wise NDVI from 2018 to 2025
- Same season comparison, ideally Oct-Dec

Expected important columns:

```text
year
season
zone_id
zone_name
mean_ndvi
green_cover_percent
vegetation_status
image_count
```

Use in:

- NDVI trend chart
- NDVI decline score
- Priority scoring

### 5.5 Landsat Historical NDVI CSV

File:

```text
thapar_landsat_historical_zone_ndvi_2014_2025.csv
```

Purpose:

- Secondary long-term vegetation context
- Lower resolution than Sentinel-2
- Use only as optional context

Do not use as the primary dataset for campus-level scoring unless Sentinel data is missing.

### 5.6 OpenAQ Recent Measurement CSV

File:

```text
openaq_location_5544_measurements.csv
```

Purpose:

- Recent pollutant snapshot
- Station-level reference
- Pollutants may include PM2.5, PM10, NO2, SO2, O3, CO, wind, humidity, temperature

Limitation:

The current file may only contain a short date range. Do not use it for historical correlation or ML unless a longer time period is available.

### 5.7 Open-Meteo Air Quality API

Use endpoint:

```text
https://air-quality-api.open-meteo.com/v1/air-quality
```

Default parameters:

```text
latitude=30.356
longitude=76.367
hourly=pm10,pm2_5
timezone=Asia/Kolkata
start_date=2026-05-18
end_date=2026-05-30
```

Purpose:

- Recent modeled PM2.5 / PM10 chart
- Recent PM stress score
- AQI context panel

Important label:

```text
Modeled air-quality estimate near Thapar campus, not a direct campus sensor.
```

## 6. Main Scoring Logic

The MVP should use explainable rule-based scoring.

### 6.1 Low Green Cover Score

```text
Low Green Cover Score = 100 - green_cover_percent
```

### 6.2 Tree Gap Score

```text
Tree Gap Score = 100 - tree_percent
```

### 6.3 Built-up Pressure Score

```text
Built-up Pressure Score = built_up_percent
```

### 6.4 NDVI Change

Use historical Sentinel-2 NDVI.

```text
NDVI Change = latest_year_mean_ndvi - first_year_mean_ndvi
```

Example:

```text
NDVI Change = NDVI_2025 - NDVI_2018
```

### 6.5 NDVI Decline Score

```text
If NDVI Change >= 0:
  NDVI Decline Score = 0

If NDVI Change < 0:
  NDVI Decline Score = min(abs(NDVI Change) / 0.10 * 100, 100)
```

### 6.6 AQI Stress Score

Use Open-Meteo recent hourly PM2.5 / PM10.

Use last 24 available records:

```text
pm25_avg = mean(last 24 PM2.5 records)
pm10_avg = mean(last 24 PM10 records)

pm25_score = min((pm25_avg / 60) * 100, 100)
pm10_score = min((pm10_avg / 100) * 100, 100)

AQI Stress Score = 0.6 * pm25_score + 0.4 * pm10_score
```

If Open-Meteo data is missing, use:

```text
AQI Stress Score = 60
```

### 6.7 Final Environmental Priority Score

```text
Environmental Priority Score =
0.35 × Low Green Cover Score
+ 0.25 × NDVI Decline Score
+ 0.20 × Built-up Pressure Score
+ 0.10 × Tree Gap Score
+ 0.10 × AQI Stress Score
```

### 6.8 Priority Classes

```text
0–30 = Low
31–50 = Moderate
51–70 = High
71–100 = Urgent
```

## 7. Explainability

Each zone should include a generated reason.

Possible triggers:

```text
green_cover_percent < 60 → low green-cover percentage
ndvi_change < -0.05 → declining NDVI trend
built_up_percent > 70 → high built-up pressure
aqi_stress_score > 60 → elevated PM/AQI stress
```

Example reason:

```text
Priority is driven by low green-cover percentage, declining NDVI trend, and high built-up pressure.
```

## 8. MVP Dashboard Requirements

The frontend dashboard should show:

1. Header
2. Campus summary cards
3. Zone priority table
4. Campus map from GeoJSON, if available
5. Zone detail panel
6. Historical Sentinel NDVI trend chart
7. Recent PM2.5 / PM10 chart
8. Data notes / limitations

## 9. Dashboard Cards

Cards should show:

- Total campus area
- Green cover %
- Average NDVI
- Highest priority zone
- Recent PM stress score

## 10. Priority Table

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

Sort by priority score descending.

## 11. NDVI Trend Chart

Use historical Sentinel-2 data.

- X-axis: year
- Y-axis: mean_ndvi
- Series: selected zone
- Default: highest-priority zone

## 12. AQI / PM Chart

Use Open-Meteo data.

- X-axis: time
- Y-axis: µg/m³
- Lines: pm2_5 and pm10

Label clearly as modeled PM data.

## 13. Map Layer

Use `frontend/public/thapar_zones.geojson` if available.

Color by priority class:

```text
Low = green
Moderate = yellow
High = orange
Urgent = red
```

If GeoJSON is missing, show a friendly fallback message.

## 14. Backend API Summary

Endpoints:

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

## 15. Main Technical Decision

Use a CSV-first architecture.

Reason:

- The current datasets are exported from Google Earth Engine and API sources as CSV.
- The MVP needs to be demo-ready quickly.
- Database/PostGIS is not necessary until the dashboard and scoring are validated.
- This approach keeps the project simple and reproducible.

## 16. Known Limitations

Mention these clearly in dashboard notes and README:

- NDVI thresholds are project-calibrated, not universal ecological classifications.
- Dynamic World is used as a zone-level indicator, not building-level ground truth.
- Open-Meteo PM values are modeled estimates, not campus sensor measurements.
- OpenAQ short-range data should not be used for long-term trend or causality.
- The priority score is explainable and rule-based, not ML-derived.
- ML will be added later only after creating grid-cell-level training data.

## 17. Future Scope

Future modules:

- 50m × 50m grid-cell dataset
- K-Means clustering of environmental patterns
- Random Forest priority classification
- ESP32 PM2.5 / PM10 sensor node
- Drone or phone-image validation
- Plant species recommendation
- PostGIS database
- GeoTIFF tile rendering
- Deployment on Render/Vercel

## 18. Demo Story

Use this demo story:

```text
The campus was divided into five analysis zones. GreenPulse AI combines current NDVI, historical vegetation trend, Dynamic World land-cover pressure, and recent PM2.5 / PM10 stress to produce an explainable environmental priority ranking. The MVP shows which zones need review first and why.
```

## 19. Success Criteria

The MVP is successful if:

- Backend APIs run locally
- Frontend loads dashboard
- Campus summary appears
- Zone priority table appears
- User can select a zone
- NDVI trend chart works
- PM2.5 / PM10 chart works
- Priority reasons are readable
- Missing optional files do not crash the app
