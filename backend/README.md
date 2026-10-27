# GreenPulse AI Backend

FastAPI service for the campus summary, the official explainable zone scoring, 50 m spatial cells, historical vegetation records and cached modelled air-quality context.

## Run

Requires Python 3.10+ (tested with 3.12).

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

For auto-reload while editing, you can add `--reload --reload-dir app` in an interactive terminal. On Windows uvicorn restarts the worker with a console Ctrl+C event; in this project's testing that was unreliable for servers started as detached background processes, and behaviour can differ between terminals. If edits do not show up, restart the server without `--reload`.

Interactive documentation: `http://127.0.0.1:8000/docs`.

### AI Copilot configuration

```powershell
Copy-Item .env.example .env    # then put your Gemini key in .env (git-ignored)
```

`GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.5-flash-lite`), `GEMINI_FALLBACK_MODEL` (optional, e.g. `gemini-3.1-flash-lite`), `AI_ASSISTANT_ENABLED`, `AI_MAX_TOOL_CALLS` (0–4), `AI_MAX_HISTORY_MESSAGES` (0–20) and `AI_TIMEOUT_SECONDS` (5–120). The file is re-read automatically when it changes (checked on each Copilot request), so the model shown in the UI always matches the configuration; code changes still need a restart. Process environment variables override the file. Out-of-range values are clamped and logged. The key is never returned by any endpoint or written to logs.

`GET /api/ai/status?verify=true` checks the key against both models with free model lookups. 429 responses are logged and returned with Google's structured quota detail (quota ID, limit, model), never the key.

### MCP server

```powershell
.\.venv\Scripts\python.exe -m app.mcp_server     # or, from any directory: <venv python> <path>\backend\mcp_server.py
```

A Model Context Protocol server (stdio) over the same read-only tool registry the AI Copilot uses (`app/ai/tools.py`). It needs no Gemini key. See the root README for client configuration.

## Test

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest
```

Tests copy the committed datasets into a temporary directory and mock the Open-Meteo provider, so they never modify `data/` and need no internet access. They also ignore `backend/.env` and replace Gemini with a scripted fake, so they never use your key or make billable calls.

## Modules

| Module | Responsibility |
|---|---|
| `config.py` | Paths, coordinates, official weights and thresholds, cache TTL, CORS origins |
| `data_loader.py` | CSV loading with sanitised errors, JSON-safe values, atomic file writes |
| `scoring.py` | Official priority score, validation, `insufficient_data` handling, methodology metadata |
| `external_apis.py` | Open-Meteo client, record validation, freshness states, last-good cache (always 168 h, cut off at its fetch time), 60 s back-off after a provider failure |
| `spatial.py` | 50 m cell GeoJSON (geometry validated, cached by file mtime) and cell history |
| `analysis.py` | The official ranking for a given air-quality payload (shared by the endpoints and the Copilot) |
| `main.py` | REST endpoints, CORS, error handlers |
| `ai/settings.py` | Copilot configuration from the environment and `.env` |
| `ai/provider.py` | The only module that calls Gemini (`google-genai`, async) |
| `ai/tools.py` | Ten read-only, allowlisted data tools and their validated arguments |
| `ai/context.py` | Validation of the page context sent by the browser |
| `ai/prompts.py` | Server-owned system instructions, follow-up parsing, link stripping |
| `ai/agent.py` | Function-calling loop: tool-call cap, deadline, one transient retry, response assembly |
| `ai/verify.py` | Matches figures in the answer against the tool results |
| `ai/runs.py` | Real progress, cancellation and per-client throttling (in memory) |
| `ai/routes.py` | `/api/ai/*` endpoints and the request-size limit |
| `ai/methodology.py` | Allowlisted documentation sections and map-layer vocabulary |
| `mcp_server.py` (in `app/`) | MCP server: `tools/list` and `tools/call` over the same registry; `backend/mcp_server.py` is a launcher for MCP clients |

## Data

Place CSV exports in `data/raw/`. Generated outputs go to `data/processed/` (git-ignored). See the root README for the dataset list and API reference.
