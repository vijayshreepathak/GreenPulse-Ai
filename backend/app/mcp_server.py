"""GreenPulse AI MCP server (Model Context Protocol, stdio transport).

This is separate from the in-app AI Copilot:

* The Copilot uses **native Gemini function calling** inside FastAPI (``app/ai/agent.py``):
  Gemini proposes a tool call, the backend runs it, and the result goes back to Gemini.
  Gemini never connects to this server.
* This module exposes the **same read-only tool registry** (``app.ai.tools.TOOLS``: same names,
  descriptions, JSON schemas, argument validation and handlers) to external MCP clients such as
  Claude Desktop, Claude Code, MCP Inspector or any MCP-compatible agent.

No business logic is duplicated: every call goes through ``run_tool`` and therefore through the
official scoring engine, the cached air-quality service and the spatial services. All tools are
read-only. Run from ``backend/``::

    .venv/Scripts/python.exe -m app.mcp_server        # Windows
    .venv/bin/python -m app.mcp_server                # macOS / Linux

stdout carries the MCP protocol; logs go to stderr.
"""

import json
import logging
from typing import Any

import anyio
import mcp_types as types
from mcp.server.lowlevel.server import Server
from mcp.server.stdio import stdio_server

from . import config
from .ai.tools import TOOLS, AnalysisSnapshot, run_tool
from .scoring import DataValidationError

logger = logging.getLogger("greenpulse.mcp")

SERVER_NAME = "greenpulse-ai"
INSTRUCTIONS = (
    "Read-only environmental data for the GreenPulse AI campus analysis (TIET, Patiala, India): five analysis "
    "zones and 447 usable 50 m cells. Official priority scores are zone-level and rule-based (not machine "
    "learning). PM2.5/PM10 are Open-Meteo/CAMS modelled regional estimates, not campus sensor readings and not "
    "an official AQI. Sentinel-2 and Landsat histories are separate datasets. Scenario results are hypothetical. "
    "Every tool result includes its sources under 'evidence'."
)


def _zone_ids() -> list[str]:
    try:
        return sorted(AnalysisSnapshot().zone_names())
    except (OSError, DataValidationError, ValueError):
        logger.warning("Zone list unavailable; zone_id arguments are not constrained", exc_info=True)
        return []


def tool_definitions() -> list[types.Tool]:
    """MCP tool list built from the Copilot's registry, so both interfaces always match."""
    zone_ids = _zone_ids()
    return [
        types.Tool(
            name=spec.name,
            description=spec.description,
            input_schema=spec.parameters(zone_ids),
            annotations=types.ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True),
        )
        for spec in TOOLS.values()
    ]


def execute(name: str, arguments: dict[str, Any] | None) -> types.CallToolResult:
    """Run one registry tool. Invalid input and missing data come back as an MCP tool error."""
    try:
        result, payload = run_tool(name, arguments or {}, AnalysisSnapshot())
    except DataValidationError as exc:
        payload, result = {"error": f"Dataset validation failed: {exc}"}, None
    except Exception:  # never leak a traceback to the client
        logger.exception("MCP tool %s failed", name)
        payload, result = {"error": "The project data needed for this tool could not be read."}, None
    if result is None:
        return types.CallToolResult(content=[types.TextContent(type="text", text=json.dumps(payload))], is_error=True)
    body = {"tool": name, "data": result.payload, "evidence": result.evidence}
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(body, ensure_ascii=False))],
        structured_content=body,
        is_error=False,
    )


async def _list_tools(_ctx: Any, _params: Any) -> types.ListToolsResult:
    return types.ListToolsResult(tools=await anyio.to_thread.run_sync(tool_definitions))


async def _call_tool(_ctx: Any, params: types.CallToolRequestParams) -> types.CallToolResult:
    # pandas and the air-quality cache are blocking; keep them off the protocol's event loop.
    return await anyio.to_thread.run_sync(execute, params.name, params.arguments)


def build_server() -> Server:
    return Server(
        SERVER_NAME,
        version=config.API_VERSION,
        title="GreenPulse AI",
        description="Read-only campus vegetation, land-cover, priority-score and modelled air-quality tools.",
        instructions=INSTRUCTIONS,
        on_list_tools=_list_tools,
        on_call_tool=_call_tool,
    )


async def serve() -> None:
    server = build_server()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def main() -> None:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")  # stderr only
    anyio.run(serve)


if __name__ == "__main__":
    main()
