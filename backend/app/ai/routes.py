"""AI Copilot HTTP endpoints, request-size limit and the shared service state."""

import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import JSONResponse

from .. import config
from .agent import CopilotAgent
from .errors import AIError, classify_provider_error
from .provider import GeminiProvider
from .runs import ModelCooldowns, RunRegistry, Throttle
from .schemas import ChatRequest
from .settings import AISettings, load_ai_settings

logger = logging.getLogger("greenpulse.ai")

DATA_USE_NOTICE = (
    "When you send a question, the question, up to the last few conversation turns and a short description of the "
    "current page (page name, selected zone or cell, chart settings) are sent to Google Gemini. The Gemini API key "
    "stays on the server. Data tools run on this server and share only the GreenPulse figures needed for the answer. "
    "Conversations are kept in this browser tab's memory only."
)
PROVIDER_CATEGORIES = {
    "invalid_key", "permission_denied", "model_unavailable", "quota_exhausted", "rate_limited",
    "timeout", "provider_unavailable", "network", "invalid_request",
}
REQUEST_ID = Path(pattern=r"^[A-Za-z0-9\-]{8,64}$")


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AIService:
    """Process-wide state: settings, the Gemini client, run registry, throttle and provider status."""

    def __init__(
        self,
        settings_loader: Callable[[], AISettings] = load_ai_settings,
        provider_factory: Callable[[AISettings], Any] = GeminiProvider,
    ):
        self._settings_loader = settings_loader
        self._provider_factory = provider_factory
        self._settings: AISettings | None = None
        self._settings_signature: Any = None
        self._pinned = False
        self._provider: Any = None
        self.registry = RunRegistry()
        self.throttle = Throttle()
        self.cooldowns = ModelCooldowns()
        self._reset_status()

    def _reset_status(self) -> None:
        self.provider_status: dict[str, Any] = {"state": "not_checked", "category": None, "checked_at": None, "via": None, "model": None, "diagnostic": None}
        self.model_checks: dict[str, dict[str, Any]] = {}
        self.last_answer: dict[str, Any] | None = None
        self._verified_at: float | None = None

    @staticmethod
    def _env_signature() -> int | None:
        try:
            return config.ENV_FILE.stat().st_mtime_ns
        except OSError:
            return None

    @property
    def settings(self) -> AISettings:
        """Settings, re-read automatically when backend/.env changes (so the shown model is never stale)."""
        signature = self._env_signature()
        if self._settings is None or (not self._pinned and signature != self._settings_signature):
            fresh = self._settings_loader()
            changed = self._settings is not None and fresh != self._settings
            if self._settings is None or changed:
                for warning in fresh.warnings:
                    logger.warning("AI configuration: %s", warning)
            if changed:
                logger.info("AI configuration reloaded from backend/.env (model %s, fallback %s)", fresh.model, fresh.fallback_model)
                self._provider = None
                self.cooldowns.clear()
                self._reset_status()
            self._settings, self._settings_signature = fresh, signature
        return self._settings

    def pin(self, settings: AISettings, provider: Any) -> None:
        """Use fixed settings and provider (tests); disables reloading from backend/.env."""
        self._settings, self._provider, self._pinned = settings, provider, True
        self.cooldowns.clear()
        self._reset_status()

    @property
    def provider(self) -> Any:
        settings = self.settings  # may reset the provider after a configuration change
        if self._provider is None:
            self._provider = self._provider_factory(settings)
        return self._provider

    def record(self, *, ok: bool, via: str, category: str | None = None, model: str | None = None, diagnostic: str | None = None) -> None:
        self.provider_status = {
            "state": "connected" if ok else "error", "category": category, "checked_at": _iso_now(), "via": via,
            "model": model, "diagnostic": diagnostic,
        }
        self._verified_at = time.monotonic() if ok else None

    def verification_fresh(self) -> bool:
        return self._verified_at is not None and time.monotonic() - self._verified_at < config.AI_STATUS_VERIFY_TTL_SECONDS


service = AIService()


def get_service() -> AIService:
    return service


def _error_response(error: AIError) -> JSONResponse:
    headers = {"Retry-After": str(error.retry_after)} if error.retry_after else None
    return JSONResponse(status_code=error.status_code, content=error.to_payload(), headers=headers)


def _client_id(request: Request) -> str:
    return request.client.host if request.client else "unknown"


router = APIRouter(prefix="/api/ai", tags=["AI Copilot"])


