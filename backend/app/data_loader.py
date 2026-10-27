import json
import logging
import math
import os
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException

from . import config

logger = logging.getLogger("greenpulse.data")


def ensure_data_dirs() -> None:
    config.RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)


def raw_path(filename: str) -> Path:
    return config.RAW_DATA_DIR / filename


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
        # utf-8-sig tolerates a byte-order mark from spreadsheet exports; stripped headers
        # tolerate " zone_id" style columns.
        frame = pd.read_csv(path, encoding="utf-8-sig")
        frame.columns = [str(column).strip() for column in frame.columns]
        return frame
    except pd.errors.EmptyDataError:
        if required:
            raise HTTPException(status_code=422, detail=f"Dataset '{filename}' is empty.") from None
        logger.warning("Optional dataset %s is empty", filename)
        return pd.DataFrame()
    except Exception as exc:  # parser and I/O errors; details stay in the server log
        logger.exception("Could not parse dataset %s", filename)
        if required:
            raise HTTPException(
                status_code=422,
                detail=f"Dataset '{filename}' could not be parsed. Check that it is a valid CSV export.",
            ) from exc
        return pd.DataFrame()


def load_required_dataset(key: str) -> pd.DataFrame:
    return load_csv(config.REQUIRED_FILES[key], required=True)


def load_optional_dataset(key: str) -> pd.DataFrame:
    primary = config.OPTIONAL_FILES[key]
    if raw_path(primary).exists():
        return load_csv(primary, required=False)
    for alias in config.OPTIONAL_FILE_ALIASES.get(key, []):
        if raw_path(alias).exists():
            return load_csv(alias, required=False)
    return pd.DataFrame()


def dataset_status() -> dict[str, Any]:
    required = {key: raw_path(name).exists() for key, name in config.REQUIRED_FILES.items()}
    optional = {
        key: raw_path(name).exists() or any(raw_path(alias).exists() for alias in config.OPTIONAL_FILE_ALIASES.get(key, []))
        for key, name in config.OPTIONAL_FILES.items()
    }
    return {"required": required, "optional": optional, "required_available": all(required.values())}


def clean_value(value: Any) -> Any:
    """Convert pandas/numpy scalars into JSON-safe Python values (NaN/inf -> None)."""
    if value is None:
        return None
    if isinstance(value, (list, tuple, dict)):
        return value
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def records_from_df(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df.empty:
        return []
    return [{key: clean_value(value) for key, value in row.items()} for row in df.to_dict(orient="records")]


def first_row_from_df(df: pd.DataFrame) -> dict[str, Any]:
    if df.empty:
        return {}
    return {key: clean_value(value) for key, value in df.iloc[0].to_dict().items()}


def atomic_write_text(path: Path, text: str) -> bool:
    """Write text via a temporary file and atomic replace. Returns False on I/O failure."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        handle, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as temp_file:
                temp_file.write(text)
            os.replace(temp_name, path)
        finally:
            if os.path.exists(temp_name):
                os.remove(temp_name)
        return True
    except OSError:
        logger.warning("Could not write %s", path, exc_info=True)
        return False


def write_json(path: Path, payload: dict[str, Any]) -> bool:
    return atomic_write_text(path, json.dumps(payload, indent=2, default=str))


def write_csv(path: Path, df: pd.DataFrame) -> bool:
    return atomic_write_text(path, df.to_csv(index=False))
