from typing import Any

from pydantic import BaseModel


class StatusResponse(BaseModel):
    project: str
    status: str
    scope: str


class HealthResponse(BaseModel):
    ok: bool
    version: str
    required_datasets_available: bool
    datasets: dict[str, Any]
