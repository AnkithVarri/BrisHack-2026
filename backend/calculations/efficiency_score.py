import math
from dataclasses import dataclass
from enum import Enum

class AdditionalFactors(Enum):
    POINTS_PENALTY = ("Points Penalty", 0.02) # Accounts for polygons with excessive points meaning more wasted space
    SPACING_FACTOR = ("Spacing Factor", 0.02) # Accounts for spacing between panels

    def __init__(self, label: str, weight: float):
        self.label = label
        self.weight = weight

class CalculationFactors(Enum):
    """Solar efficiency factors with their default weights."""

    SOLAR_RESOURCE = ("Solar Resource", 0.45) # Done 
    SHADING_IMPACT = ("Shading Impact", 0.13) 
    SYSTEM_EFFICIENCY = ("System Efficiency", 0.16)
    WEATHER_RELIABILITY = ("Weather Reliability", 0.16) # Done
    AREA_SUITABILITY = ("Area Suitability", 0.1) # Done

    def __init__(self, label: str, weight: float):
        self.label = label
        self.weight = weight

    @classmethod
    def total_weight(cls) -> float:
        return sum(factor.weight for factor in cls)

@dataclass
class SolarResourceData:
    ghi: float # Total solar radiation on a flat service
    dni: float # Solar radiation directly from the sun
    dhi: float # Solar radiation scattered by the atmosphere
    ambient_temperature: float # Ambient temperature
    angle_of_incidence: float # Angle of incidence of the sun on the panel

@dataclass
class WeatherData:
    cloud_cover: float # Cloud cover (0-100)

@dataclass
class PanelData:
    efficiency: float # Panel efficiency
    area: float # Panel area
    tilt: float # Panel tilt (degrees)
    points_array: list[list[float]] # Array of points on the panel


MAX_EXPECTED_IRRADIANCE = 1000.0  # W/m² under ideal conditions
NOCT = 45.0 # Nominal Operating Cell Temperature (avg according to google)


def estimate_angle_of_incidence(
    hour: int,
    latitude: float,
    day_of_year: int,
    panel_tilt: float = 0.0,
    panel_azimuth: float | None = None,
) -> float:
    """
    Estimate the angle of incidence of sunlight on a tilted panel surface
    using pvlib's analytical solar position and AOI functions.

    Args:
        hour: Hour of day (0–23).
        latitude: Site latitude in degrees.
        day_of_year: Day of year (1–365).
        panel_tilt: Panel tilt from horizontal in degrees (e.g. 30).
        panel_azimuth: Panel compass bearing in degrees (180 = south-facing).
                       Defaults to 180° in northern hemisphere, 0° in southern.

    Returns:
        Angle of incidence in degrees (0 = sun perpendicular to panel).
    """
    from pvlib.irradiance import aoi as pvlib_aoi
    from pvlib.solarposition import (
        declination_cooper69,
        solar_azimuth_analytical,
        solar_zenith_analytical,
    )

    if panel_azimuth is None:
        panel_azimuth = 180.0 if latitude >= 0 else 0.0

    # All pvlib analytical functions work in radians
    lat_rad = math.radians(latitude)
    hour_angle_rad = math.radians(15 * (hour - 12))
    decl_rad = declination_cooper69(day_of_year)  # returns radians

    zenith_rad = solar_zenith_analytical(lat_rad, hour_angle_rad, decl_rad)
    azimuth_rad = solar_azimuth_analytical(lat_rad, hour_angle_rad, decl_rad, zenith_rad)

    # pvlib.irradiance.aoi expects degrees
    return float(pvlib_aoi(
        panel_tilt,
        panel_azimuth,
        math.degrees(zenith_rad),
        math.degrees(azimuth_rad),
    ))

def calculate_panel_energy(solar_resource: SolarResourceData, panel_data: PanelData, albedo: float = 0.2) -> float: # Returns irradiance in W/m²
    # Calculate POA to see how much energy is available on the panel
    angle_of_incidence_cos = max(0,math.cos(math.radians(solar_resource.angle_of_incidence)))
    cos_tilt = math.cos(math.radians(panel_data.tilt))

    s1 = angle_of_incidence_cos * solar_resource.dni
    s2 = solar_resource.dhi * ((1 + cos_tilt) / 2)
    s3 = solar_resource.ghi * albedo * ((1 - cos_tilt) / 2)
    print('Albedo: ', albedo)

    return s1 + s2 + s3

def calculate_cell_temperature(solar_resource: SolarResourceData, panel_data: PanelData, albedo: float = 0.2) -> float:
    s = calculate_panel_energy(solar_resource, panel_data, albedo)
    return solar_resource.ambient_temperature + ( (NOCT-20)/800) * s

def calculate_energy_efficiency_loss(solar_resource: SolarResourceData, panel_data: PanelData, albedo: float = 0.2) -> float:
    # https://www.pveducation.org/pvcdrom/modules-and-arrays/nominal-operating-cell-temperature#:~:text=Temperature%20increases%2C%20above%20ambient%20levels,conditions%20of%20the%20PV%20module.
    # above in cms^" be sure to factor that in
    # "
    cell_temp = calculate_cell_temperature(solar_resource, panel_data, albedo)
    print('Energy efficiency loss: ', 1 - (cell_temp - 25) * 0.004)
    print('Cell temperature: ', cell_temp)
    print('Ambient temperature: ', solar_resource.ambient_temperature)
    factor = 1 - (cell_temp - 25) * 0.004
    return max(0.0, min(1.05, factor))



def calculate_solar_resource_score(solar_resource_data: SolarResourceData, panel_data: PanelData, albedo: float = 0.2) -> float:
    panel_energy = calculate_panel_energy(solar_resource_data, panel_data, albedo)
    panel_energy_after_temp = panel_energy * calculate_energy_efficiency_loss(solar_resource_data, panel_data, albedo)
    return min(1.0, max(0.0, panel_energy_after_temp / MAX_EXPECTED_IRRADIANCE))

def calculate_weather_reliability_score(weather_data: WeatherData) -> float:
    # Returns score from 0 to 1
    return 1 - (weather_data.cloud_cover / 100)


def calculate_area_suitability_score(panel_data: PanelData) -> float:
    penalty = AdditionalFactors.POINTS_PENALTY.weight * max(0, len(panel_data.points_array) - 4)
    usable_area = panel_data.area * (1 - penalty)
    usable_area *= (1 - AdditionalFactors.SPACING_FACTOR.weight)
    return min(1.0, max(0.0, usable_area / panel_data.area))




@dataclass
class EfficiencyData:
    sunlight_level: float
    shading_level: float
    panel_efficiency: float
    weather_reliability: float
    area_suitability: float



def calculate_efficiency_score(efficiency_data: EfficiencyData) -> float:
    return (
        efficiency_data.sunlight_level * CalculationFactors.SOLAR_RESOURCE.weight +
        efficiency_data.shading_level * CalculationFactors.SHADING_IMPACT.weight +
        efficiency_data.panel_efficiency * CalculationFactors.SYSTEM_EFFICIENCY.weight +
        efficiency_data.weather_reliability * CalculationFactors.WEATHER_RELIABILITY.weight +
        efficiency_data.area_suitability * CalculationFactors.AREA_SUITABILITY.weight
    )