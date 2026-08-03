from datetime import date

from services.http_client import fetch_with_retry

NASA_POWER_API_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"


async def fetch_albedo(latitude: float, longitude: float) -> float:
    """
    Fetch the surface albedo for a location from NASA POWER.
    Returns the annual average albedo (0-1 scale).
    Falls back to 0.2 (grass) if the request fails.
    """
    current_year = date.today().year
    # NASA POWER needs a full year range; use last complete year for reliable data
    year = current_year - 1

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "start": year,
        "end": year,
        "community": "RE",
        "parameters": "ALLSKY_SRF_ALB",
        "format": "JSON",
    }

    try:
        data = await fetch_with_retry(
            NASA_POWER_API_URL,
            params=params,
            timeout=15.0,
        )

        monthly_values = data["properties"]["parameter"]["ALLSKY_SRF_ALB"]

        # Monthly values are keyed like "202401", "202402", ... "202413" (13 = annual avg)
        annual_key = f"{year}13"
        if annual_key in monthly_values:
            albedo = monthly_values[annual_key]
            if albedo and albedo > 0:
                return round(albedo, 3)

        # Fall back to averaging the 12 monthly values
        valid_values = [
            v for k, v in monthly_values.items()
            if v is not None and v > 0 and not k.endswith("13")
        ]
        if valid_values:
            return round(sum(valid_values) / len(valid_values), 3)

    except Exception:
        pass

    # Default fallback
    return 0.2

