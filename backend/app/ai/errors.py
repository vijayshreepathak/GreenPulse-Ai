"""User-safe AI error categories and the mapping from Gemini SDK / network failures."""

import asyncio
import json
import logging
from typing import Any

import httpx
from google.genai import errors as genai_errors

logger = logging.getLogger("greenpulse.ai")

CONFIG_MESSAGE = "Your Gemini API configuration needs attention."
UNAVAILABLE_MESSAGE = "Gemini is temporarily unavailable. Please try again."

# category: (HTTP status for our API, retryable by the user, message)
CATEGORIES: dict[str, tuple[int, bool, str]] = {
    "disabled": (503, False, "The AI Copilot is turned off on the server (AI_ASSISTANT_ENABLED=false)."),
    "not_configured": (503, False, f"{CONFIG_MESSAGE} No GEMINI_API_KEY is set in backend/.env."),
    "invalid_key": (503, False, f"{CONFIG_MESSAGE} Gemini rejected the API key."),
    "permission_denied": (503, False, f"{CONFIG_MESSAGE} The API key is not allowed to use the configured model."),
    "model_unavailable": (503, False, f"{CONFIG_MESSAGE} The configured Gemini model is not available for this API key."),
    "quota_exhausted": (429, False, "The Gemini quota for this API key is used up. Try again later or check the plan limits."),
    "rate_limited": (429, True, "Gemini is receiving too many requests right now. Please wait a moment and try again."),
    "throttled": (429, True, "Too many Copilot requests in a short time. Please wait a moment and try again."),
    "busy": (503, True, "The Copilot is busy with other requests. Please try again shortly."),
    "timeout": (504, True, "Gemini took too long to respond. Please try again."),
    "provider_unavailable": (502, True, UNAVAILABLE_MESSAGE),
    "network": (502, True, f"{UNAVAILABLE_MESSAGE} The backend could not reach the Gemini API."),
    "invalid_request": (502, False, "Gemini could not process this request."),
    "blocked": (502, False, "Gemini declined to answer this request. Try rephrasing the question."),
    "empty_response": (502, True, "Gemini returned an empty answer. Please try again."),
    "invalid_output": (502, True, "Gemini returned a response that could not be used. Please try again."),
    "cancelled": (499, True, "The request was cancelled."),
    "duplicate_request": (409, False, "A request with this ID is already running."),
}
TRANSIENT = {"provider_unavailable", "network", "timeout"}


# Failures tied to one model (its quota, availability or load) that another model may not share.
FALLBACK_CATEGORIES = {"quota_exhausted", "rate_limited", "model_unavailable", "permission_denied", "provider_unavailable", "timeout"}


class AIError(Exception):
    def __init__(self, category: str, *, retry_after: int | None = None, detail: str | None = None, diagnostic: str | None = None):
        status, retryable, message = CATEGORIES.get(category, CATEGORIES["provider_unavailable"])
        super().__init__(message)
        self.category = category if category in CATEGORIES else "provider_unavailable"
        self.status_code = status
        self.retryable = retryable
        self.message = detail or message
        self.retry_after = retry_after
        # Safe, structured explanation (quota id, limit, model). Never provider free text or secrets.
        self.diagnostic = diagnostic
        self.model: str | None = None
        self.attempts: list[dict[str, Any]] = []

    def to_payload(self) -> dict[str, Any]:
        return {
            "detail": self.message,
            "error": {
                "category": self.category,
                "retryable": self.retryable,
                "retry_after": self.retry_after,
                "diagnostic": self.diagnostic,
                "model": self.model,
                "attempts": self.attempts,
            },
        }


def redact(text: Any, secret: str) -> str:
    value = str(text)
    return value.replace(secret, "[REDACTED]") if secret else value


