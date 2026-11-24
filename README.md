# BrisHack-2026 — SolarSAT
**SolarSAT** is a solar panel site-assessment tool built for BrisHack 2026. Draw a polygon on an interactive 3D/2D globe, configure panel parameters, and get daily + yearly efficiency estimates, terrain shading, energy output, and optional AI advisory signals.
**Repo:** [github.com/AnkithVarri/BrisHack-2026](https://github.com/AnkithVarri/BrisHack-2026)
---
## Features
- **Interactive map** — MapLibre globe with satellite / street / light / dark styles; draw installation polygons (Mapbox Draw–compatible tooling)
- **Location search** — Jump to places worldwide
- **Daily efficiency** — Hourly breakdown of irradiance, efficiency score, energy (kWh), cell temperature, and daylight hours
- **Yearly outlook** — Monthly energy and efficiency estimates for seasonal planning
- **Terrain shading** — Monte Carlo shadow analysis over a local DEM elevation grid (Open-Meteo Elevation / Copernicus DEM)
- **Ground albedo** — NASA POWER surface reflectivity for more realistic POA irradiance
- **Weather-driven scores** — Forecast + historical weather from Open-Meteo (temperature, cloud cover, radiation)
- **AI signals (optional)** — OpenAI-powered tips/warnings informed by efficiency + climate projections
---
## Architecture
```
BrisHack-2026/
├── frontend/          # Next.js (React) UI — map, controls, charts
├── backend/           # FastAPI — solar calculations + data services
│   ├── calculations/  # Efficiency, energy, shading math
│   ├── services/      # Weather, elevation, NASA POWER, OpenAI, HTTP client
│   └── main.py        # API routes
└── README.md
```
| Layer | Stack |
|---|---|
| Frontend | Next.js 16, React 19, MapLibre GL, Framer Motion, Recharts, Tailwind |
| Backend | FastAPI, Uvicorn, NumPy, SciPy, pvlib, httpx |
| External data | Open-Meteo (weather / elevation / climate), NASA POWER (albedo), OpenAI (signals) |
**Default ports**
| Service | URL |
|---|---|
| Frontend | http://127.0.0.1:3000 |
| Backend API | http://127.0.0.1:8000 |
| API docs (Swagger) | http://127.0.0.1:8000/docs |
---
## Prerequisites
- **Python** 3.11+ (3.13/3.14 work; use a local venv)
- **Node.js** 18+ and npm
- Optional: **OpenAI API key** for advisory signals
No Mapbox token is required for the default MapLibre + Esri/OpenFreeMap styles.
---
## Quick start
### 1. Clone
```bash
git clone https://github.com/AnkithVarri/BrisHack-2026.git
cd BrisHack-2026
```
### 2. Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# Optional env
cp .env.example .env
# Edit .env and set OPENAI_API_KEY if you want AI signals
uvicorn main:app --host 127.0.0.1 --port 8000
```
### 3. Frontend (new terminal)
```bash
cd frontend
npm install
# Optional
cp .env.example .env.local
# NEXT_PUBLIC_SOLAR_API_URL=http://localhost:8000   # default already
npm run dev
# If `next` has permission issues on macOS:
# node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3000
```
Open **http://127.0.0.1:3000**.
---
## Environment variables
### Backend (`backend/.env`)
| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | No | Enables `POST /solar/signals`. Without it, core efficiency still works; signals fail gracefully on the UI. |
| `OPEN_METEO_API_KEY` | No | Only used for paid `customer-*` Open-Meteo hosts. The app uses **public** Open-Meteo endpoints by default. |
### Frontend (`frontend/.env.local`)
| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SOLAR_API_URL` | No | Backend base URL (default `http://localhost:8000`) |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | No | Only needed if you switch map styles back to Mapbox |
Never commit real `.env` / `.env.local` files — they are gitignored. Use the `.env.example` templates.
---
## How to use the app
1. Wait for the globe / map to load.
2. Search for a location or pan/zoom manually.
3. Draw a polygon over the roof / land area (keep under the max area limit, ~5 ha by default).
4. Adjust panel efficiency (%), tilt (°), and related controls if needed.
5. Review:
   - **Daily** hourly efficiency & energy charts
   - **Yearly** monthly seasonal estimates
   - **Signals** (if OpenAI key is configured)
---
## Backend API
Base URL: `http://localhost:8000`  
Interactive docs: `/docs`
### Health
| Method | Path | Description |
|---|---|---|
    { "latitude": 51.5074, "longitude": -0.1278 },
    { "latitude": 51.5074, "longitude": -0.1200 },
    { "latitude": 51.5000, "longitude": -0.1200 },
    { "latitude": 51.5000, "longitude": -0.1278 }
  ],
  "panel_efficiency": 0.2,
  "panel_area": 50.0,
  "panel_tilt": 30.0,
  "param_area": 1.7
}
```
| Method | Path | Description |
|---|---|---|
| `POST` | `/solar/polygon-efficiency` | Daily hourly efficiency + energy summary |
| `POST` | `/solar/polygon-yearly?year=2026` | Monthly yearly outlook |
| `POST` | `/solar/signals` | AI advisory signals (requires `OPENAI_API_KEY`) |
Full response schemas live in [`backend/SOLAR_POLYGON_API_DOCS.md`](backend/SOLAR_POLYGON_API_DOCS.md).
### Example curl
```bash
curl -s -X POST "http://127.0.0.1:8000/solar/polygon-efficiency" \
  -H "Content-Type: application/json" \
  -d '{
    "points": [
      {"latitude": 51.455, "longitude": -2.604},
      {"latitude": 51.455, "longitude": -2.600},
      {"latitude": 51.452, "longitude": -2.600},
      {"latitude": 51.452, "longitude": -2.604}
    ],
    "panel_efficiency": 0.2,
    "panel_area": 50,
    "panel_tilt": 30
  }'
