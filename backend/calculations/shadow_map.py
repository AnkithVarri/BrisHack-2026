import numpy as np
import scipy.signal


def shadow_mask(
    dem: np.ndarray,
    az: float,
    al: float,
    cell_size_m: float = 111.0,
) -> np.ndarray:
    """
    Given a DEM (2D elevation grid in metres), sun azimuth (radians) and
    altitude (radians), return a boolean mask where True = shadowed.

    cell_size_m: horizontal distance between grid cells in metres.
                 Must match the DEM's resolution so the sun-ray geometry
                 is correct.
    """
    max_dist = 10  # how far (in cells) a ridge can cast a shadow
    shadowed = np.zeros_like(dem, dtype=bool)
    for d in range(1, max_dist):
        shift_x = int(round(d * np.sin(az)))
        shift_y = int(round(d * np.cos(az)))
        neighbour_height = np.roll(np.roll(dem, shift_y, axis=0), shift_x, axis=1)
        # Horizontal distance in metres, then how far the ray drops
        ray_height = neighbour_height - (d * cell_size_m) * np.tan(al)
        shadowed |= ray_height > dem
    return shadowed


def monte_carlo_shadow_approx(
    terrain_data: np.ndarray,
    n: int = 200,
    cell_size_m: float = 111.0,
) -> np.ndarray:
    """
    Monte Carlo approximation of terrain shading.

    For N random sun positions, compute surface brightness (dot product of
    surface normal with light direction) and zero out cells shadowed by
    neighbouring terrain.

    Args:
        terrain_data: 2D elevation array (metres).
        n: Number of random sun positions to sample.
        cell_size_m: Horizontal distance between grid cells in metres.
                     This is critical — the Sobel gradients produce
                     dz/d_cell; we need dz/d_metre for correct slopes.

    Returns:
        2D array (same shape as terrain_data) with values 0–1.
        1 = fully lit on average, 0 = always shadowed.
    """
    sobel = np.array([[-1, 0, 1],
                      [-2, 0, 2],
                      [-1, 0, 1]])

    # Sobel gives gradient in elevation-units per cell.
    # Divide by cell_size_m to get gradient in m/m (dimensionless slope).
    dX = scipy.signal.convolve2d(terrain_data, sobel, mode='same', boundary='symm') / cell_size_m
    dY = scipy.signal.convolve2d(terrain_data, sobel.T, mode='same', boundary='symm') / cell_size_m

    # Surface normal: (-dX, -dY, 1)  normalised
    length = np.sqrt(dX**2 + dY**2 + 1.0)
    norm_x = dX / length
    norm_y = dY / length
    norm_z = 1.0 / length

    shadow_map = np.zeros_like(terrain_data, dtype=np.float64)

    # Fixed seed derived from terrain so the same DEM always gives the same result
    rng = np.random.default_rng(seed=int(abs(terrain_data.sum()) * 1000) % (2**31))

    for _ in range(n):
        azimuth = rng.uniform(0, 360)
        altitude = rng.uniform(0, 90)

        az = np.radians(azimuth)
        al = np.radians(altitude)

        light_v = np.array([
            np.cos(al) * np.sin(az),
            np.cos(al) * np.cos(az),
            np.sin(al),
        ])
        light = light_v / np.linalg.norm(light_v)

        brightness = (norm_x * light[0]) + (norm_y * light[1]) + (norm_z * light[2])
        brightness = brightness.clip(0, 1)

        mask = shadow_mask(terrain_data, az, al, cell_size_m)
        brightness[mask] = 0

        shadow_map += brightness

    shadow_map /= n
    return shadow_map
