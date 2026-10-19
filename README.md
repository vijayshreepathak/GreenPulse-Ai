<!-- ============================== HEADER ============================== -->
<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:064e3b,50:059669,100:84cc16&height=200&section=header&text=GreenPulse%20AI&fontSize=56&fontColor=ffffff&fontAlignY=36&desc=Campus-scale%20environmental%20intelligence&descAlignY=58&descSize=18" alt="GreenPulse AI banner" />
</p>

<p align="center">
  <b>Satellite vegetation, land-cover pressure and air-quality context, turned into an <i>explainable</i> ranking of which campus zones need attention first.</b><br/>
  Pilot site: Thapar Institute of Engineering &amp; Technology, Patiala, Punjab, India
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-MVP-059669?style=for-the-badge" alt="Status: MVP" />
  <img src="https://img.shields.io/badge/version-0.1.0-0f766e?style=for-the-badge" alt="Version 0.1.0" />
  <img src="https://img.shields.io/badge/scoring-rule--based%20%26%20explainable-65a30d?style=for-the-badge" alt="Rule-based scoring" />
  <img src="https://img.shields.io/badge/architecture-CSV--first-334155?style=for-the-badge" alt="CSV-first" />
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-how-it-works">How It Works</a> •
  <a href="#-priority-scoring">Scoring</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-api-reference">API</a> •
  <a href="#-limitations">Limitations</a> •
  <a href="#-roadmap">Roadmap</a>
</p>

---

## 🌱 Overview

GreenPulse AI answers five practical questions for campus planners:

| # | Question | Signal used |
|:-:|---|---|
| 1 | Which zones have weaker vegetation? | Sentinel-2 NDVI, green-cover % |
| 2 | Which zones are losing vegetation over time? | NDVI change 2018 → 2025 |
| 3 | Which zones are under built-up pressure? | Dynamic World land cover |
| 4 | What is the recent PM2.5 / PM10 stress near campus? | Open-Meteo / CAMS modeled air quality |
| 5 | **Which zones should be reviewed first, and why?** | Weighted, explainable priority score |

The campus was outlined in Google Earth Engine and split into **5 analysis zones** and **447 usable 50 m × 50 m cells**. Every score shows its contributing factors and a plain-English reason, so no number is a black box.

