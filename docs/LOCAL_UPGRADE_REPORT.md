# GreenPulse AI — Local Upgrade Report

Branch `feat/greenpulse-premium-local`, based on `main` @ `4923946`. All changes are local and uncommitted; nothing was pushed or deployed.

## 1. Starting state

- React 18 + Vite 6 single-page dashboard; FastAPI + pandas backend; CSV datasets; Open-Meteo modelled PM.
- The app ran, but these defects were confirmed before any change:

| Area | Defect | Root cause |
|---|---|---|
| Freshness | Cached Open-Meteo data was reported as `live` | Fresh-cache path set `freshness = "live"`, `served_from_cache = False` |
| Consistency | Refreshing air quality did not update the ranking that uses PM stress; `/priority` could use a different PM value than `/dashboard` | Frontend refreshed only `recent_aqi`; `/priority` read the cache file separately |
| Scoring integrity | Missing inputs became valid-looking scores; duplicate zone IDs were silently merged | `fillna(0)` on required inputs; no uniqueness check |
| Map performance | Every selection recreated all 447 cell polygons; selecting a cell flew the map to zoom 18 | GeoJSON `key` included the selection; `flyToBounds` on each selection |
| Map layering | Leaflet zoom controls drew over the sticky header | Equal z-index (1000), no stacking context |
| Display | `Number(null)` rendered missing values as `0` in several helpers | Unsafe numeric coercion |
| Invisible content | Air-quality cards and insights stayed at opacity 0 until scrolled into view (and in print) | `whileInView` reveal animations |
| Runtime | Backend cannot import on Python 3.9 (the machine default) | `X | None` annotations need 3.10+ |
| Security/robustness | CORS `*` with credentials; parser exception text returned to clients; no request timeouts or abort in the frontend | — |
| Tooling | No frontend test or lint scripts; no backend tests | — |

## 2. What changed

**Backend**
- Scoring (`scoring.py`): official formula and rounding order preserved; per-zone `score_status`, `missing_inputs`, weighted `contribution_*` fields; duplicate IDs → HTTP 503; percentages outside 0–100 treated as unavailable; NDVI change uses one campus-wide baseline/latest year and season; deterministic tie-breaking; methodology metadata exposed to the UI.
- Air quality (`external_apis.py`): freshness `live` / `cached` / `stale` / `unavailable`; validation of timestamps and concentrations (null, negative, non-numeric, duplicates, out-of-order, future hours); averages from the latest 24 complete hours at or before now; corrupt-cache tolerance, atomic cache writes, serialised provider calls, sanitised provider errors.
- API (`main.py`): new `GET /api/analysis/current` returns environment + ranking from the same PM payload; restricted CORS (local origins, GET, no credentials); validated query parameters; sanitised error handlers; lifespan startup; `/health` reports dataset availability.
- Spatial (`spatial.py`): geometry validation, cached feature collection, safer history filtering.
- `requirements.txt` given tested version ranges; `requirements-dev.txt` and a pytest suite added.

**Frontend**
- New app shell: sidebar + utility header, hash routing (back/forward, deep links, legacy `?layer=`), mobile drawer with focus trap, skip link.
- Design system: tokens for light/dark, Inter, status colours paired with icons and labels, validated chart palettes.
- Theme: light/dark/system, applied before paint, one-click switch, persisted, follows OS changes in System mode, tolerant of blocked storage.
- Views: Overview, Spatial Explorer, Vegetation Trends, Air Quality, Zone Comparison, Scenario Lab, Insights & Methodology, printable Report.
- Map rewritten with an imperative Leaflet layer that restyles in place; safe DOM tooltips; viewport moves only on reset or when an externally selected feature is off-screen.
- Data hook: independent source loading, atomic refresh, shared in-flight refresh, stale-response guard, abort on unmount, visibility/online-aware background refresh.
- Exports: ranking/comparison/trend/scenario CSV with metadata and formula-injection protection, snapshot JSON, print view.
- Settings, guided tour (non-blocking), rule-based Guided Insights, deterministic comparison interpretation, Scenario Lab clearly labelled experimental.
- `vite.config.js` binds `127.0.0.1:5173` so `npm run dev` behaves the same in PowerShell, which strips the `--` in `npm run dev -- --host …`.

