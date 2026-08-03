"""
Async service that fetches a terrain elevation grid around a location and
computes a shading factor using Monte-Carlo shadow analysis.

The shading factor is a float 0–1:
  1.0 = no terrain shading (flat or exposed)
  0.0 = fully shadowed by surrounding terrain
"""

import logging
import math

import numpy as np

from calculations.shadow_map import monte_carlo_shadow_approx
from services.http_client import fetch_with_retry

logger = logging.getLogger(__name__)

# Open-Meteo Elevation API (Copernicus DEM 90 m, free – no customer endpoint exists)
ELEVATION_API_URL = "https://api.open-meteo.com/v1/elevation"

# Grid configuration
# ~90 m cell size at equator; 21×21 ≈ 1.9 km × 1.9 km coverage
GRID_SIZE = 21               # cells per side (odd so midpoint sits on centre cell)
CELL_SIZE_DEG = 0.001        # ~111 m per 0.001° latitude
MONTE_CARLO_N = 200          # iterations – good accuracy vs speed trade-off
BATCH_SIZE = 100             # Open-Meteo accepts up to 100 coords per request

# Earth constants
METRES_PER_DEGREE_LAT = 111_320.0  # metres per degree of latitude

# Theoretical average brightness for perfectly flat terrain with uniform
# random sun azimuth [0,360) and altitude [0,90).
# The dot product of an upward normal (0,0,1) with the light vector gives
# sin(altitude).  E[sin(U)] for U ~ Uniform(0, π/2) = 2/π ≈ 0.6366.
FLAT_TERRAIN_BASELINE = 2.0 / math.pi


def _cell_size_metres(latitude: float, cell_size_deg: float = CELL_SIZE_DEG) -> float:
    """
    Approximate the horizontal distance (in metres) between grid cells.
    Averages the latitude and longitude directions.
    At higher latitudes, longitude degrees shrink by cos(lat).
    """
    lat_m = cell_size_deg * METRES_PER_DEGREE_LAT
    lon_m = cell_size_deg * METRES_PER_DEGREE_LAT * math.cos(math.radians(latitude))
    return (lat_m + lon_m) / 2.0


async def _fetch_elevation_grid(
    lat_center: float,
    lon_center: float,
    grid_size: int = GRID_SIZE,
    cell_size_deg: float = CELL_SIZE_DEG,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Fetch a square elevation grid centred on (lat_center, lon_center).

    Returns:
        lats_1d: 1D array of latitudes  (north → south)
        lons_1d: 1D array of longitudes (west → east)
        Z:       2D elevation array, shape (grid_size, grid_size)
    """
    half = grid_size // 2
    lats_1d = np.array([lat_center + (half - i) * cell_size_deg for i in range(grid_size)])
    lons_1d = np.array([lon_center + (j - half) * cell_size_deg for j in range(grid_size)])

    # Flatten to list of (lat, lon)
    lats_flat = []
    lons_flat = []
    for i in range(grid_size):
        for j in range(grid_size):
            lats_flat.append(float(lats_1d[i]))
            lons_flat.append(float(lons_1d[j]))

    # Fetch in batches of BATCH_SIZE
    z_flat: list[float] = []
    total = len(lats_flat)
    for start in range(0, total, BATCH_SIZE):
        end = min(start + BATCH_SIZE, total)
        params = {
            "latitude": ",".join(f"{lats_flat[k]:.6f}" for k in range(start, end)),
            "longitude": ",".join(f"{lons_flat[k]:.6f}" for k in range(start, end)),
        }
        data = await fetch_with_retry(ELEVATION_API_URL, params=params, timeout=30.0)
        z_flat.extend(data["elevation"])

    Z = np.array(z_flat, dtype=float).reshape(grid_size, grid_size)
    return lats_1d, lons_1d, Z


async def calculate_shading_factor(
    latitude: float,
    longitude: float,
    grid_size: int = GRID_SIZE,
    cell_size_deg: float = CELL_SIZE_DEG,
    monte_carlo_n: int = MONTE_CARLO_N,
) -> float:
    """
    Compute a terrain-based shading factor for a single location.

    Steps:
      1. Fetch a DEM (elevation grid) centred on the location.
      2. Run Monte-Carlo shadow analysis across many random sun angles.
      3. Return the shadow-map value at the centre cell (0–1).

    Returns:
        float 0–1.  1.0 = fully exposed, 0.0 = fully shadowed.
    """
    try:
        _lats, _lons, dem = await _fetch_elevation_grid(
            latitude, longitude, grid_size, cell_size_deg,
        )
    except Exception:
        logger.exception(
            "Failed to fetch elevation grid for (%.4f, %.4f); defaulting shading_factor=1.0",
            latitude, longitude,
        )
        return 1.0  # graceful fallback: assume no shading

    # Flat terrain → no shading, skip the Monte-Carlo work
    if dem.max() - dem.min() < 1.0:
        logger.debug("Terrain is flat (Δ < 1 m); shading_factor = 1.0")
        return 1.0

    # Compute real cell size in metres for this latitude
    cell_m = _cell_size_metres(latitude, cell_size_deg)

    shadow_map = monte_carlo_shadow_approx(dem, n=monte_carlo_n, cell_size_m=cell_m)

    # Centre cell index
    mid = grid_size // 2
    raw = float(shadow_map[mid, mid])

    # Normalise against flat-terrain baseline so the factor represents
    # *only* terrain shading, not the general low-sun-angle brightness drop
    # (which is already captured by irradiance data).
    factor = raw / FLAT_TERRAIN_BASELINE if FLAT_TERRAIN_BASELINE > 0 else raw

    # Clamp to [0, 1]
    factor = max(0.0, min(1.0, factor))

    logger.info(
        "Shading factor for (%.4f, %.4f): %.4f  (raw %.4f, baseline %.4f, elev range %.1f m, cell %.1f m)",
        latitude, longitude, factor, raw, FLAT_TERRAIN_BASELINE,
        float(dem.max() - dem.min()), cell_m,
    )
    return factor
