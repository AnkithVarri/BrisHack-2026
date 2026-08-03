# Solar & Weather API Documentation

Base URL: `http://localhost:8000`

---

## Shared Request Body (Solar Endpoints)

All `POST /solar/*` endpoints use the same JSON request body.

### Body Schema

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `points` | `Point[]` | Yes | — | Polygon vertices (min 3 points) |
| `panel_efficiency` | `number` | No | `0.20` | Panel efficiency ratio (0.20 = 20%) |
| `panel_area` | `number` | No | `50.0` | Total panel area in m² |
| `panel_tilt` | `number` | No | `30.0` | Panel tilt angle in degrees |
| `param_area` | `number` | No | `1.7` | Single panel area in m² (used to estimate panel count) |

`Point`:

| Field | Type | Required |
|---|---|---|
| `latitude` | `number` | Yes |
| `longitude` | `number` | Yes |

### Example Body

```json
{
  "points": [
    { "latitude": 51.5074, "longitude": -0.1278 },
    { "latitude": 51.5074, "longitude": -0.1200 },
    { "latitude": 51.5000, "longitude": -0.1200 },
    { "latitude": 51.5000, "longitude": -0.1278 }
  ],
  "panel_efficiency": 0.2,
  "panel_area": 50,
  "panel_tilt": 30,
  "param_area": 1.7
}
```

---

## 1. `POST /solar/polygon-efficiency`

Calculate daily solar efficiency for a polygon area with hourly breakdown.

### Response Schema

| Field | Type | Description |
|---|---|---|
| `midpoint` | `Point` | Computed geographic midpoint of the polygon |
| `date` | `string` | ISO date used for calculation (e.g. `"2026-02-22"`) |
| `hourly_data` | `HourlyGraphData[]` | 24 hourly records |
| `summary` | `object` | Aggregate daily metrics |

#### `HourlyGraphData`

| Field | Type | Description |
|---|---|---|
| `hour` | `string` | Timestamp (e.g. `"2026-02-22T12:00"`) |
| `efficiency_score` | `number` | Overall efficiency score (0–1) |
| `solar_resource` | `number` | Solar resource sub-score (0–1) |
| `weather_reliability` | `number` | Weather reliability sub-score (0–1) |
| `shading_factor` | `number` | Terrain shading factor (0–1). `1.0` = fully exposed, `0.0` = fully shadowed by surrounding terrain |
| `energy_kwh` | `number` | Energy output for this hour (kWh) |
| `irradiance_wm2` | `number` | Plane-of-array irradiance (W/m²) |
| `is_daylight` | `boolean` | Whether this hour has daylight |
| `ambient_temperature_c` | `number` | Ambient air temperature (°C) |
| `cell_temperature_c` | `number` | Estimated solar cell temperature (°C) — always ≥ ambient due to solar heating |
| `energy_efficiency_loss` | `number` | Temperature efficiency factor: `1.0` = no loss, `< 1.0` = heat loss, `> 1.0` = cold-weather gain |

#### `summary`

| Key | Type | Description |
|---|---|---|
| `average_efficiency_24h` | `number` | 24-hour average efficiency score |
| `average_efficiency_daylight` | `number` | Daylight-only average efficiency score |
| `peak_efficiency` | `number` | Highest hourly efficiency score |
| `peak_hour` | `string` | Hour with peak efficiency |
| `total_daylight_hours` | `number` | Number of daylight hours |
| `total_energy_kwh` | `number` | Total daily energy output (kWh) |
| `peak_power_kw` | `number` | Peak hourly power output (kW) |
| `panel_area_m2` | `number` | Total panel area (m²) |
| `panel_efficiency_percent` | `number` | Panel efficiency as percentage |
| `estimated_panel_count` | `number` | Estimated number of panels (`panel_area / param_area`) |
| `shading_factor` | `number` | Terrain shading factor (0–1). `1.0` = fully exposed |
| `shadow_coverage_percent` | `number` | Approximate terrain shadow coverage as a percentage (e.g. `10.5` = 10.5% shadowed) |
| `albedo` | `number` | Ground reflectivity from NASA POWER (e.g. `0.17` for grass, `0.80` for snow) |

### Example Response

```json
{
  "midpoint": { "latitude": 51.5037, "longitude": -0.1239 },
  "date": "2026-02-22",
  "hourly_data": [
    {
      "hour": "2026-02-22T00:00",
      "efficiency_score": 0.0,
      "solar_resource": 0.0,
      "weather_reliability": 0.85,
      "shading_factor": 0.92,
      "energy_kwh": 0.0,
      "irradiance_wm2": 0.0,
      "is_daylight": false,
      "ambient_temperature_c": 5.2,
      "cell_temperature_c": 5.2,
      "energy_efficiency_loss": 1.0
    },
    {
      "hour": "2026-02-22T12:00",
      "efficiency_score": 0.42,
      "solar_resource": 0.65,
      "weather_reliability": 0.80,
      "shading_factor": 0.92,
      "energy_kwh": 3.2,
      "irradiance_wm2": 450.0,
      "is_daylight": true,
      "ambient_temperature_c": 12.5,
      "cell_temperature_c": 26.8,
      "energy_efficiency_loss": 0.9928
    }
  ],
  "summary": {
    "average_efficiency_24h": 0.15,
    "average_efficiency_daylight": 0.38,
    "peak_efficiency": 0.45,
    "peak_hour": "2026-02-22T12:00",
    "total_daylight_hours": 10,
    "total_energy_kwh": 18.5,
    "peak_power_kw": 3.2,
    "panel_area_m2": 50.0,
    "panel_efficiency_percent": 20.0,
    "estimated_panel_count": 29,
    "shading_factor": 0.92,
    "shadow_coverage_percent": 8.0,
    "albedo": 0.17
  }
}
```