Edge cases covered by tests include: UTF-8 BOM and padded CSV headers, empty and header-only CSVs, numeric zone IDs read as int/float/str, duplicate IDs, out-of-range percentages, missing or duplicate history years, single-year history, all-null/negative/garbage PM values, future and out-of-order hours, corrupt or clock-skewed caches, provider timeouts and HTTP errors, unscorable zones and an empty ranking in the UI, malformed GeoJSON, blocked localStorage, and stale or overlapping refresh responses.

No dataset was modified. No new runtime dependency besides the self-hosted Inter font (Framer Motion was removed in the final audit); dev-only: Vitest, Testing Library, jsdom, ESLint, Playwright, axe-core.

## 3. Final audit pass

A second, independent review (two read-only reviewers plus browser measurements against the production build) found the defects below. All were fixed and covered by tests; nothing in the official formula or the datasets changed.

| Severity | Defect | Root cause | Fix |
|---|---|---|---|
| High | A 24-hour history request shrank the shared PM cache, so `/dashboard` and `/priority` showed 25 hours for 10 minutes | `past_hours` followed the request | Always fetch 168 past hours; slice per response |
| High | A response with only PM2.5 (or only PM10) replaced the last good cache and switched scoring to the fallback | Usability check accepted either pollutant | Require at least one complete PM2.5 + PM10 hour |
| High | Forecast hours stored in the cache were averaged as history once the clock passed them | Cached records re-filtered against "now" | Cached data is cut off at its own fetch time |
| High | During a provider outage every request retried serially (up to ~17 s each) | No failure memory | 60 s back-off; fetch time taken after the lock |
| High | An `inf` year in a history CSV crashed `/priority` and `/dashboard` (HTTP 500) | `int(inf)` | Non-finite years are ignored and reported |
| High | Printing in dark mode produced light-grey text on white paper | Print tokens used `:root`, which `:root[data-theme="dark"]` outranks | Print resets every colour token for both themes; sidebar divider removed |
| High | Selection panel was clipped at 320 px (score breakdown cut off) | Grid tracks sized to table min-content; `.num` header could not wrap | `minmax(0, 1fr)` tracks, wrapping headers, tighter phone padding |
| Medium | A refresh failure was only visible on the Air Quality page | No error state in the header pill or Overview | Pill shows "PM refresh failed", Overview shows the error, polite live-region announcements |
| Medium | A link pasted into an open tab, or back/forward between map URLs, was overwritten by the old selection | URL params read only at mount | Hash navigation drives the selection (revision counter) |
| Medium | Scenario Lab reported rank changes caused only by ties or 2-decimal rounding (e.g. PM-only weights) | Ordinal ranks on rounded scores, split by zone ID | Competition ranks on unrounded scores; "All tied" state; `scenario_tied` and `result_type = hypothetical scenario` in the export |
| Medium | Unscored zones drew partial bars and were announced with a made-up "Total" | Bar summed available contributions | Hatched empty track, "official score unavailable" label |
| Medium | Late refresh failure could label newer data as failed; a reload left the old refresh running | No token guard on failure; reload did not abort | Token guard; reload aborts the pending refresh |
| Low | Timeout while reading the body reported as "unreadable response"; tour dropped keyboard focus; Escape in the export menu also closed the tour; future-dated cache within 5 min counted as fresh; ranks became `1.0` when a zone was unscored; `"1.0"` IDs did not join `1`; empty zone GeoJSON showed "Loading" forever; out-of-range coordinates accepted; hardcoded "Oct–Dec", "5 zones", "of 5" labels; UTC date in filenames; slider and link targets under 24 px; brand subtitle truncated | — | Each fixed with a targeted change and test |
| Performance | Leaflet (45 kB gz) and Framer Motion (41 kB gz) loaded on first paint | Leaflet CSS imported in `main.jsx`; `MotionConfig` at the root for one fade | Leaflet CSS moved into the lazy map; the fade is now CSS, Framer Motion removed. Initial JS ≈ 74 kB transferred |

Investigated and found correct: the official formula and reference ranking, missing-input handling, duplicate-ID rejection, genuine zeros, deterministic official ties, classification on the displayed (rounded) score, same-snapshot consistency across `/dashboard`, `/priority` and `/api/analysis/current`, CSV escaping and formula-injection guard (negative numbers intact), JSON without NaN/Infinity, object-URL cleanup, safe DOM tooltips, in-place map restyling, theme pre-paint.

The previously flaky lazy-view unit test was a cold transform of the first lazy chunk (and Recharts) by the test runner under parallel load: ~430 ms alone, ~850–900 ms with the whole suite, against a 1 s default. Later lazy views take 75–240 ms, and the test already waits on a condition (`findByRole`), so the 5 s ceiling is kept as a ceiling, not a performance claim. In the production build the same views open in 50–125 ms.

