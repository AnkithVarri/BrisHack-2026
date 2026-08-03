"""
Test script for solar polygon endpoints.

Runs requests against:
- POST /solar/polygon-efficiency
- POST /solar/polygon-yearly

Usage:
  python test_solar_endpoints.py
  python test_solar_endpoints.py --base-url http://localhost:8000 --year 2026 --save
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import httpx


# Sample polygon around Berlin (lat/lon)
DEFAULT_POLYGON_POINTS = [
    {"latitude": 52.5202, "longitude": 13.4049},
    {"latitude": 52.5206, "longitude": 13.4068},
    {"latitude": 52.5190, "longitude": 13.4063},
    {"latitude": 52.5193, "longitude": 13.4046},
]


def build_payload() -> dict:
    return {
        "points": DEFAULT_POLYGON_POINTS,
        "panel_efficiency": 0.20,
        "panel_area": 50.0,
        "panel_tilt": 30.0,
    }


def print_endpoint_header(title: str) -> None:
    print(f"\n{'=' * 72}")
    print(title)
    print(f"{'=' * 72}")


def assert_polygon_efficiency_shape(data: dict) -> None:
    required_top_level = {"midpoint", "date", "hourly_data", "summary"}
    missing = required_top_level - set(data.keys())
    if missing:
        raise AssertionError(f"/solar/polygon-efficiency missing fields: {sorted(missing)}")

    if not isinstance(data["hourly_data"], list) or not data["hourly_data"]:
        raise AssertionError("/solar/polygon-efficiency returned empty hourly_data")

    summary = data["summary"]
    required_summary = {
        "average_efficiency_24h",
        "average_efficiency_daylight",
        "peak_efficiency",
        "peak_hour",
        "total_daylight_hours",
        "total_energy_kwh",
        "peak_power_kw",
        "panel_area_m2",
        "panel_efficiency_percent",
    }
    missing_summary = required_summary - set(summary.keys())
    if missing_summary:
        raise AssertionError(
            f"/solar/polygon-efficiency summary missing fields: {sorted(missing_summary)}"
        )


def assert_polygon_yearly_shape(data: dict) -> None:
    required_top_level = {"midpoint", "year", "monthly_data", "summary"}
    missing = required_top_level - set(data.keys())
    if missing:
        raise AssertionError(f"/solar/polygon-yearly missing fields: {sorted(missing)}")

    if not isinstance(data["monthly_data"], list) or not data["monthly_data"]:
        raise AssertionError("/solar/polygon-yearly returned empty monthly_data")

    summary = data["summary"]
    required_summary = {
        "year",
        "total_energy_kwh",
        "average_efficiency_score",
        "best_month",
        "worst_month",
        "panel_area_m2",
        "panel_efficiency_percent",
    }
    missing_summary = required_summary - set(summary.keys())
    if missing_summary:
        raise AssertionError(
            f"/solar/polygon-yearly summary missing fields: {sorted(missing_summary)}"
        )


def call_polygon_efficiency(client: httpx.Client, payload: dict) -> dict:
    print_endpoint_header("TEST: POST /solar/polygon-efficiency")
    response = client.post("/solar/polygon-efficiency", json=payload, timeout=60)
    print(f"Status: {response.status_code}")

    if response.status_code != 200:
        raise AssertionError(f"/solar/polygon-efficiency failed: {response.text}")

    data = response.json()
    assert_polygon_efficiency_shape(data)

    print(f"Date: {data['date']}")
    print(f"Midpoint: {data['midpoint']}")
    print(f"Hourly rows: {len(data['hourly_data'])}")
    print(
        "Total energy (kWh): "
        f"{data['summary'].get('total_energy_kwh', 'N/A')}"
    )
    return data


def call_polygon_yearly(client: httpx.Client, payload: dict, year: int | None) -> dict:
    print_endpoint_header("TEST: POST /solar/polygon-yearly")

    params = {}
    if year is not None:
        params["year"] = year

    response = client.post("/solar/polygon-yearly", json=payload, params=params, timeout=120)
    print(f"Status: {response.status_code}")

    if response.status_code != 200:
        raise AssertionError(f"/solar/polygon-yearly failed: {response.text}")

    data = response.json()
    assert_polygon_yearly_shape(data)

    print(f"Year: {data['year']}")
    print(f"Midpoint: {data['midpoint']}")
    print(f"Monthly rows: {len(data['monthly_data'])}")
    print(
        "Total yearly energy (kWh): "
        f"{data['summary'].get('total_energy_kwh', 'N/A')}"
    )
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Test solar polygon API endpoints.")
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8000",
        help="Base URL for the running FastAPI server (default: %(default)s)",
    )
    parser.add_argument(
        "--year",
        type=int,
        default=date.today().year,
        help="Year for /solar/polygon-yearly (default: current year)",
    )
    parser.add_argument(
        "--save",
        action="store_true",
        help="Save full endpoint responses to JSON files.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = build_payload()

    print(f"\nUsing API base URL: {args.base_url}")
    print(f"Testing polygon with {len(payload['points'])} points")

    try:
        with httpx.Client(base_url=args.base_url) as client:
            efficiency_data = call_polygon_efficiency(client, payload)
            yearly_data = call_polygon_yearly(client, payload, args.year)
    except httpx.ConnectError as exc:
        raise SystemExit(
            f"Could not connect to {args.base_url}. Start the API first, then retry.\n{exc}"
        ) from exc

    if args.save:
        efficiency_path = Path("polygon_efficiency_response.json")
        yearly_path = Path("polygon_yearly_response.json")

        efficiency_path.write_text(json.dumps(efficiency_data, indent=2), encoding="utf-8")
        yearly_path.write_text(json.dumps(yearly_data, indent=2), encoding="utf-8")
        print(f"\nSaved: {efficiency_path}")
        print(f"Saved: {yearly_path}")

    print(f"\n{'=' * 72}")
    print("ALL SOLAR ENDPOINT TESTS PASSED")
    print(f"{'=' * 72}")


if __name__ == "__main__":
    main()

