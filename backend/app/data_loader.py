import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException

from .config import RAW_DATA_DIR, PROCESSED_DATA_DIR, REQUIRED_FILES, OPTIONAL_FILES, OPTIONAL_FILE_ALIASES


def ensure_data_dirs() -> None:
    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)


def raw_path(filename: str) -> Path:
    return RAW_DATA_DIR / filename


def load_csv(filename: str, *, required: bool = True) -> pd.DataFrame:
    path = raw_path(filename)
    if not path.exists():
        if required:
            raise HTTPException(
                status_code=404,
                detail=f"Required dataset '{filename}' was not found in backend/data/raw.",
            )
        return pd.DataFrame()
    try:
        return pd.read_csv(path)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read dataset '{filename}': {exc}",
        ) from exc


def load_required_dataset(key: str) -> pd.DataFrame:
    return load_csv(REQUIRED_FILES[key], required=True)


def load_optional_dataset(key: str) -> pd.DataFrame:
    primary = OPTIONAL_FILES[key]
    if raw_path(primary).exists():
        return load_csv(primary, required=False)
    for alias in OPTIONAL_FILE_ALIASES.get(key, []):
        if raw_path(alias).exists():
            return load_csv(alias, required=False)
    return load_csv(primary, required=False)


def clean_value(value: Any) -> Any:
    if pd.isna(value):
        return None
    if isinstance(value, np.generic):
        return value.item()
    return value


def records_from_df(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df.empty:
        return []
    safe_df = df.replace({np.nan: None})
    return safe_df.to_dict(orient="records")


def first_row_from_df(df: pd.DataFrame) -> dict[str, Any]:
    if df.empty:
        return {}
    return {key: clean_value(value) for key, value in df.iloc[0].to_dict().items()}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