---

## 2. `POST /solar/polygon-yearly?year={year}`

Calculate solar efficiency for a polygon area across an entire year with monthly breakdown.

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `year` | `int` | No | Current year | Year to calculate |

### Response Schema

| Field | Type | Description |
|---|---|---|
| `midpoint` | `Point` | Computed geographic midpoint |
| `year` | `int` | Year calculated |
| `monthly_data` | `MonthlyGraphData[]` | 12 monthly records |
| `summary` | `object` | Aggregate yearly metrics |

#### `MonthlyGraphData`

| Field | Type | Description |
|---|---|---|
| `month` | `int` | Month number (1–12) |
| `month_name` | `string` | Month name (e.g. `"January"`) |
| `average_efficiency_score` | `number` | Monthly average efficiency score |
| `total_energy_kwh` | `number` | Total monthly energy output (kWh) |
| `average_daily_energy_kwh` | `number` | Average daily energy output (kWh) |
| `average_daylight_hours` | `number` | Average daylight hours per day |

#### `summary`

| Key | Type | Description |
|---|---|---|
| `year` | `int` | Year |
| `total_energy_kwh` | `number` | Total annual energy output (kWh) |
| `average_efficiency_score` | `number` | Average annual efficiency score |
| `best_month` | `string` | Best performing month name |
| `worst_month` | `string` | Worst performing month name |
| `panel_area_m2` | `number` | Total panel area (m²) |
| `panel_efficiency_percent` | `number` | Panel efficiency as percentage |
| `estimated_panel_count` | `number` | Estimated number of panels |
| `shading_factor` | `number` | Terrain shading factor (0–1). `1.0` = fully exposed |
| `shadow_coverage_percent` | `number` | Approximate terrain shadow coverage as a percentage |
| `albedo` | `number` | Ground reflectivity from NASA POWER |

### Example Response

```json
{
  "midpoint": { "latitude": 51.5037, "longitude": -0.1239 },
  "year": 2026,
  "monthly_data": [
    {
      "month": 1,
      "month_name": "January",
      "average_efficiency_score": 0.18,
      "total_energy_kwh": 120.5,
      "average_daily_energy_kwh": 3.9,
      "average_daylight_hours": 8.2
    }
  ],
  "summary": {
    "year": 2026,
    "total_energy_kwh": 5200.0,
    "average_efficiency_score": 0.35,
    "best_month": "June",
    "worst_month": "December",
    "panel_area_m2": 50.0,
    "panel_efficiency_percent": 20.0,
    "estimated_panel_count": 29,
    "shading_factor": 0.92,
    "shadow_coverage_percent": 8.0,
    "albedo": 0.17
  }
}
```

---

## 3. `POST /solar/signals`

Generate AI-powered advisory signals using OpenAI with climate change projections.

Uses the same request body as the other solar endpoints.

### Response Schema

| Field | Type | Description |
|---|---|---|
| `signals` | `SignalItem[]` | Array of advisory signals |

#### `SignalItem`

| Field | Type | Description |
|---|---|---|
| `type` | `string` | One of `"info"`, `"warning"`, `"tip"` |
| `title` | `string` | Short title (under 10 words) |
| `content` | `string` | 1–2 sentence actionable insight |
| `climate` | `boolean` | `true` if signal is based on climate/future projections, `false` otherwise |

### Example Response

```json
{
  "signals": [
    {
      "type": "info",
      "title": "Good sunlight hours",
      "content": "Your location receives approximately 10 hours of daylight today, providing solid energy generation potential.",
      "climate": false
    },
    {
      "type": "tip",
      "title": "Consider battery storage",
      "content": "With 8.5 kWh of daily generation, a home battery could store excess daytime energy for evening use.",
      "climate": false
    },
    {
      "type": "warning",
      "title": "Cloud cover expected",
      "content": "Heavy cloud cover today may reduce your solar output by up to 40%.",
      "climate": false
    },
    {
      "type": "info",
      "title": "Rising temperatures ahead",
      "content": "Climate projections show a 1.8°C increase by 2050, which may reduce panel efficiency by 2-3% due to higher cell temperatures.",
      "climate": true
    }
  ]
}
```

---

## 4. `POST /geo/midpoint`

Calculate the geographic midpoint of a set of lat/long points.

### Request Body

