from datetime import date, timedelta
from typing import Any

from services.http_client import fetch_with_retry

# Public Open-Meteo endpoints. The customer-* hosts require a paid API key.
FORECAST_API_URL = "https://api.open-meteo.com/v1/forecast"
HISTORICAL_API_URL = "https://archive-api.open-meteo.com/v1/archive"
CLIMATE_API_URL = "https://climate-api.open-meteo.com/v1/climate"


async def get_monthly_weather(
    latitude: float,
    longitude: float,
    year: int,
    month: int,
) -> dict[str, Any]:
    """
    Fetch weather, temperature, and humidity for every day of a given month.
    Uses the Historical Weather API for past data or Forecast API for current/future.
    """
    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(year, month + 1, 1) - timedelta(days=1)

    today = date.today()

    daily_params = [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "temperature_2m_mean",
        "relative_humidity_2m_mean",
        "relative_humidity_2m_max",
        "relative_humidity_2m_min",
    ]

    if end_date < today:
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "daily": daily_params,
            "timezone": "auto",
        }
        api_url = HISTORICAL_API_URL
    else:
        past_days = (today - start_date).days if start_date < today else 0
        forecast_days = (end_date - today).days + 1
        forecast_days = min(forecast_days, 16)

        params = {
            "latitude": latitude,
            "longitude": longitude,
            "daily": daily_params,
            "timezone": "auto",
            "past_days": past_days,
            "forecast_days": forecast_days,
        }
        api_url = FORECAST_API_URL

    return await fetch_with_retry(api_url, params=params, timeout=30.0)


async def get_yearly_weather(
    latitude: float,
    longitude: float,
    year: int,
) -> dict[str, Any]:
    """
    Fetch weather, temperature, and humidity for every day of a given year.
    Uses Historical API for past data and Forecast API for current/future dates.
    """
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)
    today = date.today()

    daily_params = [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "temperature_2m_mean",
        "relative_humidity_2m_mean",
        "relative_humidity_2m_max",
        "relative_humidity_2m_min",
        "precipitation_sum",
    ]

    results: dict[str, Any] = {
        "latitude": latitude,
        "longitude": longitude,
        "year": year,
        "daily": {
            "time": [],
            "weather_code": [],
            "temperature_2m_max": [],
            "temperature_2m_min": [],
            "temperature_2m_mean": [],
            "relative_humidity_2m_mean": [],
            "relative_humidity_2m_max": [],
            "relative_humidity_2m_min": [],
            "precipitation_sum": [],
        },
    }

    if end_date < today:
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "daily": daily_params,
            "timezone": "auto",
        }
        data = await fetch_with_retry(HISTORICAL_API_URL, params=params, timeout=60.0)
        results["timezone"] = data.get("timezone")
        results["daily"] = data.get("daily", {})
    else:
        historical_end = today - timedelta(days=1)
        if start_date <= historical_end:
            params = {
                "latitude": latitude,
                "longitude": longitude,
                "start_date": start_date.isoformat(),
                "end_date": historical_end.isoformat(),
                "daily": daily_params,
                "timezone": "auto",
            }
            hist_data = await fetch_with_retry(HISTORICAL_API_URL, params=params, timeout=60.0)
            results["timezone"] = hist_data.get("timezone")
            for key in results["daily"]:
                results["daily"][key].extend(hist_data.get("daily", {}).get(key, []))

        days_remaining = (end_date - today).days + 1
        forecast_days = min(days_remaining, 16)

        if forecast_days > 0:
            params = {
                "latitude": latitude,
                "longitude": longitude,
                "daily": daily_params,
                "timezone": "auto",
                "forecast_days": forecast_days,
            }
            forecast_data = await fetch_with_retry(FORECAST_API_URL, params=params, timeout=30.0)
            if "timezone" not in results:
                results["timezone"] = forecast_data.get("timezone")
            for key in results["daily"]:
                results["daily"][key].extend(forecast_data.get("daily", {}).get(key, []))

    return results


async def get_current_day_forecast(
    latitude: float,
    longitude: float,
) -> dict[str, Any]:
    """
    Fetch predicted temperature, weather, and sun data for the current day.
    """
    today = date.today()

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": [
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "apparent_temperature_max",
            "apparent_temperature_min",
            "sunrise",
            "sunset",
            "daylight_duration",
            "sunshine_duration",
            "uv_index_max",
        ],
        "hourly": [
            "temperature_2m",
            "relative_humidity_2m",
            "weather_code",
            "cloud_cover",
            "direct_radiation",
        ],
        "current": [
            "temperature_2m",
            "relative_humidity_2m",
            "weather_code",
            "cloud_cover",
            "is_day",
        ],
        "timezone": "auto",
        "forecast_days": 1,
    }

    return await fetch_with_retry(FORECAST_API_URL, params=params, timeout=30.0)


async def get_climate_change_data(
    latitude: float,
    longitude: float,
    start_year: int = 2024,
    end_year: int = 2050,
) -> dict[str, Any]:
    """
    Fetch climate change predictions from IPCC downscaled models.
    Provides daily resolution climate projections.
    """
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": f"{start_year}-01-01",
        "end_date": f"{end_year}-12-31",
        "daily": [
            "temperature_2m_max",
            "temperature_2m_min",
            "temperature_2m_mean",
            "precipitation_sum",
            "rain_sum",
            "snowfall_sum",
            "wind_speed_10m_max",
            "relative_humidity_2m_max",
            "relative_humidity_2m_min",
            "relative_humidity_2m_mean",
        ],
        "models": "EC_Earth3P_HR",
    }

    return await fetch_with_retry(CLIMATE_API_URL, params=params, timeout=60.0)


WEATHER_CODE_DESCRIPTIONS = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def decode_weather_code(code: int | None) -> str:
    """Convert weather code to human-readable description."""
    if code is None:
        return "Unknown"
    return WEATHER_CODE_DESCRIPTIONS.get(code, f"Unknown ({code})")