def _detail_items(exc: genai_errors.APIError) -> list[dict[str, Any]]:
    try:
        items = (exc.details or {}).get("error", {}).get("details", [])
    except AttributeError:
        return []
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def _quota_detail(exc: genai_errors.APIError) -> tuple[str, int | None, str | None]:
    """Scope ('per_day' / 'per_minute' / ''), RetryInfo seconds and a readable quota diagnostic."""
    try:
        details_text = json.dumps(exc.details, default=str)
    except (TypeError, ValueError):
        details_text = str(exc.details)
    scope = "per_day" if "PerDay" in details_text else "per_minute" if "PerMinute" in details_text else ""
    retry_after = None
    diagnostics: list[str] = []
    for item in _detail_items(exc):
        delay = str(item.get("retryDelay", ""))
        if delay.endswith("s"):
            try:
                retry_after = max(1, int(float(delay[:-1])))
            except ValueError:
                pass
        for violation in item.get("violations", []) if isinstance(item.get("violations"), list) else []:
            quota_id = str(violation.get("quotaId", ""))
            metric = str(violation.get("quotaMetric", ""))
            dimensions = violation.get("quotaDimensions") or {}
            period = "Daily" if "PerDay" in quota_id else "Per-minute" if "PerMinute" in quota_id else "Quota"
            tier = " free-tier" if "FreeTier" in quota_id or "free_tier" in metric else ""
            unit = "input-token" if "token" in (quota_id + metric).lower() else "request"
            limit = violation.get("quotaValue")
            model = dimensions.get("model") if isinstance(dimensions, dict) else None
            text = f"{period}{tier} {unit} limit" + (f" of {limit}" if limit else "") + (f" for {model}" if model else "") + " reached"
            if quota_id:
                text += f" ({quota_id})"
            diagnostics.append(text + ".")
    return scope, retry_after, " ".join(dict.fromkeys(diagnostics)) or None


def classify_provider_error(exc: BaseException, secret: str = "") -> AIError:
    """Map an SDK or transport failure to a user-safe category. Never forwards provider text."""
    if isinstance(exc, AIError):
        return exc
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError, httpx.TimeoutException)):
        return AIError("timeout")
    if isinstance(exc, httpx.TransportError):
        logger.warning("Gemini transport error: %s", type(exc).__name__)
        return AIError("network")
    if isinstance(exc, genai_errors.APIError):
        code = int(exc.code or 0)
        status = str(exc.status or "").upper()
        message = str(exc.message or "").lower()
        logger.warning("Gemini API error: code=%s status=%s message=%s", code, status, redact(exc.message, secret)[:200])
        if code == 400 and ("api key" in message or "api_key_invalid" in json.dumps(exc.details, default=str).lower()):
            return AIError("invalid_key")
        if code in (401, 403) or status in {"UNAUTHENTICATED", "PERMISSION_DENIED"}:
            return AIError("invalid_key" if "api key" in message else "permission_denied")
        if code == 404 or (code == 400 and "model" in message and ("not found" in message or "not supported" in message)):
            return AIError("model_unavailable")
        if code == 429 or status == "RESOURCE_EXHAUSTED":
            scope, retry_after, diagnostic = _quota_detail(exc)
            logger.warning("Gemini quota detail: %s retry_after=%s", diagnostic or "no QuotaFailure details", retry_after)
            if scope == "per_day" or (not scope and "quota" in message and "minute" not in message):
                return AIError("quota_exhausted", retry_after=retry_after, diagnostic=diagnostic)
            return AIError("rate_limited", retry_after=retry_after, diagnostic=diagnostic)
        if code in (408, 504) or status == "DEADLINE_EXCEEDED":
            return AIError("timeout")
        if code >= 500:
            overloaded = status == "UNAVAILABLE" and "demand" in message
            return AIError("provider_unavailable", diagnostic="The model is under high demand (HTTP 503)." if overloaded else f"Gemini returned HTTP {code}.")
        return AIError("invalid_request")
    logger.warning("Unexpected Gemini failure: %s", type(exc).__name__)
    return AIError("provider_unavailable")
