"""Thin async wrapper around the official google-genai SDK. The only module that talks to Gemini."""

from typing import Any

from google import genai
from google.genai import types

from .settings import AISettings


class GeminiProvider:
    def __init__(self, settings: AISettings):
        self.model = settings.model
        # No SDK-level retries: the agent decides (one retry or one fallback model), within its budget.
        self._client = genai.Client(
            api_key=settings.api_key,
            http_options=types.HttpOptions(timeout=int(settings.timeout_seconds * 1000)),
        )

    async def generate(self, contents: list[types.Content], config: types.GenerateContentConfig, model: str | None = None) -> Any:
        return await self._client.aio.models.generate_content(model=model or self.model, contents=contents, config=config)

    async def verify(self, model: str | None = None) -> None:
        """Model metadata lookup: proves the key and model work without generating (no token cost)."""
        await self._client.aio.models.get(model=model or self.model)

    async def aclose(self) -> None:
        await self._client.aio.aclose()
