"""AI Copilot configuration from the process environment and ``backend/.env``.

Process environment variables win over the file. The API key is kept out of ``repr`` and is
never returned by any endpoint; only ``key_configured`` (a boolean) is exposed.
"""

import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import dotenv_values

from .. import config

logger = logging.getLogger("greenpulse.ai")

MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-/]{0,79}$")
TRUE_VALUES = {"1", "true", "yes", "on"}
FALSE_VALUES = {"0", "false", "no", "off"}


@dataclass(frozen=True)
class AISettings:
    enabled: bool
    model: str
    max_tool_calls: int
    max_history_messages: int
    timeout_seconds: float
    api_key: str = field(default="", repr=False)
    warnings: tuple[str, ...] = ()
    fallback_model: str | None = None

    @property
    def key_configured(self) -> bool:
        return bool(self.api_key)

    @property
    def models(self) -> list[str]:
        """Primary first, then the optional fallback."""
        return [self.model, *([self.fallback_model] if self.fallback_model else [])]


def _read_env_file(path: Path | None) -> dict[str, str]:
    if path is None or not path.is_file():
        return {}
    try:
        return {key: value for key, value in dotenv_values(path).items() if value is not None}
    except (OSError, UnicodeError):
        logger.warning("Could not read the AI environment file; using process environment only.")
        return {}


def _bounded_int(raw: str | None, default: int, low: int, high: int, name: str, warnings: list[str]) -> int:
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        warnings.append(f"{name} is not an integer; using {default}.")
        return default
    if not low <= value <= high:
        clamped = min(max(value, low), high)
        warnings.append(f"{name} must be between {low} and {high}; using {clamped}.")
        return clamped
    return value


def load_ai_settings(env_file: Path | None = None) -> AISettings:
    file_values = _read_env_file(config.ENV_FILE if env_file is None else env_file)

    def read(name: str) -> str | None:
        value = os.environ.get(name)
        return value if value is not None else file_values.get(name)

    warnings: list[str] = []
    enabled_raw = (read("AI_ASSISTANT_ENABLED") or "true").strip().lower()
    if enabled_raw not in TRUE_VALUES | FALSE_VALUES:
        warnings.append("AI_ASSISTANT_ENABLED is not true/false; the assistant stays disabled.")
    enabled = enabled_raw in TRUE_VALUES

    model = (read("GEMINI_MODEL") or config.AI_DEFAULT_MODEL).strip()
    if not MODEL_PATTERN.fullmatch(model):
        warnings.append("GEMINI_MODEL contains unsupported characters; using the default model name.")
        model = config.AI_DEFAULT_MODEL

    fallback = (read("GEMINI_FALLBACK_MODEL") or config.AI_DEFAULT_FALLBACK_MODEL).strip() or None
    if fallback and not MODEL_PATTERN.fullmatch(fallback):
        warnings.append("GEMINI_FALLBACK_MODEL contains unsupported characters; no fallback model is used.")
        fallback = None
    if fallback == model:
        warnings.append("GEMINI_FALLBACK_MODEL is the same as GEMINI_MODEL; no fallback model is used.")
        fallback = None

    low_timeout, high_timeout = config.AI_TIMEOUT_RANGE_SECONDS
    return AISettings(
        enabled=enabled,
        model=model,
        max_tool_calls=_bounded_int(
            read("AI_MAX_TOOL_CALLS"), config.AI_DEFAULT_MAX_TOOL_CALLS, 0, config.AI_TOOL_CALL_CEILING,
            "AI_MAX_TOOL_CALLS", warnings,
        ),
        max_history_messages=_bounded_int(
            read("AI_MAX_HISTORY_MESSAGES"), config.AI_DEFAULT_MAX_HISTORY_MESSAGES, 0, config.AI_HISTORY_CEILING,
            "AI_MAX_HISTORY_MESSAGES", warnings,
        ),
        timeout_seconds=float(_bounded_int(
            read("AI_TIMEOUT_SECONDS"), config.AI_DEFAULT_TIMEOUT_SECONDS, low_timeout, high_timeout,
            "AI_TIMEOUT_SECONDS", warnings,
        )),
        api_key=(read("GEMINI_API_KEY") or "").strip(),
        warnings=tuple(warnings),
        fallback_model=fallback,
    )
