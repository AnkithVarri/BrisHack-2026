"""
Dump weather data to JSON files.
Run with: python dump_weather_data.py [latitude] [longitude]
Example: python dump_weather_data.py 52.52 13.405
"""

import asyncio
import json
import sys
from datetime import date
from pathlib import Path

from services.weather import (
    get_climate_change_data,
    get_current_day_forecast,
    get_monthly_weather,
    get_yearly_weather,
)

OUTPUT_DIR = Path("weather_data")

DEFAULT_LATITUDE = 52.52
DEFAULT_LONGITUDE = 13.405


async def dump_all_weather_data(latitude: float, longitude: float):
    OUTPUT_DIR.mkdir(exist_ok=True)
    
    today = date.today()
    timestamp = today.isoformat()
    
    print(f"Fetching weather data for ({latitude}, {longitude})...")
    print(f"Output directory: {OUTPUT_DIR.absolute()}\n")

    print("1/4 Fetching monthly weather data...")
    monthly_data = await get_monthly_weather(latitude, longitude, today.year, today.month)
    monthly_file = OUTPUT_DIR / f"monthly_{today.year}_{today.month:02d}.json"
    with open(monthly_file, "w") as f:
        json.dump(monthly_data, f, indent=2)
    print(f"     Saved to {monthly_file}")

    print("2/4 Fetching yearly weather data...")
    yearly_data = await get_yearly_weather(latitude, longitude, today.year)
    yearly_file = OUTPUT_DIR / f"yearly_{today.year}.json"
    with open(yearly_file, "w") as f:
        json.dump(yearly_data, f, indent=2)
    print(f"     Saved to {yearly_file}")

    print("3/4 Fetching today's forecast...")
    today_data = await get_current_day_forecast(latitude, longitude)
    today_file = OUTPUT_DIR / f"today_{timestamp}.json"
    with open(today_file, "w") as f:
        json.dump(today_data, f, indent=2)
    print(f"     Saved to {today_file}")

    print("4/4 Fetching climate change data (2025-2050)...")
    climate_data = await get_climate_change_data(latitude, longitude, 2025, 2050)
    climate_file = OUTPUT_DIR / "climate_2025_2050.json"
    with open(climate_file, "w") as f:
        json.dump(climate_data, f, indent=2)
    print(f"     Saved to {climate_file}")

    combined = {
        "metadata": {
            "latitude": latitude,
            "longitude": longitude,
            "fetched_at": timestamp,
        },
        "monthly": monthly_data,
        "yearly": yearly_data,
        "today": today_data,
        "climate": climate_data,
    }
    combined_file = OUTPUT_DIR / f"all_weather_{timestamp}.json"
    with open(combined_file, "w") as f:
        json.dump(combined, f, indent=2)
    print(f"\nCombined data saved to {combined_file}")

    print("\nDone!")
    return combined


def main():
    latitude = DEFAULT_LATITUDE
    longitude = DEFAULT_LONGITUDE

    if len(sys.argv) >= 3:
        try:
            latitude = float(sys.argv[1])
            longitude = float(sys.argv[2])
        except ValueError:
            print("Error: latitude and longitude must be numbers")
            print(f"Usage: python {sys.argv[0]} [latitude] [longitude]")
            sys.exit(1)

    print(f"Weather Data Dump")
    print(f"=" * 40)
    print(f"Location: {latitude}, {longitude}")
    print(f"Date: {date.today()}")
    print(f"=" * 40)

    asyncio.run(dump_all_weather_data(latitude, longitude))


if __name__ == "__main__":
    main()
