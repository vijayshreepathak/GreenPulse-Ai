# GreenPulse AI Frontend

React + Vite environmental intelligence interface with React Leaflet, Recharts, Framer Motion, Lucide icons, and responsive plain CSS.

## Run

```bash
npm install
npm run dev
```

The frontend defaults to `http://localhost:8000` for backend API calls. Set `VITE_API_BASE_URL` to override it.

Production check:

```bash
npm run build
```

## Optional Map

Place `thapar_zones.geojson` in `public/` to enable the five-zone priority map. The 50 m cell layers are loaded from the backend spatial API.