## 4. Validation evidence

| Check | Command | Result |
|---|---|---|
| Backend tests | `backend> .venv\Scripts\python.exe -m pytest` | **108 passed** |
| Reference ranking (PM fallback 60) | pytest + independent CSV oracle against the live API | Z01 63.43, Z05 61.11, Z03 53.51, Z04 51.73, Z02 38.50; PM 100 adds exactly 4.00 to every zone; `/dashboard`, `/priority` and `/api/analysis/current` agree with the oracle and share one PM snapshot |
| Frontend unit/component tests | `frontend> npm run test` | **96 passed** in 5 consecutive runs |
| Lint | `npm run lint` | 0 problems |
| Production build | `npm run build` | Success; map, charts and every view except Overview are lazy |
| Dependencies | `npm audit`, `pip check` | 0 vulnerabilities; no broken requirements |
| End-to-end | `npm run test:e2e` (dev server) and with `E2E_BASE_URL=http://127.0.0.1:4173` (production preview) | **14 passed** on each |
| Accessibility | axe-core, WCAG 2.0/2.1 A + AA: 8 views × 2 themes, plus settings, export menu, tour, mobile drawer, 390 px views, Scenario all-tied and invalid states | 0 violations |
| Live API smoke | curl of every endpoint | Expected 200 / 404 / 405 / 422 responses; CORS allows only local origins; no paths or tracebacks in bodies |
| Layout | 320, 390, 768, 1024, 1440 px × light / dark / system-dark × 8 views (production preview) | No page overflow, no clipped content, nothing over the sticky header, no content left invisible |
| Console | same matrix | No warnings or errors |
| Theme flash | init-script observer | Theme attribute set before `<body>` exists (stored dark, stored light, system) |
| Print | report printed in light and dark theme | Identical black-on-white output |

**Performance** (production preview, same machine):

| | Original | Upgraded |
|---|---|---|
| Click → zone details | 66–106 ms | 46–67 ms (table), 26–34 ms (cell on map) |
| Polygons surviving selections | 0 / 447 (recreated each time) | 447 / 447 (DOM identity checked in E2E) |
| After 54 layer switches + cell selections + 6 theme toggles | — | 447 interactive + 5 outline paths, 1 SVG layer, 0 leaked tooltips, heap 8.5 → 10.6 MB |
| First load to KPIs | — | ~235 ms, 74 kB JS transferred |
| Lazy view, first / return visit | — | 51–125 ms / 50–77 ms |

Screenshots: `review-screenshots/` (git-ignored) — `baseline/`, `final/`, `iter3/`, `e2e/`, and `audit/` (print before/after, selection panel at 320/390 px, and the full visual matrix in `audit/visual/`).

## 5. Known limitations

- PM data are regional modelled estimates; tests mock the provider, and live behaviour depends on Open-Meteo availability. During testing the live PM stress was 100 (24-hour PM10 mean ≈ 359 µg/m³), so all zones were +4.00 versus the fallback reference values.
- PM averaging keeps the project's documented rule (latest 24 complete hourly records). With gaps those records can span more than 24 hours; this is now reported (`span_hours`, `complete: false`) rather than changed.
- Map tiles need internet access (OpenStreetMap); polygons and all panels work without them. Dark mode darkens tiles with a CSS filter.
- Leaflet polygons are not keyboard-focusable; keyboard users select zones and cells through the ranking table, comparison picker and trend selectors.
- Guided Insights answers a fixed list of questions (including two deliberately out-of-scope ones that are refused); it does not accept free text.
- The Recharts 2.x line is no longer actively developed upstream; it was kept to avoid an unrelated migration. In jsdom unit tests Recharts logs a 0×0 container warning because jsdom has no layout; no such warning appears in a real browser.
- `uvicorn --reload` was unreliable in this session's detached background shells (Windows reload uses a console Ctrl+C event; a minimal FastAPI app behaved the same). The documented start command omits `--reload`. Reload inside an interactive VS Code terminal was not verifiable from this session.
- Out of scope and not implemented: ML, sensors, drone validation, species recommendation, PostGIS, GeoTIFF tiles, deployment.

## 6. Run locally

```powershell
# terminal 1
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# terminal 2
cd frontend
npm run dev
```

Frontend http://127.0.0.1:5173 · API http://127.0.0.1:8000 · docs http://127.0.0.1:8000/docs