```
---
## Project structure (detail)
### `backend/calculations/`
| Module | Role |
|---|---|
| `daily_efficiency.py` | Daily / monthly / yearly efficiency orchestration |
| `efficiency_score.py` | Composite efficiency scoring |
| `energy_input.py` | Irradiance → energy estimates |
| `shadow_map.py` | Monte Carlo terrain shadow approximation |
| `midpoints.py` | Polygon geographic midpoint |
| `weather.py` | Weather-related scoring helpers |
### `backend/services/`
| Module | Role |
|---|---|
| `weather.py` | Open-Meteo forecast / archive / climate |
| `elevation.py` | DEM grid + shading factor |
| `nasa_power.py` | Albedo fetch |
| `openai_signals.py` | Advisory signal generation |
| `http_client.py` | Cached HTTP client with retries + Open-Meteo throttling |
### `frontend/`
| Path | Role |
|---|---|
| `app/page.tsx` | Main SolarSAT UI |
| `components/solar-map.tsx` | MapLibre map + polygon drawing |
| `components/solar-data-panel.tsx` | Charts / summaries / signals |
| `components/location-search.tsx` | Place search |
| `components/solar-panel-info.tsx` | Panel parameter UI bits |
---
## Efficiency model (high level)
For a drawn polygon the backend:
1. Computes the **geographic midpoint**
2. Fetches a local **elevation grid** and estimates a **shading factor** (0–1)
3. Fetches **albedo** from NASA POWER
4. Pulls **hourly weather / radiation** from Open-Meteo (archive for past days, forecast for near-term)
5. Scores each hour (solar resource, weather reliability, shading, system efficiency)
6. Estimates **plane-of-array irradiance**, **cell temperature**, and **kWh** output
7. Aggregates to daily / monthly / yearly summaries
Yearly mode samples representative day(s) per month (default **1 mid-month day**) to stay within free Open-Meteo rate limits. The HTTP client also throttles and retries on `429`.
---
## Development tips
### Run backend with reload
```bash
cd backend
source .venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 8000 --reload --reload-exclude '.venv/*'
```
Avoid watching the venv directory — it can cause endless reload loops.
### Backend tests / helpers
```bash
cd backend
source .venv/bin/activate
python test_solar_endpoints.py   # hits a running server
python test_weather.py
```
### Frontend production build
```bash
cd frontend
npm run build
npm start
```
---
## Troubleshooting
| Problem | Fix |
|---|---|
| Map loads but efficiency fails | Confirm backend is on port **8000** and `NEXT_PUBLIC_SOLAR_API_URL` points there |
| `429 Too Many Requests` | Wait a minute and retry; yearly calc is throttled — avoid spamming redraws |
| Signals missing / 500 | Set a valid `OPENAI_API_KEY` in `backend/.env` and restart Uvicorn |
| `next: Permission denied` | Run via `node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3000` |
| Empty / wrong Python packages | Recreate the venv (`python3 -m venv .venv`) and reinstall `requirements.txt` |
| CORS issues | Backend allows all origins in dev (`CORSMiddleware`); ensure you’re calling the correct API host |
---
## Tech notes
- Public Open-Meteo endpoints are used by default (no paid customer API key required).
- Map styles use **Esri World Imagery** (satellite) and **OpenFreeMap** vector styles — no Mapbox token needed for the default experience.
- Secrets must never be hardcoded; use env vars and the provided `.env.example` files.
---
## License
Hackathon project — BrisHack 2026. Use and modify as needed for the event and portfolio purposes.
