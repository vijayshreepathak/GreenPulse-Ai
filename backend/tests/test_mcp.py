"""The GreenPulse MCP server, exercised with the official MCP client (no mocks of the protocol).

In-process tests connect `mcp.Client` straight to the server object with isolated datasets and the
mocked air-quality provider. The stdio test launches the real server as a subprocess and talks to
it over stdin/stdout exactly as Claude Desktop or MCP Inspector would.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import Client, StdioServerParameters

from app.ai.tools import TOOLS, AnalysisSnapshot, run_tool
from app.mcp_server import build_server

BACKEND = Path(__file__).resolve().parents[1]


def run(coroutine):
    return asyncio.run(coroutine)


def test_tool_discovery_mirrors_the_copilot_registry(data_dirs, provider):
    async def scenario():
        async with Client(build_server()) as client:
            assert client.server_info.name == "greenpulse-ai"
            return (await client.list_tools()).tools

    tools = run(scenario())
    assert [tool.name for tool in tools] == list(TOOLS)
    assert all(tool.annotations.read_only_hint and not tool.annotations.destructive_hint for tool in tools)
    by_name = {tool.name: tool for tool in tools}
    assert by_name["get_zone_details"].input_schema["properties"]["zone_id"]["enum"] == ["Z01", "Z02", "Z03", "Z04", "Z05"]
    assert by_name["compare_zones"].input_schema["properties"]["zone_ids"]["maxItems"] == 3
    assert by_name["get_zone_rankings"].description == TOOLS["get_zone_rankings"].description


def test_tool_execution_returns_official_data_and_sources(client, data_dirs, provider):
    official = {row["zone_id"]: row["priority_score"] for row in client.get("/priority").json()}

    async def scenario():
        async with Client(build_server()) as mcp_client:
            rankings = await mcp_client.call_tool("get_zone_rankings", {})
            comparison = await mcp_client.call_tool("compare_zones", {"zone_ids": ["Z01", "Z05"]})
            history = await mcp_client.call_tool("get_vegetation_history", {"dataset": "sentinel2", "zone_id": "Z01"})
            return rankings, comparison, history

    rankings, comparison, history = run(scenario())
    assert rankings.is_error is False
    zones = rankings.structured_content["data"]["zones"]
    assert {zone["zone_id"]: zone["priority_score"] for zone in zones} == official  # same scoring snapshot as the API
    assert rankings.structured_content["evidence"][0]["label"] == "Official priority ranking"
    assert json.loads(rankings.content[0].text) == rankings.structured_content

    metrics = {metric["metric"]: metric for metric in comparison.structured_content["data"]["metrics"]}
    assert metrics["priority_score"]["values"] == {"Z01": official["Z01"], "Z05": official["Z05"]}
    assert [point["year"] for point in history.structured_content["data"]["ndvi_series"]] == list(range(2018, 2026))
    assert history.structured_content["evidence"][0]["label"] == "Sentinel-2 seasonal composite"


def test_mcp_and_gemini_tools_share_one_implementation(data_dirs, provider):
    async def scenario():
        async with Client(build_server()) as client:
            return await client.call_tool("get_zone_details", {"zone_id": "Z03"})

    via_mcp = run(scenario()).structured_content["data"]
    _, via_registry = run_tool("get_zone_details", {"zone_id": "Z03"}, AnalysisSnapshot())
    # Same PM snapshot (same fetch time); only the per-request freshness label differs (live, then cached).
    assert via_mcp["shared_pm_stress"]["pm_fetched_at"] == via_registry["shared_pm_stress"]["pm_fetched_at"]
    for payload in (via_mcp, via_registry):
        payload["shared_pm_stress"].pop("pm_freshness")
    assert via_mcp == via_registry


def test_invalid_input_and_unknown_tools_are_tool_errors(data_dirs, provider):
    async def scenario():
        async with Client(build_server()) as client:
            return (
                await client.call_tool("get_zone_details", {"zone_id": "Z99"}),
                await client.call_tool("compare_zones", {"zone_ids": ["Z01"]}),
                await client.call_tool("delete_all_data", {}),
                await client.call_tool("get_scenario_comparison", {}),
            )

    unknown_zone, too_few, unknown_tool, no_weights = run(scenario())
    assert unknown_zone.is_error and "Unknown zone 'Z99'" in unknown_zone.content[0].text
    assert too_few.is_error and "Invalid arguments for compare_zones" in too_few.content[0].text
    assert unknown_tool.is_error and "Only the declared GreenPulse tools" in unknown_tool.content[0].text
    assert no_weights.is_error and "No scenario weights" in no_weights.content[0].text


def test_stdio_server_works_as_a_real_subprocess(tmp_path):
    """Launch `backend/mcp_server.py` from another directory and use it over stdio."""
    env = {**os.environ, "GREENPULSE_OPEN_METEO_URL": "http://127.0.0.1:9/unreachable"}
    params = StdioServerParameters(command=sys.executable, args=[str(BACKEND / "mcp_server.py")], env=env, cwd=str(tmp_path))

    async def scenario():
        async with Client(params, read_timeout_seconds=60) as client:
            tools = (await client.list_tools()).tools
            overview = await client.call_tool("get_campus_overview", {})
            method = await client.call_tool("get_scoring_methodology", {})
            return tools, overview, method

    tools, overview, method = run(scenario())
    assert len(tools) == len(TOOLS)
    assert overview.is_error is False
    assert overview.structured_content["data"]["spatial_grid"]["usable_cells"] == 447
    assert overview.structured_content["data"]["analysis_zones"]["count"] == 5
    assert method.structured_content["data"]["weights"] == {
        "low_green_cover": 0.35, "ndvi_decline": 0.25, "built_up_pressure": 0.2, "tree_gap": 0.1, "pm_stress": 0.1,
    }
