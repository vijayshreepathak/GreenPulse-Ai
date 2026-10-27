"""In-memory request lifecycle (real progress and cancellation) and per-client throttling.

Progress reflects what the server is actually doing: validating context, waiting for Gemini, or
running a named tool. Nothing here is persisted.
"""

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from .. import config
from .errors import AIError

FINISHED_RUN_TTL_SECONDS = 120
MAX_TRACKED_RUNS = 200


@dataclass
class RunProgress:
    request_id: str
    client: str
    stage: str = "preparing_context"
    label: str = "Preparing context"
    steps: list[dict[str, Any]] = field(default_factory=list)
    started_at: float = field(default_factory=time.monotonic)
    finished_at: float | None = None
    outcome: str | None = None
    task: asyncio.Task | None = None

    def set_stage(self, stage: str, label: str) -> None:
        self.stage, self.label = stage, label

    def start_step(self, tool: str, label: str) -> int:
        self.steps.append({"tool": tool, "label": label, "status": "running"})
        self.set_stage("tool", label)
        return len(self.steps) - 1

    def finish_step(self, index: int, status: str) -> None:
        self.steps[index]["status"] = status

    def finish(self, outcome: str) -> None:
        self.outcome = outcome
        self.finished_at = time.monotonic()
        self.set_stage("done", {"ok": "Answer ready", "cancelled": "Cancelled"}.get(outcome, "Stopped"))
        for step in self.steps:
            if step["status"] == "running":
                step["status"] = "cancelled" if outcome == "cancelled" else "error"

    def snapshot(self) -> dict[str, Any]:
        return {
            "request_id": self.request_id,
            "stage": self.stage,
            "label": self.label,
            "steps": [dict(step) for step in self.steps],
            "done": self.finished_at is not None,
            "outcome": self.outcome,
            "elapsed_ms": int(((self.finished_at or time.monotonic()) - self.started_at) * 1000),
        }


class RunRegistry:
    def __init__(self) -> None:
        self._runs: dict[str, RunProgress] = {}

    def _prune(self, now: float) -> None:
        expired = [key for key, run in self._runs.items() if run.finished_at is not None and now - run.finished_at > FINISHED_RUN_TTL_SECONDS]
        for key in expired:
            del self._runs[key]
        if len(self._runs) > MAX_TRACKED_RUNS:
            finished = sorted((run for run in self._runs.values() if run.finished_at is not None), key=lambda run: run.finished_at or 0)
            for run in finished[: len(self._runs) - MAX_TRACKED_RUNS]:
                del self._runs[run.request_id]

    def register(self, request_id: str, client: str) -> RunProgress:
        self._prune(time.monotonic())
        existing = self._runs.get(request_id)
        if existing is not None and existing.finished_at is None:
            raise AIError("duplicate_request")
        if len(self._runs) >= MAX_TRACKED_RUNS:
            raise AIError("busy")
        run = RunProgress(request_id=request_id, client=client)
        self._runs[request_id] = run
        return run

    def get(self, request_id: str) -> RunProgress | None:
        return self._runs.get(request_id)

    def cancel(self, request_id: str, client: str) -> bool:
        run = self._runs.get(request_id)
        if run is None or run.client != client or run.finished_at is not None or run.task is None:
            return False
        run.task.cancel()
        return True


class ModelCooldowns:
    """Per-model back-off so a model that just returned 429/404/503 is not called again at once.

    Hard cool-downs (quota, rate limit, missing model, no permission) make the model unusable until
    they expire; soft ones (overload, timeout) only move it behind a healthy fallback.
    """

    HARD = {"quota_exhausted", "rate_limited", "model_unavailable", "permission_denied"}
    SECONDS = {
        "quota_exhausted": (900, 3600),   # (default, maximum) — re-check a daily quota at most hourly
        "rate_limited": (30, 300),
        "model_unavailable": (600, 600),
        "permission_denied": (600, 600),
        "provider_unavailable": (60, 60),
        "timeout": (60, 60),
    }

    def __init__(self) -> None:
        self._until: dict[str, tuple[float, str]] = {}

    def cool(self, model: str, category: str, retry_after: int | None = None, now: float | None = None) -> None:
        if category not in self.SECONDS:
            return
        default, maximum = self.SECONDS[category]
        seconds = min(retry_after or default, maximum)
        self._until[model] = ((time.monotonic() if now is None else now) + seconds, category)

    def clear(self, model: str | None = None) -> None:
        if model is None:
            self._until.clear()
        else:
            self._until.pop(model, None)

    def get(self, model: str, now: float | None = None) -> tuple[str, int] | None:
        """(category, seconds remaining) while the model is cooling down."""
        entry = self._until.get(model)
        if entry is None:
            return None
        remaining = entry[0] - (time.monotonic() if now is None else now)
        if remaining <= 0:
            del self._until[model]
            return None
        return entry[1], max(1, int(remaining))

    def snapshot(self) -> dict[str, dict[str, Any]]:
        return {model: {"category": state[0], "seconds_remaining": state[1]} for model in list(self._until) if (state := self.get(model))}


class Throttle:
    """Sliding-window request limit and concurrency caps per client address."""

    def __init__(
        self,
        limit: int = config.AI_RATE_LIMIT_REQUESTS,
        window_seconds: float = config.AI_RATE_LIMIT_WINDOW_SECONDS,
        per_client: int = config.AI_MAX_CONCURRENT_PER_CLIENT,
        total: int = config.AI_MAX_CONCURRENT_TOTAL,
    ) -> None:
        self.limit, self.window, self.per_client, self.total = limit, window_seconds, per_client, total
        self._hits: dict[str, deque[float]] = {}
        self._active: dict[str, int] = {}

    def acquire(self, client: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        hits = self._hits.setdefault(client, deque())
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            raise AIError("throttled", retry_after=max(1, int(self.window - (now - hits[0]))))
        if self._active.get(client, 0) >= self.per_client:
            raise AIError("throttled", retry_after=2)
        if sum(self._active.values()) >= self.total:
            raise AIError("busy")
        hits.append(now)
        self._active[client] = self._active.get(client, 0) + 1

    def release(self, client: str) -> None:
        remaining = self._active.get(client, 0) - 1
        if remaining > 0:
            self._active[client] = remaining
        else:
            self._active.pop(client, None)
