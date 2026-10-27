# GreenPulse AI Frontend

React 18 + Vite interface: React Leaflet maps, Recharts charts, Lucide icons and plain CSS (including the few animations, which reduced motion switches off) built on design tokens (`src/styles/tokens.css`).

## Run

```powershell
npm ci
npm run dev        # http://127.0.0.1:5173 (host/port set in vite.config.js)
```

The app calls the API at `http://127.0.0.1:8000` by default; set `VITE_API_BASE_URL` to change it.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm run preview` | Production build and local preview (port 4173 is allowed by the backend CORS default) |
| `npm run test` | Vitest unit and component tests |
| `npm run lint` | ESLint (including React Hooks rules) |
| `npm run test:e2e` | Playwright workflow and axe accessibility tests (starts backend and Vite if needed) |

## Structure

| Path | Contents |
|---|---|
| `src/App.jsx` | Hash routing, selection state, comparison and scenario state, exports |
| `src/hooks/useDashboardData.js` | Independent source loading, atomic refresh of PM context + ranking, stale-response protection, background refresh scheduling |
| `src/context/` | Theme (light/dark/system, persisted), preferences (motion, background refresh, map scroll zoom, AI Copilot on/off) and the Copilot conversation (`CopilotContext.jsx`, in memory only) |
| `src/lib/` | Null-safe number/time formatting, scenario maths, insights, rule-based assistant, comparison text, CSV export, Copilot page context (`copilot.js`) and the text-only Markdown renderer (`markdown.jsx`) |
| `src/components/` | Views (overview, map, trends, air-quality, comparison, scenario, insights, report), the Copilot launcher and lazily loaded panel (`copilot/`), and shared UI |
| `e2e/` | Playwright tests (`copilot.spec.js` mocks only the Copilot endpoints) |

## AI Copilot

The launcher and conversation state are in the main bundle; the panel (`CopilotPanel`) loads on first open. The browser never sees the Gemini key: it calls `/api/ai/*` on the backend with the question, recent turns and the page context (IDs and settings only). Views report local settings with `useCopilotViewContext(key, value)` (Vegetation Trends: dataset/unit/metric; Air Quality: range); nothing is collected while the Copilot is switched off. Answers are rendered without HTML or links, and progress labels come from the server's progress endpoint, not from timers.

## Theme

`index.html` applies the saved theme before React loads, so there is no flash of the wrong theme. The header switch toggles light and dark in one click; "System" is available in Settings and follows operating-system changes. Charts read theme-specific palettes and the map basemap is darkened in dark mode.

## Map data

`public/thapar_zones.geojson` provides the five zone polygons. The 50 m cell layers come from `/api/spatial/cells`. If either source is missing, the rest of the app keeps working and the map explains what is unavailable.
