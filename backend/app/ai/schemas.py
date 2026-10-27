"""Validated request and response models for the AI Copilot API."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .. import config
from .context import ClientContext


class HistoryMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=config.AI_MAX_HISTORY_MESSAGE_CHARS)


class ChatRequest(BaseModel):
    # extra="forbid": a client-supplied system prompt or tool list is rejected, not ignored.
    model_config = ConfigDict(extra="forbid")
    request_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9\-]{8,64}$")
    message: str = Field(min_length=1, max_length=config.AI_MAX_MESSAGE_CHARS)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=40)
    context: ClientContext = Field(default_factory=ClientContext)

    @field_validator("message")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message must not be blank")
        return value.strip()


class Evidence(BaseModel):
    id: str
    label: str
    source: str
    detail: str | None = None
    as_of: str | None = None


class Fact(BaseModel):
    label: str
    value: str
    unit: str = ""
    detail: str | None = None
    source: str | None = None


class SeriesPoint(BaseModel):
    year: int
    value: float


class Visual(BaseModel):
    type: Literal["table", "series"]
    title: str
    source: str
    columns: list[str] | None = None
    rows: list[list[str]] | None = Field(default=None, max_length=12)
    unit: str | None = None
    points: list[SeriesPoint] | None = Field(default=None, max_length=20)


class ToolTrace(BaseModel):
    name: str
    label: str
    status: Literal["ok", "error", "skipped"]
    detail: str | None = None


class Verification(BaseModel):
    status: Literal["verified", "unverified_figures", "no_figures"]
    checked: int
    unverified: list[str]


class ChatResponse(BaseModel):
    request_id: str
    answer: str = Field(min_length=1)
    evidence: list[Evidence] = Field(max_length=8)
    facts: list[Fact] = Field(max_length=6)
    visual: Visual | None = None
    follow_ups: list[str] = Field(max_length=3)
    tools_used: list[ToolTrace]
    context_used: dict[str, Any]
    context_notes: list[str]
    verification: Verification
    model: str  # the model that actually produced the answer
    primary_model: str
    fallback_used: bool = False
    fallback_reason: str | None = None
    created_at: str
