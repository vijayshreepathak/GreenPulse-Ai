# GreenPulse AI Backend

FastAPI service for campus summaries, explainable zone scoring, 50 m spatial intelligence, historical vegetation records, and cached modeled air-quality context.

## Run

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Data

Place required CSV files in `data/raw/`. Processed outputs are written to `data/processed/`.

## Product Endpoints

```text
GET /dashboard
GET /priority
GET /api/spatial/cells
GET /api/spatial/cells/history
GET /api/environment/current
GET /api/environment/air-quality/history
```

Interactive documentation is available at `http://127.0.0.1:8000/docs`.
