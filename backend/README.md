# GreenPulse AI Backend

FastAPI backend for the GreenPulse AI CSV-first MVP.

## Run

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Data

Place required CSV files in `data/raw/`. Processed outputs are written to `data/processed/`.
