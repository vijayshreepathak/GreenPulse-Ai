from pydantic import BaseModel


class StatusResponse(BaseModel):
    project: str
    status: str
    scope: str


class HealthResponse(BaseModel):
    ok: bool
