"""The Copilot request loop: Gemini decides which allowlisted tool to use; only the server runs it.

Bounded by AI_MAX_TOOL_CALLS (never more than four), a per-request deadline, one retry of a
transient provider failure, and duplicate-call short-circuiting. Tool results go back to Gemini as
function responses (data), and the final answer is checked against them before it is returned.
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from google.genai import types
from pydantic import ValidationError

from .. import config
from .context import ValidatedContext, validate_context
from .errors import FALLBACK_CATEGORIES, TRANSIENT, AIError, classify_provider_error
from .prompts import SYSTEM_PROMPT, sanitize_answer, split_follow_ups
from .runs import ModelCooldowns, RunProgress
from .schemas import ChatRequest, ChatResponse, HistoryMessage
from .settings import AISettings
from .tools import TOOLS, AnalysisSnapshot, ToolResult, function_declarations, run_tool
from .verify import verify_figures

logger = logging.getLogger("greenpulse.ai")

RETRY_DELAY_SECONDS = 1.0
RETRY_MIN_REMAINING_SECONDS = 8.0
# Time kept back from the primary model so the fallback can still answer within the deadline.
FALLBACK_RESERVE_SECONDS = 15.0
MIN_FALLBACK_SECONDS = 5.0
TOOL_TIMEOUT_SECONDS = 20.0
MAX_OUTPUT_TOKENS = 4096
# The most specific visual wins when several tools ran.
VISUAL_PRIORITY = ["compare_zones", "get_scenario_comparison", "get_vegetation_history", "get_zone_details", "get_zone_rankings"]
BLOCKED_REASONS = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"}
MALFORMED_REASONS = {"MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL", "TOO_MANY_TOOL_CALLS"}


def build_contents(history: list[HistoryMessage], context: ValidatedContext, message: str, limit: int) -> list[types.Content]:
    """Bounded, alternating history (oldest first, starting with a user turn) plus the new question."""
    contents: list[types.Content] = []
    for item in history[-limit:] if limit > 0 else []:
        role = "user" if item.role == "user" else "model"
        if not contents and role == "model":
            continue
        if contents and contents[-1].role == role:
            contents[-1].parts.append(types.Part(text=item.content))
        else:
            contents.append(types.Content(role=role, parts=[types.Part(text=item.content)]))
    question = types.Content(role="user", parts=[types.Part(text=context.prompt_block()), types.Part(text=f"User question:\n{message}")])
    if contents and contents[-1].role == "user":
        contents[-1].parts.extend(question.parts)
    else:
        contents.append(question)
    return contents


def _canonical(name: str, args: Any) -> str:
    try:
        return f"{name}:{json.dumps(args or {}, sort_keys=True, default=str)}"
    except (TypeError, ValueError):
        return f"{name}:{args!r}"


def _answer_text(response: Any) -> str:
    candidates = getattr(response, "candidates", None) or []
    if not candidates or not getattr(candidates[0], "content", None):
        return ""
    parts = candidates[0].content.parts or []
    return "".join(part.text for part in parts if getattr(part, "text", None) and not getattr(part, "thought", False)).strip()


def _empty_answer_error(response: Any) -> AIError:
    feedback = getattr(response, "prompt_feedback", None)
    if feedback is not None and getattr(feedback, "block_reason", None):
        return AIError("blocked")
    candidates = getattr(response, "candidates", None) or []
    reason = getattr(candidates[0], "finish_reason", None) if candidates else None
    reason_name = getattr(reason, "name", None) or str(reason or "")
    if reason_name in BLOCKED_REASONS:
        return AIError("blocked")
    if reason_name in MALFORMED_REASONS:
        return AIError("invalid_output")
    return AIError("empty_response")


def default_follow_ups(context: ValidatedContext, tool_names: list[str], results: list[ToolResult]) -> list[str]:
    zone = context.zone_id
    suggestions: list[str] = []
    if "get_zone_rankings" in tool_names:
        suggestions += ["Why is the top-ranked zone ranked highest?", "How does the priority score work?"]
    if "get_air_quality_context" in tool_names:
        suggestions.append("Why can't the shared PM stress change the zone ranking?")
    if "get_vegetation_history" in tool_names:
        suggestions.append("Why are Sentinel-2 and Landsat shown separately?")
    if zone and "get_zone_details" not in tool_names:
        suggestions.append(f"Explain {zone} in more detail.")
    page_defaults = {
        "map": "What does the current map layer represent?",
        "trends": "Which zone lost the most NDVI since 2018?",
        "air-quality": "What is the latest modelled PM2.5 level?",
        "compare": "Which factor explains the score gap between the compared zones?",
        "scenario": "How do my scenario results differ from the official ranking?",
        "insights": "Why aren't these results proof of causation?",
    }
    suggestions.append(page_defaults.get(context.page or "", "Which zone needs the most attention?"))
    return list(dict.fromkeys(suggestions))[:3]


@dataclass
class _TurnState:
    """What one question has gathered so far; survives a switch to the fallback model."""

    results: list[tuple[str, ToolResult]] = field(default_factory=list)
    payloads: list[dict[str, Any]] = field(default_factory=list)
    traces: list[dict[str, Any]] = field(default_factory=list)
    seen: dict[str, dict[str, Any]] = field(default_factory=dict)


class CopilotAgent:
    def __init__(
        self,
        settings: AISettings,
        provider: Any,
        *,
        snapshot_factory: Callable[[], AnalysisSnapshot] = AnalysisSnapshot,
        clock: Callable[[], float] | None = None,
        cooldowns: ModelCooldowns | None = None,
    ):
        self.settings = settings
        self.provider = provider
        self.snapshot_factory = snapshot_factory
        self._clock = clock
        self.cooldowns = cooldowns

    def _now(self) -> float:
        return self._clock() if self._clock else asyncio.get_running_loop().time()

    def _config(self, model: str, declarations: list[dict[str, Any]], allow_tools: bool) -> types.GenerateContentConfig:
        options: dict[str, Any] = {
            "system_instruction": SYSTEM_PROMPT,
            "tools": [types.Tool(function_declarations=[types.FunctionDeclaration(**item) for item in declarations])],
            "tool_config": types.ToolConfig(function_calling_config=types.FunctionCallingConfig(mode="AUTO" if allow_tools else "NONE")),
            "automatic_function_calling": types.AutomaticFunctionCallingConfig(disable=True),
            "max_output_tokens": MAX_OUTPUT_TOKENS,
        }
        # Gemini 3 models take a thinking level; keep it low for an interactive assistant.
        if re.match(r"^(models/)?gemini-3", model):
            options["thinking_config"] = types.ThinkingConfig(thinking_level="LOW")
        return types.GenerateContentConfig(**options)

    async def _generate(
        self, model: str, contents: list[types.Content], config_: types.GenerateContentConfig, deadline: float, *, reserve: float, may_retry: bool
    ) -> Any:
        """One model call. `reserve` keeps time back for a fallback model; `may_retry` allows one
        retry of a transient failure (only when there is no fallback to switch to instead)."""
        attempt = 0
        while True:
            budget = deadline - self._now() - reserve
            if budget <= 0.5:
                raise AIError("timeout")
            try:
                return await asyncio.wait_for(self.provider.generate(contents, config_, model), timeout=budget)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # classified below; nothing raw reaches the client
                error = classify_provider_error(exc, self.settings.api_key)
                if may_retry and error.category in TRANSIENT and attempt == 0 and deadline - self._now() - reserve > RETRY_MIN_REMAINING_SECONDS:
                    attempt += 1
                    await asyncio.sleep(RETRY_DELAY_SECONDS)
                    continue
                raise error from None

    def _model_order(self) -> tuple[list[str], str | None]:
        """Models to try, healthy ones first, plus why the primary is skipped (if it is)."""
        models = self.settings.models
        if self.cooldowns is None:
            return models, None
        ready: list[str] = []
        soft: list[str] = []
        blocked: list[tuple[str, str, int]] = []
        for model in models:
            state = self.cooldowns.get(model)
            if state is None:
                ready.append(model)
            elif state[0] in ModelCooldowns.HARD:
                blocked.append((model, *state))
            else:
                soft.append(model)
        order = ready + soft
        primary_state = self.cooldowns.get(self.settings.model)
        if not order:
            model, category, remaining = blocked[0]
            error = AIError(category, retry_after=remaining, diagnostic=(
                f"{model} returned '{category.replace('_', ' ')}' recently, so it is paused for about {remaining} s "
                "instead of being called again."
            ))
            error.model = model
            error.attempts = [{"model": item[0], "category": item[1], "skipped": True} for item in blocked]
            raise error
        skipped_reason = primary_state[0] if primary_state and order[0] != self.settings.model else None
        return order, skipped_reason

    async def _run_tool(self, name: str, args: Any, snapshot: AnalysisSnapshot, deadline: float) -> tuple[ToolResult | None, dict[str, Any]]:
        timeout = max(0.5, min(TOOL_TIMEOUT_SECONDS, deadline - self._now()))
        try:
            return await asyncio.wait_for(asyncio.to_thread(run_tool, name, args, snapshot), timeout=timeout)
        except asyncio.CancelledError:
            raise
        except asyncio.TimeoutError:
            return None, {"error": "The data tool took too long to respond."}
        except Exception:
            logger.exception("AI tool %s failed", name)
            return None, {"error": "The project data needed for this tool could not be read."}

    async def run(self, request: ChatRequest, progress: RunProgress) -> dict[str, Any]:
        settings = self.settings
        deadline = self._now() + settings.timeout_seconds
        snapshot = self.snapshot_factory()

        progress.set_stage("preparing_context", "Preparing context")
        context = await asyncio.to_thread(validate_context, request.context, snapshot)
        snapshot.scenario_weights = context.scenario_weights
        declarations = function_declarations(sorted(context.zone_names))

        order, fallback_reason = self._model_order()
        turn = _TurnState()
        attempts: list[dict[str, Any]] = []
        for index, model in enumerate(order):
            has_next = index < len(order) - 1
            if index:
                progress.set_stage("fallback", f"Switching to the fallback model ({model})")
            try:
                final = await self._model_turn(
                    model, request, context, declarations, snapshot, turn, progress, deadline,
                    reserve=FALLBACK_RESERVE_SECONDS if has_next else 0.0,
                    may_retry=not has_next and index == 0,
                )
            except AIError as error:
                error.model = model
                attempts.append({"model": model, "category": error.category, "diagnostic": error.diagnostic})
                if self.cooldowns is not None:
                    self.cooldowns.cool(model, error.category, error.retry_after)
                if has_next and error.category in FALLBACK_CATEGORIES and deadline - self._now() > MIN_FALLBACK_SECONDS:
                    logger.warning("Gemini model %s failed (%s); trying fallback %s once", model, error.category, order[index + 1])
                    if model == settings.model:
                        fallback_reason = error.category
                    continue
                error.attempts = attempts
                raise
            if self.cooldowns is not None:
                self.cooldowns.clear(model)
            return self._finish(final, model, fallback_reason, request, context, turn, progress)
        raise AIError("invalid_output")  # pragma: no cover - order always holds at least one model

    async def _model_turn(
        self,
        model: str,
        request: ChatRequest,
        context: ValidatedContext,
        declarations: list[dict[str, Any]],
        snapshot: AnalysisSnapshot,
        turn: "_TurnState",
        progress: RunProgress,
        deadline: float,
        *,
        reserve: float,
        may_retry: bool,
    ) -> Any:
        """The tool-calling loop with one model. Tool results from an earlier model are reused."""
        settings = self.settings
        contents = build_contents(request.history, context, request.message, settings.max_history_messages)
        calls_used = 0
        this_attempt: set[str] = set()
        for _ in range(settings.max_tool_calls + 2):
            allow_tools = calls_used < settings.max_tool_calls
            progress.set_stage("model", "Generating answer" if turn.traces else "Asking Gemini")
            response = await self._generate(model, contents, self._config(model, declarations, allow_tools), deadline, reserve=reserve, may_retry=may_retry)
            calls = list(getattr(response, "function_calls", None) or [])
            if not calls:
                return response
            if not allow_tools:
                raise AIError("invalid_output")  # asked for tools after they were switched off
            candidate = response.candidates[0].content  # kept whole: Gemini 3 needs its thought signatures back
            contents.append(candidate)
            parts: list[types.Part] = []
            for call in calls:
                name = call.name or ""
                if calls_used >= settings.max_tool_calls:
                    payload = {"error": "Tool-call limit reached for this question. Answer with the evidence already retrieved and say what is missing."}
                    turn.traces.append({"name": name, "label": "Skipped: tool-call limit reached", "status": "skipped"})
                else:
                    calls_used += 1
                    key = _canonical(name, call.args)
                    if key in this_attempt:
                        payload = {**turn.seen[key], "note": "Duplicate request; this is the same result as before."}
                    elif key in turn.seen:
                        payload = turn.seen[key]  # already run for an earlier model: reuse, do not re-run
                    else:
                        spec = TOOLS.get(name)
                        step = progress.start_step(name, spec.progress if spec else "Rejected an unknown tool")
                        result, payload = await self._run_tool(name, call.args, snapshot, deadline)
                        progress.finish_step(step, "ok" if result else "error")
                        turn.seen[key] = payload
                        turn.payloads.append(payload)
                        turn.traces.append({
                            "name": name if spec else "unknown_tool",
                            "label": spec.progress if spec else "Rejected an unknown tool",
                            "status": "ok" if result else "error",
                            "detail": None if result else str(payload.get("error", ""))[:200],
                        })
                        if result:
                            turn.results.append((name, result))
                    this_attempt.add(key)
                parts.append(types.Part(function_response=types.FunctionResponse(id=call.id, name=name, response=payload)))
            contents.append(types.Content(role="user", parts=parts))
        raise AIError("invalid_output")

    def _finish(
        self,
        final: Any,
        model: str,
        fallback_reason: str | None,
        request: ChatRequest,
        context: ValidatedContext,
        turn: "_TurnState",
        progress: RunProgress,
    ) -> dict[str, Any]:
        settings = self.settings
        text = _answer_text(final)
        if not text:
            raise _empty_answer_error(final)
        body, follow_ups = split_follow_ups(text)
        answer = sanitize_answer(body, config.AI_MAX_ANSWER_CHARS)
        if settings.api_key:
            answer = answer.replace(settings.api_key, "[REDACTED]")
        if not answer:
            raise AIError("empty_response")
        progress.set_stage("finalising", "Checking figures against the evidence")
        used_fallback = model != settings.model
        return self._build_response(
            progress.request_id, request, context, answer, follow_ups, turn.results, turn.payloads, turn.traces,
            model=model, fallback_reason=fallback_reason if used_fallback else None,
        )

    def _build_response(
        self,
        request_id: str,
        request: ChatRequest,
        context: ValidatedContext,
        answer: str,
        follow_ups: list[str],
        results: list[tuple[str, ToolResult]],
        payloads: list[dict[str, Any]],
        traces: list[dict[str, Any]],
        *,
        model: str,
        fallback_reason: str | None = None,
    ) -> dict[str, Any]:
        evidence: dict[str, dict[str, Any]] = {}
        facts: dict[str, dict[str, Any]] = {}
        for _, result in results:
            for item in result.evidence:
                evidence.setdefault(item["id"], item)
            for fact in result.facts:
                facts.setdefault(fact["label"], fact)
        visual = None
        by_name: dict[str, ToolResult] = {}
        for name, result in results:
            if result.visual:
                by_name.setdefault(name, result)  # first wins: e.g. primary Sentinel-2 before Landsat context
        for name in VISUAL_PRIORITY:
            if name in by_name and by_name[name].visual:
                visual = by_name[name].visual
                break
        user_numbers: list[float] = []
        for match in re.finditer(r"\d+(?:\.\d+)?", request.message):
            user_numbers.append(float(match.group()))
        verification = verify_figures(answer, payloads, [*context.numbers(), *user_numbers])
        if not follow_ups:
            follow_ups = default_follow_ups(context, [name for name, _ in results], [result for _, result in results])
        payload = {
            "request_id": request_id,
            "answer": answer,
            "evidence": list(evidence.values())[:8],
            "facts": list(facts.values())[:6],
            "visual": visual,
            "follow_ups": follow_ups[:3],
            "tools_used": traces,
            "context_used": context.public(),
            "context_notes": context.notes,
            "verification": verification,
            "model": model,  # the model that actually produced this answer
            "primary_model": self.settings.model,
            "fallback_used": model != self.settings.model,
            "fallback_reason": fallback_reason,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            return ChatResponse.model_validate(payload).model_dump()
        except ValidationError:
            logger.exception("AI response failed validation")
            raise AIError("invalid_output") from None
