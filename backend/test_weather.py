"""
Test script for weather service functions.
Run with: python test_weather.py
"""

import asyncio
import json
from datetime import date

from services.weather import (
    decode_weather_code,
    get_climate_change_data,
    get_current_day_forecast,
    get_monthly_weather,
    get_yearly_weather,
)

LATITUDE = 52.52
LONGITUDE = 13.405
LOCATION_NAME = "Berlin, Germany"


async def test_monthly_weather():
    print(f"\n{'='*60}")
    print(f"MONTHLY WEATHER DATA - {LOCATION_NAME}")
    print(f"{'='*60}")

    today = date.today()
    data = await get_monthly_weather(LATITUDE, LONGITUDE, today.year, today.month)

    print(f"\nMonth: {today.strftime('%B %Y')}")
    print(f"Timezone: {data.get('timezone', 'N/A')}")
    print(f"\nDaily Data:")
    print("-" * 60)

    daily = data.get("daily", {})
    dates = daily.get("time", [])
    temp_max = daily.get("temperature_2m_max", [])
    temp_min = daily.get("temperature_2m_min", [])
    temp_mean = daily.get("temperature_2m_mean", [])
    humidity = daily.get("relative_humidity_2m_mean", [])
    weather_codes = daily.get("weather_code", [])

    for i, d in enumerate(dates[:10]):
        weather = decode_weather_code(weather_codes[i] if i < len(weather_codes) else None)
        print(
            f"  {d}: "
            f"Temp {temp_min[i] if i < len(temp_min) else 'N/A'}°C - {temp_max[i] if i < len(temp_max) else 'N/A'}°C "
            f"(avg: {temp_mean[i] if i < len(temp_mean) else 'N/A'}°C), "
            f"Humidity: {humidity[i] if i < len(humidity) else 'N/A'}%, "
            f"{weather}"
        )

    if len(dates) > 10:
        print(f"  ... and {len(dates) - 10} more days")

    return data


async def test_current_day_forecast():
    print(f"\n{'='*60}")
    print(f"TODAY'S FORECAST - {LOCATION_NAME}")
    print(f"{'='*60}")

    data = await get_current_day_forecast(LATITUDE, LONGITUDE)

    current = data.get("current", {})
    daily = data.get("daily", {})

    print(f"\nCurrent Conditions:")
    print("-" * 60)
    print(f"  Temperature: {current.get('temperature_2m', 'N/A')}°C")
    print(f"  Humidity: {current.get('relative_humidity_2m', 'N/A')}%")
    print(f"  Weather: {decode_weather_code(current.get('weather_code'))}")
    print(f"  Cloud Cover: {current.get('cloud_cover', 'N/A')}%")
    print(f"  Is Day: {'Yes' if current.get('is_day') else 'No'}")

    print(f"\nToday's Summary:")
    print("-" * 60)
    print(f"  High: {daily.get('temperature_2m_max', ['N/A'])[0]}°C")
    print(f"  Low: {daily.get('temperature_2m_min', ['N/A'])[0]}°C")
    print(f"  Feels Like: {daily.get('apparent_temperature_min', ['N/A'])[0]}°C - {daily.get('apparent_temperature_max', ['N/A'])[0]}°C")

    print(f"\nSun Data:")
    print("-" * 60)
    print(f"  Sunrise: {daily.get('sunrise', ['N/A'])[0]}")
    print(f"  Sunset: {daily.get('sunset', ['N/A'])[0]}")
    daylight = daily.get("daylight_duration", [0])[0]
    sunshine = daily.get("sunshine_duration", [0])[0]
    print(f"  Daylight Duration: {daylight / 3600:.1f} hours" if daylight else "  Daylight Duration: N/A")
    print(f"  Sunshine Duration: {sunshine / 3600:.1f} hours" if sunshine else "  Sunshine Duration: N/A")
    print(f"  UV Index Max: {daily.get('uv_index_max', ['N/A'])[0]}")

    return data