@router.get("/status")
async def ai_status(verify: bool = Query(default=False), ai: AIService = Depends(get_service)) -> dict[str, Any]:
    settings = ai.settings
    available = settings.enabled and settings.key_configured
    if verify and available and not ai.verification_fresh():
        # Free model lookups for the primary and the fallback; nothing is generated.
        for role, model in zip(("primary", "fallback"), settings.models):
            try:
                await asyncio.wait_for(ai.provider.verify(model), timeout=15)
                ai.model_checks[model] = {"role": role, "available": True, "category": None, "checked_at": _iso_now()}
            except Exception as exc:  # classified; provider text is never returned
                error = classify_provider_error(exc, settings.api_key)
                ai.model_checks[model] = {"role": role, "available": False, "category": error.category, "checked_at": _iso_now()}
        primary = ai.model_checks.get(settings.model, {})
        ai.record(ok=bool(primary.get("available")), via="model_lookup", category=primary.get("category"), model=settings.model)

    status = ai.provider_status
    if not settings.enabled:
        message = "The AI Copilot is turned off on the server (AI_ASSISTANT_ENABLED=false)."
    elif not settings.key_configured:
        message = "Your Gemini API configuration needs attention: GEMINI_API_KEY is not set in backend/.env."
    elif status["state"] == "connected":
        message = f"Gemini is reachable with {status.get('model') or settings.model}."
    elif status["state"] == "error":
        message = AIError(status["category"] or "provider_unavailable").message
    else:
        message = "Configured. The Gemini connection has not been checked yet."
    cooldowns = ai.cooldowns.snapshot()
    models = [
        {
            "model": model,
            "role": role,
            "lookup": ai.model_checks.get(model),
            "cooldown": cooldowns.get(model),
        }
        for role, model in zip(("primary", "fallback"), settings.models)
    ]
    return {
        "enabled": settings.enabled,
        "key_configured": settings.key_configured,
        "available": available,
        "provider": "Google Gemini",
        "model": settings.model,
        "fallback_model": settings.fallback_model,
        "models": models,
        "last_answer": ai.last_answer,
        "provider_status": status,
        "message": message,
        "data_use": DATA_USE_NOTICE,
        "limits": {
            "max_tool_calls": settings.max_tool_calls,
            "max_history_messages": settings.max_history_messages,
            "timeout_seconds": settings.timeout_seconds,
            "max_message_chars": config.AI_MAX_MESSAGE_CHARS,
        },
    }


async def _cancel_on_disconnect(request: Request, task: asyncio.Task) -> None:
    """Stop Gemini and tool work as soon as the browser goes away (cancel, navigation, closed tab)."""
    while not task.done():
        if await request.is_disconnected():
            task.cancel()
            return
        await asyncio.sleep(0.5)


@router.post("/chat")
async def ai_chat(body: ChatRequest, request: Request, ai: AIService = Depends(get_service)) -> Any:
    settings = ai.settings
    if not settings.enabled:
        return _error_response(AIError("disabled"))
    if not settings.key_configured:
        return _error_response(AIError("not_configured"))

    client = _client_id(request)
    try:
        ai.throttle.acquire(client)
    except AIError as error:
        return _error_response(error)

    outcome = "error"
    progress = None
    try:
        progress = ai.registry.register(body.request_id or uuid.uuid4().hex, client)
        agent = CopilotAgent(settings, ai.provider, cooldowns=ai.cooldowns)
        task = asyncio.create_task(agent.run(body, progress))
        progress.task = task
        watcher = asyncio.create_task(_cancel_on_disconnect(request, task))
        try:
            result = await task
        except asyncio.CancelledError:
            current = asyncio.current_task()
            if current is not None and current.cancelling():
                raise  # the server itself is shutting down
            outcome = "cancelled"
            return _error_response(AIError("cancelled"))
        finally:
            watcher.cancel()
        ai.record(ok=True, via="chat", model=result["model"])
        ai.last_answer = {"model": result["model"], "fallback_used": result["fallback_used"], "fallback_reason": result["fallback_reason"], "at": _iso_now()}
        outcome = "ok"
        return result
    except AIError as error:
        if error.category in PROVIDER_CATEGORIES:
            ai.record(ok=False, via="chat", category=error.category, model=error.model, diagnostic=error.diagnostic)
        return _error_response(error)
    finally:
        ai.throttle.release(client)
        if progress is not None:
            progress.finish(outcome)


@router.get("/chat/{request_id}/progress")
async def ai_progress(request_id: str = REQUEST_ID, ai: AIService = Depends(get_service)) -> Any:
    run = ai.registry.get(request_id)
    if run is None:
        return JSONResponse(status_code=404, content={"detail": "No request with this ID is running or recently finished."})
    return run.snapshot()


@router.post("/chat/{request_id}/cancel")
async def ai_cancel(request: Request, request_id: str = REQUEST_ID, ai: AIService = Depends(get_service)) -> dict[str, Any]:
    return {"request_id": request_id, "cancelled": ai.registry.cancel(request_id, _client_id(request))}


class _BodyTooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    """Reject oversized bodies on the AI routes before they are parsed (declared or streamed)."""

    def __init__(self, app: Any, path_prefix: str, max_bytes: int):
        self.app, self.path_prefix, self.max_bytes = app, path_prefix, max_bytes

    async def _reject(self, send: Any) -> None:
        body = b'{"detail":"The AI request is too large."}'
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith(self.path_prefix):
            await self.app(scope, receive, send)
            return
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None:
            try:
                too_large = int(declared) > self.max_bytes
            except ValueError:
                too_large = True
            if too_large:
                await self._reject(send)
                return
        received = 0

        async def limited_receive() -> Any:
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _BodyTooLarge:
            await self._reject(send)