> [!NOTE]
> This is an honest MVP: **no ML model, local sensor, drone, or plant-species module is implemented yet.** Those are listed under [Roadmap](#-roadmap).

---

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

**🗺️ Spatial intelligence**
- Interactive Leaflet map of 5 zones + 447 cells (50 m)
- 9 switchable layers: priority, NDVI, green cover, built-up, tree cover, NDBI, NDWI, plantable potential, NDVI decline
- Zone and cell detail panels with transparent score contributors
- Deep-link a layer with `?layer=ndvi`

</td>
<td width="50%" valign="top">

**📈 Vegetation trends**
- Sentinel-2 zone and cell NDVI trends, 2018–2025
- Separate Landsat long-term context, 2014–2025
- Sources are shown as separate series, never mixed

</td>
</tr>
<tr>
<td width="50%" valign="top">

**🌫️ Air-quality context**
- Live modeled PM2.5 / PM10 with 24H, 48H and 7D views
- 10-minute backend cache, 12-minute frontend auto-refresh
- Last-good cache served if the provider is down, clearly labelled as cached

</td>
<td width="50%" valign="top">

**🧠 Explainable priority**
- Weighted 5-factor score per zone, classed Low → Urgent
- Auto-generated reason for every zone
- Deterministic insights plus a sources and limitations view
- Missing optional files degrade gracefully and never crash the app

</td>
</tr>
</table>

---

## 🛠️ Tech Stack

<p align="center">
  <a href="https://skillicons.dev">
    <img src="https://skillicons.dev/icons?i=python,fastapi,react,vite,js,css,git,github&perline=8" alt="Tech stack icons" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Uvicorn-4051B5?style=flat-square" alt="Uvicorn" />
  <img src="https://img.shields.io/badge/pandas-150458?style=flat-square&logo=pandas&logoColor=white" alt="pandas" />
  <img src="https://img.shields.io/badge/NumPy-013243?style=flat-square&logo=numpy&logoColor=white" alt="NumPy" />
  <img src="https://img.shields.io/badge/Requests-2B5B84?style=flat-square" alt="Requests" />
  <br/>
  <img src="https://img.shields.io/badge/React%2018-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Vite%206-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Leaflet-199900?style=flat-square&logo=leaflet&logoColor=white" alt="Leaflet" />
  <img src="https://img.shields.io/badge/Recharts-22B5BF?style=flat-square" alt="Recharts" />
  <img src="https://img.shields.io/badge/Framer%20Motion-0055FF?style=flat-square&logo=framer&logoColor=white" alt="Framer Motion" />
  <img src="https://img.shields.io/badge/Lucide-F56565?style=flat-square&logo=lucide&logoColor=white" alt="Lucide" />
  <br/>
  <img src="https://img.shields.io/badge/Google%20Earth%20Engine-4285F4?style=flat-square&logo=googleearth&logoColor=white" alt="Google Earth Engine" />
  <img src="https://img.shields.io/badge/Sentinel--2-003247?style=flat-square" alt="Sentinel-2" />
  <img src="https://img.shields.io/badge/Landsat-0B3D91?style=flat-square&logo=nasa&logoColor=white" alt="Landsat" />
  <img src="https://img.shields.io/badge/Dynamic%20World-34A853?style=flat-square" alt="Dynamic World" />
  <img src="https://img.shields.io/badge/Open--Meteo-FF8C00?style=flat-square" alt="Open-Meteo" />
  <img src="https://img.shields.io/badge/OpenAQ-6E44FF?style=flat-square" alt="OpenAQ" />
</p>

| Layer | Technology | Role |
|---|---|---|
| **Frontend** | React 18, Vite 6, plain CSS | Single-page product interface |
| **Maps** | Leaflet, React Leaflet | Zone and 50 m cell layers |
| **Charts** | Recharts | NDVI trends, PM2.5 / PM10 history |
| **Motion & icons** | Framer Motion, Lucide | Micro-interactions (honours reduced-motion) |
| **Backend** | FastAPI, Uvicorn | REST API with auto-generated OpenAPI docs |
| **Processing** | pandas, NumPy | CSV loading, joins, scoring |
| **Earth observation** | Google Earth Engine (Sentinel-2, Landsat, Dynamic World) | NDVI, NDBI, NDWI, land-cover exports |
| **Air quality** | Open-Meteo / CAMS API, OpenAQ export | Modeled PM context, station reference |

---

## 🏗️ Architecture

```mermaid
flowchart LR
    subgraph EO["🛰️ Offline: Google Earth Engine"]
        S2["Sentinel-2<br/>NDVI 2018–2025"]
        LS["Landsat<br/>NDVI 2014–2025"]
        DW["Dynamic World<br/>land cover"]
        GRID["50 m grid<br/>447 cells"]
    end

    subgraph RAW["📁 backend/data/raw (CSV)"]
        CSV[("Campus, zone,<br/>history and cell CSVs")]
    end

    subgraph EXT["🌐 External API"]
        OM["Open-Meteo<br/>Air Quality API"]
    end

    subgraph BE["⚙️ FastAPI backend"]
        DL["data_loader.py<br/>load + validate"]
        SC["scoring.py<br/>priority engine"]
        SP["spatial.py<br/>cells → GeoJSON"]
        EA["external_apis.py<br/>PM fetch + cache"]
        API["main.py<br/>REST endpoints"]
    end

    subgraph PROC["💾 backend/data/processed"]
        CACHE[("Last-good cache<br/>+ generated outputs")]
    end

    subgraph FE["🖥️ React + Vite frontend"]
        UI["Overview · Map · Trends ·<br/>Air quality · Insights · Notes"]
        GEO[("public/<br/>thapar_zones.geojson")]
    end

    S2 & LS & DW & GRID --> CSV
    CSV --> DL --> SC & SP
    OM <--> EA
    EA <--> CACHE
    SC --> CACHE
    SC & SP & EA --> API
    API -- JSON --> UI
    GEO --> UI
```

### Project structure

```text
greenpulse_ai/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app and all endpoints
│   │   ├── config.py          # Paths, coordinates, file names, constants
│   │   ├── data_loader.py     # CSV loading, required/optional handling
│   │   ├── scoring.py         # Environmental priority engine
│   │   ├── spatial.py         # 50 m cell GeoJSON and cell history
│   │   ├── external_apis.py   # Open-Meteo client, PM stress, caching
│   │   └── schemas.py         # Pydantic response models
│   ├── data/
│   │   ├── raw/               # Earth Engine and OpenAQ CSV exports
│   │   └── processed/         # Runtime outputs (git-ignored)
│   └── requirements.txt
├── frontend/
│   ├── public/thapar_zones.geojson
│   ├── src/
│   │   ├── App.jsx            # Data loading, selection state, auto-refresh
│   │   ├── api.js             # API client (VITE_API_BASE_URL)
│   │   └── components/
│   │       ├── overview/      # Hero, metric grid, pipeline band
│   │       ├── map/           # Spatial intelligence, layers, legend
│   │       ├── trends/        # Sentinel-2 and Landsat NDVI trends
│   │       ├── air-quality/   # PM2.5 / PM10 views
│   │       ├── insights/      # Deterministic insights
│   │       ├── layout/        # App shell, nav, status indicator
│   │       └── common/        # Badge, MetricCard, Skeleton, ...
│   └── package.json
├── docs/                      # Project context and source notes
└── README.md
```

---

## 🔄 How It Works

### Intelligence pipeline

```mermaid
flowchart LR
    A["🛰️ Satellite imagery<br/><sub>Sentinel-2 + Dynamic World</sub>"] --> B["🔲 50 m spatial grid<br/><sub>447 usable cells</sub>"]
    B --> C["🎛️ Environmental features<br/><sub>NDVI · NDBI · NDWI · land cover</sub>"]
    C --> D["🧮 Rule-based scoring<br/><sub>5 weighted factors</sub>"]
    E["🌫️ Modeled PM2.5 / PM10<br/><sub>Open-Meteo / CAMS</sub>"] --> D
    D --> F["🏁 Priority intelligence<br/><sub>Ranked zones + reasons</sub>"]
```

### Request flow: loading the dashboard

```mermaid
sequenceDiagram
    autonumber
    participant U as 🧑 User
    participant FE as React app
    participant API as FastAPI
    participant OM as Open-Meteo
    participant C as Last-good cache

    U->>FE: Open dashboard
    par Parallel loads
        FE->>API: GET /dashboard
        FE->>API: GET /api/spatial/cells
        FE->>API: GET /zones/landsat-history
    end
    API->>C: Cache younger than 10 min?
    alt Fresh cache
        C-->>API: Cached PM records
    else Stale or missing
        API->>OM: Fetch hourly pm10, pm2_5
        alt Provider OK
            OM-->>API: Hourly data
            API->>C: Save as last-good
        else Provider down
            C-->>API: Last-good data, marked "cached"
        end
    end
    API->>API: Load CSVs → score zones → build reasons
    API-->>FE: summary, priority, history, AQI, spatial, notes
    FE-->>U: Render (top-priority zone pre-selected)
    loop Every 12 minutes
        FE->>API: GET /api/environment/current
    end
```

### Graceful degradation

```mermaid
flowchart TD
    R["Request"] --> Q{"Required CSV present?"}
    Q -- Yes --> OK["Section rendered"]
    Q -- No --> N["Fallback value + note<br/>added to dashboard notes"]
    O{"Optional data present?<br/>(Landsat, 50 m cells, GeoJSON)"} -- No --> M["Friendly message;<br/>rest of the app stays interactive"]
    P{"Open-Meteo reachable?"} -- No --> L["Serve last-good cache<br/>or default AQI stress = 60"]
```

---

## 🧮 Priority Scoring

Each zone gets a transparent score from **0 to 100**. All inputs are clipped to the 0–100 range.

| Factor | Formula | Weight |
|---|---|:-:|
| 🌿 Low Green Cover | `100 − green_cover_percent` | **35%** |
| 📉 NDVI Decline | `min(\|ΔNDVI\| / 0.10 × 100, 100)` if ΔNDVI < 0, else `0` | **25%** |
| 🏢 Built-up Pressure | `built_up_percent` | **20%** |
| 🌳 Tree Gap | `100 − tree_percent` | **10%** |
| 🌫️ AQI Stress | `0.6 × pm25_score + 0.4 × pm10_score` | **10%** |

```mermaid
pie showData
    title Priority score weights (%)
    "Low green cover" : 35
    "NDVI decline" : 25
    "Built-up pressure" : 20
    "Tree gap" : 10
    "AQI stress" : 10
```

<details>
<summary><b>Formula details</b></summary>

```text
ΔNDVI       = latest_year_mean_ndvi − first_year_mean_ndvi      (Sentinel-2, e.g. 2025 − 2018)

pm25_score  = min((mean of last 24 h PM2.5 / 60)  × 100, 100)
pm10_score  = min((mean of last 24 h PM10  / 100) × 100, 100)
AQI Stress  = 0.6 × pm25_score + 0.4 × pm10_score              (defaults to 60 if no data)

Priority    = 0.35 × LowGreenCover
            + 0.25 × NDVIDecline
            + 0.20 × BuiltUpPressure
            + 0.10 × TreeGap
            + 0.10 × AQIStress
```

</details>

### Priority classes

| Class | Score | Map colour |
|---|:-:|:-:|
| 🟢 **Low** | 0 – 30 | Green |
| 🟡 **Moderate** | 31 – 50 | Yellow |
| 🟠 **High** | 51 – 70 | Orange |
| 🔴 **Urgent** | 71 – 100 | Red |

### Explainability

Each zone gets a generated reason built from these triggers:

| Trigger | Reason phrase |
|---|---|
| `green_cover_percent < 60` | low green-cover percentage |
| `ndvi_change < −0.05` | declining NDVI trend |
| `built_up_percent > 70` | high built-up pressure |
| `aqi_stress_score > 60` | elevated PM/AQI stress |

> *"Priority is driven by low green-cover percentage, declining NDVI trend, and high built-up pressure."*

---

## 🚀 Getting Started

### Prerequisites

- **Python** 3.10+
- **Node.js** 18+ and npm

### 1. Clone

```powershell
git clone https://github.com/Gupta2708/GreenPulse-AI.git
cd GreenPulse-AI
```

### 2. Start the backend

```powershell
cd backend
python -m venv venv
venv\Scripts\activate          # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 3. Start the frontend (new terminal)

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

### 4. Open

| Service | URL |
|---|---|
| 🖥️ Dashboard | http://127.0.0.1:5173 |
| ⚙️ API | http://127.0.0.1:8000 |
| 📚 Interactive API docs (Swagger) | http://127.0.0.1:8000/docs |

> [!TIP]
> If the API runs somewhere other than `http://localhost:8000`, set `VITE_API_BASE_URL` before starting the frontend.

---

## 📂 Datasets

Place the CSV exports in `backend/data/raw/` and the zone map in `frontend/public/`.

| File | Source | Status |
|---|---|:-:|
| `thapar_campus_summary.csv` | Earth Engine | ✅ Required |
| `thapar_zone_ndvi_green_cover.csv` | Sentinel-2 | ✅ Required |
| `thapar_zone_land_cover.csv` | Dynamic World | ✅ Required |
| `thapar_historical_zone_ndvi_2018_2025.csv` | Sentinel-2 | ✅ Required |
| `thapar_50m_master_current_2025.csv` | Earth Engine, 50 m grid | ➕ Optional |
| `thapar_50m_historical_ndvi_2018_2025.csv` | Sentinel-2, 50 m grid | ➕ Optional |
| `thapar_landsat_historical_zone_ndvi_2014_2025.csv` | Landsat | ➕ Optional |
| `openaq_location_5544_measurements.csv` | OpenAQ | ➕ Optional |
| `frontend/public/thapar_zones.geojson` | Earth Engine | ➕ Optional (map shows a fallback if missing) |

<details>
<summary><b>Generated outputs</b> (written to <code>backend/data/processed/</code>, git-ignored)</summary>

| File | Contents |
|---|---|
| `zone_environmental_priority.csv` | Full scored priority table |
| `open_meteo_recent_hourly.csv` | Hourly PM2.5 / PM10 records |
| `open_meteo_last_good.json` | Last successful provider response |
| `dashboard_summary.json` | Last `/dashboard` payload |

</details>

---

## 📡 API Reference

<details open>
<summary><b>Core</b></summary>

| Method | Endpoint | Description |
|:-:|---|---|
| `GET` | `/` | Service status |
| `GET` | `/health` | Health check |
| `GET` | `/summary` | Campus-level summary |
| `GET` | `/zones/ndvi` | Current zone NDVI and green cover |
| `GET` | `/zones/land-cover` | Zone land-cover percentages |
| `GET` | `/zones/historical-ndvi` | Sentinel-2 zone history, 2018–2025 |
| `GET` | `/zones/landsat-history` | Landsat zone history, 2014–2025 (optional) |
| `GET` | `/priority` | Ranked environmental priority table |
| `GET` | `/dashboard` | Everything the UI needs, in one call |

</details>

<details>
<summary><b>Spatial intelligence</b></summary>

| Method | Endpoint | Description |
|:-:|---|---|
| `GET` | `/api/spatial/cells` | 50 m cells as a GeoJSON FeatureCollection |
| `GET` | `/api/spatial/cells/history?cell_id=C_12613%2C67168` | NDVI history for one cell |
| `GET` | `/api/spatial/cells/history?zone_id=Z01` | NDVI history for all cells in a zone |

</details>

<details>
<summary><b>Live modeled environment</b></summary>

| Method | Endpoint | Description |
|:-:|---|---|
| `GET` | `/api/environment/current` | Current PM values, 24 h averages, stress score |
| `GET` | `/api/environment/current?refresh=true` | Same, bypassing the 10-minute cache |
| `GET` | `/api/environment/air-quality/history?hours=24\|48\|168` | Hourly PM history (24–168 h) |
| `GET` | `/aqi/open-meteo/recent?start_date=&end_date=` | Legacy endpoint with an explicit date range |

Responses include `data_mode`, `freshness` (`live` / `cached` / `unavailable`), `last_updated`, `current`, `averages_24h`, `stress_score` and hourly `records`.

</details>

---

## ⚠️ Limitations

> [!IMPORTANT]
> GreenPulse AI is a decision-support MVP. Its outputs point to where people should look first; they are not ground truth.

- **NDVI thresholds** are calibrated for this project, not universal ecological classes.
- **Dynamic World** is a zone-level supporting indicator (~10 m), not building-level ground truth.
- **Open-Meteo / CAMS** values are regional modeled estimates near one campus coordinate (30.356° N, 76.367° E), not campus or zone-level sensor readings.
- **Sentinel-2 and Landsat** differ in resolution and are shown as separate series.
- **Cell-level features** are visualised, but the formal priority score is still zone-level until a validated cell scoring method exists.
- **No causal link** between vegetation and air quality is claimed. The logic is transparent and rule-based.

---

## 🗺️ Roadmap

- [x] CSV-first FastAPI backend with explainable scoring
- [x] React dashboard with map, trends and air-quality views
- [x] 50 m spatial grid (447 cells) with 9 map layers
- [x] Live modeled PM context with last-good caching
- [ ] Local PM sensor validation (ESP32 PM2.5 / PM10 node)
- [ ] Field, drone and phone-image validation workflows
- [ ] Reviewed cell-level intervention scoring
- [ ] ML (K-Means clustering, Random Forest) once labelled training data exists
- [ ] Plant-species recommendation
- [ ] PostGIS storage and GeoTIFF tile rendering
- [ ] Production deployment

---

<p align="center">
  Built for a greener Thapar campus 🌍 by <a href="https://github.com/Gupta2708">@Gupta2708</a>
</p>

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:84cc16,50:059669,100:064e3b&height=100&section=footer" alt="footer" />
</p>