async def test_yearly_weather():
    print(f"\n{'='*60}")
    print(f"YEARLY WEATHER DATA - {LOCATION_NAME}")
    print(f"{'='*60}")

    today = date.today()
    data = await get_yearly_weather(LATITUDE, LONGITUDE, today.year)

    print(f"\nYear: {today.year}")
    print(f"Timezone: {data.get('timezone', 'N/A')}")

    daily = data.get("daily", {})
    dates = daily.get("time", [])
    temp_max = daily.get("temperature_2m_max", [])
    temp_min = daily.get("temperature_2m_min", [])
    temp_mean = daily.get("temperature_2m_mean", [])
    precip = daily.get("precipitation_sum", [])

    print(f"Total Days: {len(dates)}")
    print("-" * 60)

    if dates:
        print(f"\nFirst 5 days of {today.year}:")
        for i in range(min(5, len(dates))):
            print(
                f"  {dates[i]}: "
                f"Temp {temp_min[i] if i < len(temp_min) else 'N/A'}°C - {temp_max[i] if i < len(temp_max) else 'N/A'}°C, "
                f"Precip: {precip[i] if i < len(precip) else 'N/A'} mm"
            )

        print(f"\nLast 5 days available:")
        for i in range(max(0, len(dates) - 5), len(dates)):
            print(
                f"  {dates[i]}: "
                f"Temp {temp_min[i] if i < len(temp_min) else 'N/A'}°C - {temp_max[i] if i < len(temp_max) else 'N/A'}°C, "
                f"Precip: {precip[i] if i < len(precip) else 'N/A'} mm"
            )

        valid_temps = [t for t in temp_mean if t is not None]
        if valid_temps:
            print(f"\nYear Statistics (so far):")
            print(f"  Average Temperature: {sum(valid_temps) / len(valid_temps):.1f}°C")
            print(f"  Hottest Day: {max(temp_max):.1f}°C")
            print(f"  Coldest Day: {min(temp_min):.1f}°C")
            valid_precip = [p for p in precip if p is not None]
            if valid_precip:
                print(f"  Total Precipitation: {sum(valid_precip):.1f} mm")

    return data


async def test_climate_change():
    print(f"\n{'='*60}")
    print(f"CLIMATE CHANGE PROJECTIONS - {LOCATION_NAME}")
    print(f"{'='*60}")

    data = await get_climate_change_data(LATITUDE, LONGITUDE, start_year=2025, end_year=2030)

    daily = data.get("daily", {})
    dates = daily.get("time", [])
    temp_mean = daily.get("temperature_2m_mean", [])
    precip = daily.get("precipitation_sum", [])

    print(f"\nModel: {data.get('model', 'N/A')}")
    print(f"Data Points: {len(dates)} days")
    print("-" * 60)

    if dates:
        print(f"\nFirst 5 days of data:")
        for i in range(min(5, len(dates))):
            print(
                f"  {dates[i]}: "
                f"Temp: {temp_mean[i] if i < len(temp_mean) else 'N/A'}°C, "
                f"Precipitation: {precip[i] if i < len(precip) else 'N/A'} mm"
            )

        print(f"\nLast 5 days of data:")
        for i in range(max(0, len(dates) - 5), len(dates)):
            print(
                f"  {dates[i]}: "
                f"Temp: {temp_mean[i] if i < len(temp_mean) else 'N/A'}°C, "
                f"Precipitation: {precip[i] if i < len(precip) else 'N/A'} mm"
            )

    return data


async def main():
    print(f"\n{'#'*60}")
    print(f"# WEATHER SERVICE TEST")
    print(f"# Location: {LOCATION_NAME} ({LATITUDE}, {LONGITUDE})")
    print(f"# Date: {date.today()}")
    print(f"{'#'*60}")

    try:
        monthly_data = await test_monthly_weather()
        yearly_data = await test_yearly_weather()
        today_data = await test_current_day_forecast()
        climate_data = await test_climate_change()

        print(f"\n{'='*60}")
        print("ALL TESTS COMPLETED SUCCESSFULLY")
        print(f"{'='*60}")

        save_raw = input("\nSave raw JSON data to files? (y/n): ").strip().lower()
        if save_raw == "y":
            with open("monthly_weather.json", "w") as f:
                json.dump(monthly_data, f, indent=2)
            with open("yearly_weather.json", "w") as f:
                json.dump(yearly_data, f, indent=2)
            with open("today_forecast.json", "w") as f:
                json.dump(today_data, f, indent=2)
            with open("climate_data.json", "w") as f:
                json.dump(climate_data, f, indent=2)
            print("Data saved to monthly_weather.json, yearly_weather.json, today_forecast.json, climate_data.json")

    except Exception as e:
        print(f"\nERROR: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
