# GreenPulse AI MVP Project Context

GreenPulse AI is a campus-scale environmental intelligence MVP for Thapar Institute of Engineering and Technology campus in Patiala, Punjab, India.

The MVP is intentionally CSV-first. It uses exported Google Earth Engine and air-quality datasets to answer:

- Which campus zones have weaker vegetation?
- Which zones show vegetation decline over time?
- Which zones have high built-up pressure?
- What is the recent modeled PM2.5 / PM10 stress near campus?
- Which zones should be reviewed first for environmental intervention?

## Study Area

Approximate coordinates used for Open-Meteo:

```text
Latitude: 30.356
Longitude: 76.367
Timezone: Asia/Kolkata
```

The campus was manually outlined in Google Earth Engine and divided into five analysis zones based on visible internal roads, campus blocks, built-up clusters, and open/green areas.

## Datasets

Required backend CSVs:

```text
thapar_campus_summary.csv
thapar_zone_ndvi_green_cover.csv
thapar_zone_land_cover.csv
thapar_historical_zone_ndvi_2018_2025.csv
```

Optional backend CSVs:

```text
thapar_landsat_historical_zone_ndvi_2014_2025.csv
openaq_location_5544_measurements.csv
```

Optional frontend GeoJSON:

```text
frontend/public/thapar_zones.geojson
```

## Main Technical Decision

Use a CSV-first architecture because the current datasets are already exported from Google Earth Engine and API sources as CSV. A database is unnecessary until the dashboard and scoring method are validated.

## MVP Boundaries

In scope:

- FastAPI backend
- React dashboard
- Zone-wise NDVI and land-cover pressure
- Historical Sentinel-2 NDVI trend
- Optional Landsat context
- Open-Meteo PM2.5 / PM10 chart
- Explainable environmental priority score
- Zone map using GeoJSON if available

Out of scope:

- ML model
- Deep learning
- ESP32 sensor integration
- Drone imagery workflow
- Plant species recommendation
- PostgreSQL/PostGIS
- Authentication
- Direct GeoTIFF rendering
- AQI prediction

## Demo Story

The campus was divided into five analysis zones. GreenPulse AI combines current NDVI, historical vegetation trend, Dynamic World land-cover pressure, and recent PM2.5 / PM10 stress to produce an explainable environmental priority ranking. The MVP shows which zones need review first and why.