```json
{
  "points": [
    { "latitude": 51.5074, "longitude": -0.1278 },
    { "latitude": 51.5000, "longitude": -0.1200 }
  ]
}
```

### Response Schema

| Field | Type | Description |
|---|---|---|
| `midpoint` | `Point` | Computed geographic midpoint |
| `num_points` | `int` | Number of input points |

### Example Response

```json
{
  "midpoint": { "latitude": 51.5037, "longitude": -0.1239 },
  "num_points": 2
}
```

---

## 5. `GET /weather/today`

Get current-day forecast including hourly and current weather data.

### Query Parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `latitude` | `number` | Yes | Latitude (-90 to 90) |
| `longitude` | `number` | Yes | Longitude (-180 to 180) |

### Example Request

```
GET /weather/today?latitude=51.5074&longitude=-0.1278
```

### Response

Returns Open-Meteo forecast data with the following top-level keys:

| Key | Type | Description |
|---|---|---|
| `latitude` | `number` | Resolved latitude |
| `longitude` | `number` | Resolved longitude |
| `timezone` | `string` | Timezone (e.g. `"Europe/London"`) |
| `current` | `object` | Current conditions: `temperature_2m`, `relative_humidity_2m`, `weather_code`, `cloud_cover`, `is_day` |
| `daily` | `object` | Daily summary: `weather_code`, `temperature_2m_max/min`, `apparent_temperature_max/min`, `sunrise`, `sunset`, `daylight_duration`, `sunshine_duration`, `uv_index_max` |
| `hourly` | `object` | 24 hourly values: `temperature_2m`, `relative_humidity_2m`, `weather_code`, `cloud_cover`, `direct_radiation` |

---

## 6. `GET /weather/monthly`

Get daily weather data for a given month.

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `latitude` | `number` | Yes | — | Latitude (-90 to 90) |
| `longitude` | `number` | Yes | — | Longitude (-180 to 180) |
| `year` | `int` | No | Current year | Year |
| `month` | `int` | No | Current month | Month (1–12) |

### Example Request

```
GET /weather/monthly?latitude=51.5074&longitude=-0.1278&year=2026&month=2
```

### Response

Returns Open-Meteo data with `daily` key containing arrays for each day:

| `daily` Key | Type | Description |
|---|---|---|
| `time` | `string[]` | ISO dates |
| `weather_code` | `int[]` | WMO weather codes |
| `temperature_2m_max` | `number[]` | Daily max temperature (°C) |
| `temperature_2m_min` | `number[]` | Daily min temperature (°C) |
| `temperature_2m_mean` | `number[]` | Daily mean temperature (°C) |
| `relative_humidity_2m_mean` | `number[]` | Daily mean humidity (%) |
| `relative_humidity_2m_max` | `number[]` | Daily max humidity (%) |
| `relative_humidity_2m_min` | `number[]` | Daily min humidity (%) |

---

## 7. `GET /weather/yearly`

Get daily weather data for an entire year.

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `latitude` | `number` | Yes | — | Latitude (-90 to 90) |
| `longitude` | `number` | Yes | — | Longitude (-180 to 180) |
| `year` | `int` | No | Current year | Year |

### Example Request

```
GET /weather/yearly?latitude=51.5074&longitude=-0.1278&year=2025
```

### Response

Same structure as `/weather/monthly` but covering all 365/366 days, plus `precipitation_sum` in `daily`.

---

## 8. `GET /weather/climate`

Get IPCC climate change projections (daily resolution).

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `latitude` | `number` | Yes | — | Latitude (-90 to 90) |
| `longitude` | `number` | Yes | — | Longitude (-180 to 180) |
| `start_year` | `int` | No | `2024` | Start year for projections |
| `end_year` | `int` | No | `2050` | End year for projections |

### Example Request

```
GET /weather/climate?latitude=51.5074&longitude=-0.1278&start_year=2026&end_year=2052
```

### Response

Returns Open-Meteo climate model data with `daily` key containing arrays:

| `daily` Key | Type | Description |
|---|---|---|
| `time` | `string[]` | ISO dates |
| `temperature_2m_max` | `number[]` | Daily max temperature (°C) |
| `temperature_2m_min` | `number[]` | Daily min temperature (°C) |
| `temperature_2m_mean` | `number[]` | Daily mean temperature (°C) |
| `precipitation_sum` | `number[]` | Daily total precipitation (mm) |
| `rain_sum` | `number[]` | Daily total rain (mm) |
| `snowfall_sum` | `number[]` | Daily total snowfall (cm) |
| `wind_speed_10m_max` | `number[]` | Daily max wind speed (m/s) |
| `relative_humidity_2m_max` | `number[]` | Daily max humidity (%) |
| `relative_humidity_2m_min` | `number[]` | Daily min humidity (%) |
| `relative_humidity_2m_mean` | `number[]` | Daily mean humidity (%) |

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "detail": "Error message describing what went wrong"
}
```

| Status Code | Meaning |
|---|---|
| `400` | Bad request (e.g. fewer than 3 polygon points) |
| `500` | Server error (calculation failure, API fetch failure) |
| `502` | Upstream error (OpenAI request failed) |
