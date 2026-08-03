import json
import os
from dataclasses import dataclass
from enum import Enum
from typing import Any

import httpx


OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"


class SignalType(str, Enum):
    INFO = "info"
    WARNING = "warning"
    TIP = "tip"


@dataclass
class Signal:
    type: SignalType
    title: str
    content: str
    climate: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "title": self.title,
            "content": self.content,
            "climate": self.climate,
        }


SYSTEM_PROMPT = """\
You are a solar energy advisor. Given solar panel efficiency data, location coordinates, and \
climate change projections, generate a concise array of actionable signals for the user. \
Each signal must be one of four types:

- "climate": Climate change projections and their impact on solar performance (e.g. temperature trends affecting cell efficiency, changing precipitation/snow patterns, wind changes).  IF A TIP IS BASED ON FUTURE CLIMATE PROJECTS, IT MUST BE BASED ON THIS TYPE OF SIGNAL.
- "info": Neutral observations about the solar setup, conditions, or climate trends (e.g. daylight hours, projected temperature changes).
- "warning": Potential problems or concerns the user should be aware of (e.g. heavy cloud cover, rising temperatures degrading panels, increased precipitation, legal laws in region).
- "tip": Actionable suggestions to improve energy output or system performance (e.g. consider battery storage, plan for climate adaptation).

Rules:
1. Return ONLY a JSON array of objects with keys: "type", "title", "content".
2. "type" must be exactly one of: "info", "warning", "tip".
3. "title" should be short (under 10 words).
4. "content" should be 1-2 sentences, practical, and specific to the data provided.
5. Generate between 3 and 8 signals depending on how much is noteworthy.
6. Do NOT wrap the JSON in markdown code fences or add any text outside the JSON array.
7. Please note that the 'efficiency_score' is a score from 0 to 1, and the higher the score, the better. It is not indicative of the actual efficiency of the panel, but rather a score of how well the panel is performing given the conditions.
8. Consider adding tips regarding the geographic location of the panel, for example specific tips if the panel is in a specific country or region.
9. Do not mention anything related to the average efficiency or panel orientation.
10. If climate projection data is provided, include 1-3 signals about how climate change may impact solar performance at this location over the coming decades (e.g. temperature trends affecting cell efficiency, changing precipitation/snow patterns, wind changes).
11. TIPS FROM CLIMATE PROJECTION DATA MUST BE ADDED AS "climate" TYPE SIGNALS.
"""


def _summarise_climate_data(climate_data: dict[str, Any]) -> dict[str, Any]:
    """
    Condense raw daily climate projections into a compact summary
    that fits well in an LLM prompt without blowing up token count.
    """
    daily = climate_data.get("daily", {})
    times = daily.get("time", [])
    if not times:
        return {}

    temp_mean = daily.get("temperature_2m_mean", [])
    temp_max = daily.get("temperature_2m_max", [])
    precip = daily.get("precipitation_sum", [])
    rain = daily.get("rain_sum", [])
    snow = daily.get("snowfall_sum", [])
    wind = daily.get("wind_speed_10m_max", [])
    humidity = daily.get("relative_humidity_2m_mean", [])

    # Group by year
    yearly: dict[int, dict[str, list]] = {}
    for i, t in enumerate(times):
        year = int(t[:4])
        if year not in yearly:
            yearly[year] = {"temp_mean": [], "temp_max": [], "precip": [], "rain": [], "snow": [], "wind": [], "humidity": []}
        if i < len(temp_mean) and temp_mean[i] is not None:
            yearly[year]["temp_mean"].append(temp_mean[i])
        if i < len(temp_max) and temp_max[i] is not None:
            yearly[year]["temp_max"].append(temp_max[i])
        if i < len(precip) and precip[i] is not None:
            yearly[year]["precip"].append(precip[i])
        if i < len(rain) and rain[i] is not None:
            yearly[year]["rain"].append(rain[i])
        if i < len(snow) and snow[i] is not None:
            yearly[year]["snow"].append(snow[i])
        if i < len(wind) and wind[i] is not None:
            yearly[year]["wind"].append(wind[i])
        if i < len(humidity) and humidity[i] is not None:
            yearly[year]["humidity"].append(humidity[i])

    def _safe_avg(vals: list) -> float | None:
        return round(sum(vals) / len(vals), 2) if vals else None

    def _safe_sum(vals: list) -> float | None:
        return round(sum(vals), 1) if vals else None

    yearly_summary = {}
    for year, data in sorted(yearly.items()):
        yearly_summary[year] = {
            "avg_temp_c": _safe_avg(data["temp_mean"]),
            "max_temp_c": round(max(data["temp_max"]), 1) if data["temp_max"] else None,
            "total_precip_mm": _safe_sum(data["precip"]),
            "total_rain_mm": _safe_sum(data["rain"]),
            "total_snow_cm": _safe_sum(data["snow"]),
            "avg_wind_max_kmh": _safe_avg(data["wind"]),
            "avg_humidity_pct": _safe_avg(data["humidity"]),
        }

    years = sorted(yearly_summary.keys())
    first_year = years[0] if years else None
    last_year = years[-1] if years else None

    summary: dict[str, Any] = {
        "projection_range": f"{first_year}-{last_year}",
        "model": climate_data.get("model", "EC_Earth3P_HR"),
    }

    if first_year and last_year and first_year in yearly_summary and last_year in yearly_summary:
        first = yearly_summary[first_year]
        last = yearly_summary[last_year]
        if first["avg_temp_c"] is not None and last["avg_temp_c"] is not None:
            summary["temp_change_c"] = round(last["avg_temp_c"] - first["avg_temp_c"], 2)
        if first["total_precip_mm"] is not None and last["total_precip_mm"] is not None:
            summary["precip_change_mm"] = round(last["total_precip_mm"] - first["total_precip_mm"], 1)
        if first["total_snow_cm"] is not None and last["total_snow_cm"] is not None:
            summary["snow_change_cm"] = round(last["total_snow_cm"] - first["total_snow_cm"], 1)

    # Include a few sample years to show the trend without sending thousands of data points
    sample_years = [years[0], years[len(years) // 4], years[len(years) // 2], years[3 * len(years) // 4], years[-1]] if len(years) >= 5 else years
    summary["sample_years"] = {y: yearly_summary[y] for y in sample_years}

    return summary


def _build_user_message(
    latitude: float,
    longitude: float,
    summary: dict[str, Any],
    panel_area: float,
    panel_efficiency: float,
    panel_tilt: float,
    climate_summary: dict[str, Any] | None = None,
) -> str:
    msg = (
        f"Location: latitude={latitude}, longitude={longitude}\n"
        f"Panel area: {panel_area} m²\n"
        f"Panel efficiency: {panel_efficiency * 100:.1f}%\n"
        f"Panel tilt: {panel_tilt}°\n"
        f"\nSolar efficiency summary:\n{json.dumps(summary, indent=2)}"
    )

    if climate_summary:
        msg += f"\n\nClimate change projections (IPCC model):\n{json.dumps(climate_summary, indent=2)}"

    return msg


async def generate_signals(
    latitude: float,
    longitude: float,
    summary: dict[str, Any],
    panel_area: float = 50.0,
    panel_efficiency: float = 0.20,
    panel_tilt: float = 30.0,
    climate_data: dict[str, Any] | None = None,
    model: str = "gpt-4o-mini",
) -> list[Signal]:
    """
    Call OpenAI to generate an array of solar advisory signals
    based on efficiency data, location, and climate projections.

    Returns a list of Signal objects with type (info/warning/tip),
    title, and content.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set")

    climate_summary = _summarise_climate_data(climate_data) if climate_data else None

    user_message = _build_user_message(
        latitude, longitude, summary, panel_area, panel_efficiency, panel_tilt, climate_summary
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.7,
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            OPENAI_API_URL,
            json=payload,
            headers=headers,
            timeout=30.0,
        )
        response.raise_for_status()
        data = response.json()

    raw_content = data["choices"][0]["message"]["content"]
    parsed = json.loads(raw_content)

    # The model may return {"signals": [...]} or just [...]
    if isinstance(parsed, list):
        items = parsed
    elif isinstance(parsed, dict):
        # Try common wrapper keys
        items = parsed.get("signals", parsed.get("data", parsed.get("results", [])))
    else:
        items = []

    signals: list[Signal] = []
    valid_types = {t.value for t in SignalType}

    for item in items:
        signal_type = item.get("type", "").lower()
        is_climate = signal_type == "climate"

        # Map "climate" to "info" for the enum, flag it separately
        if is_climate:
            signal_type = "info"
        elif signal_type not in valid_types:
            signal_type = "info"

        signals.append(
            Signal(
                type=SignalType(signal_type),
                title=item.get("title", ""),
                content=item.get("content", ""),
                climate=is_climate,
            )
        )

    return signals

