import asyncio
import logging
import math
import sys
from dataclasses import dataclass
from datetime import date, timedelta

from services.http_client import fetch_with_retry

logger = logging.getLogger(__name__)


LOCATIONS = {
    # Major cities
    "berlin": ("Berlin, Germany", 52.52, 13.405),
    "london": ("London, UK", 51.5074, -0.1278),
    "paris": ("Paris, France", 48.8566, 2.3522),
    "new_york": ("New York, USA", 40.7128, -74.0060),
    "los_angeles": ("Los Angeles, USA", 34.0522, -118.2437),
    "tokyo": ("Tokyo, Japan", 35.6762, 139.6503),
    "sydney": ("Sydney, Australia", -33.8688, 151.2093),
    "dubai": ("Dubai, UAE", 25.2048, 55.2708),
    "mumbai": ("Mumbai, India", 19.0760, 72.8777),
    "cape_town": ("Cape Town, South Africa", -33.9249, 18.4241),
    "madrid": ("Madrid, Spain", 40.4168, -3.7038),
    "rome": ("Rome, Italy", 41.9028, 12.4964),
    "amsterdam": ("Amsterdam, Netherlands", 52.3676, 4.9041),
    "stockholm": ("Stockholm, Sweden", 59.3293, 18.0686),
    "singapore": ("Singapore", 1.3521, 103.8198),
    "phoenix": ("Phoenix, USA", 33.4484, -112.0740),
    "cairo": ("Cairo, Egypt", 30.0444, 31.2357),
    "sao_paulo": ("São Paulo, Brazil", -23.5505, -46.6333),
    # Solar hotspots - best irradiance locations
    "atacama": ("Atacama Desert, Chile", -22.47, -68.93),
    "mojave": ("Mojave Desert, USA", 35.0110, -115.4734),
    "sahara": ("Sahara (Aswan), Egypt", 24.0889, 32.8998),
    "alice_springs": ("Alice Springs, Australia", -23.6980, 133.8807),
    "riyadh": ("Riyadh, Saudi Arabia", 24.7136, 46.6753),
    "las_vegas": ("Las Vegas, USA", 36.1699, -115.1398),
    "marrakech": ("Marrakech, Morocco", 31.6295, -7.9811),
}

from calculations.efficiency_score import (
    CalculationFactors,
    EfficiencyData,
    PanelData,
    SolarResourceData,
    WeatherData,
    calculate_area_suitability_score,
    calculate_cell_temperature,
    calculate_efficiency_score,
    calculate_energy_efficiency_loss,
    calculate_panel_energy,
    calculate_solar_resource_score,
    calculate_weather_reliability_score,
    estimate_angle_of_incidence,
)
from services.nasa_power import fetch_albedo

FORECAST_API_URL = "https://customer-api.open-meteo.com/v1/forecast"
ARCHIVE_API_URL = "https://customer-archive-api.open-meteo.com/v1/archive"
MAX_FALLBACK_YEARS = 5
FUTURE_FORECAST_WINDOW_DAYS = 16
PAST_FORECAST_WINDOW_DAYS = 92


def _safe_with_year(target_date: date, year: int) -> date:
    """
    Replace year while safely handling leap-day rollover.
    """
    try:
        return target_date.replace(year=year)
    except ValueError:
        # Map Feb 29 to Feb 28 for non-leap years.
        return date(year, 2, 28)


def _candidate_dates_for_sampling(target_date: date) -> list[date]:
    """
    Build candidate dates for daily sampling.
    For unsupported future dates, fall back to the same month/day in prior years.
    Skips dates that are beyond the forecast window (they'd hit the archive API
    which won't have future data).
    """
    today = date.today()
    forecast_limit = today + timedelta(days=FUTURE_FORECAST_WINDOW_DAYS)

    if target_date <= forecast_limit:
        return [target_date]

    # Don't include the original future date — it will always fail on the archive API.
    # Go straight to fallback years.
    candidates = []
    for years_back in range(1, MAX_FALLBACK_YEARS + 1):
        candidate_year = target_date.year - years_back
        if candidate_year < 1940:
            break
        candidates.append(_safe_with_year(target_date, candidate_year))

    return candidates


@dataclass
class FactorBreakdown:
    solar_resource: float
    shading_impact: float
    system_efficiency: float
    weather_reliability: float
    area_suitability: float

    solar_resource_weighted: float
    shading_impact_weighted: float
    system_efficiency_weighted: float
    weather_reliability_weighted: float
    area_suitability_weighted: float


@dataclass
class HourlyEfficiencyResult:
    hour: str
    solar_resource_score: float
    weather_reliability_score: float
    efficiency_score: float
    is_daylight: bool
    energy_output_kwh: float = 0.0
    irradiance_wm2: float = 0.0
    ambient_temperature_c: float = 0.0
    cell_temperature_c: float = 0.0
    energy_efficiency_loss: float = 1.0  # 1.0 = no loss, <1.0 = heat loss
    breakdown: FactorBreakdown | None = None


@dataclass
class DailyEfficiencyResult:
    date: str
    latitude: float
    longitude: float
    hourly_results: list[HourlyEfficiencyResult]
    average_efficiency_score: float
    daylight_average_efficiency_score: float
    peak_efficiency_score: float
    peak_hour: str
    total_daylight_hours: int
    total_energy_kwh: float = 0.0
    peak_power_kw: float = 0.0


async def fetch_hourly_solar_data(latitude: float, longitude: float, target_date: date | None = None) -> dict:
    today = date.today()

    # The archive API doesn't support is_day or global_tilted_irradiance,
    # so we only request those from the forecast API.
    forecast_hourly = [
        "temperature_2m",
        "cloud_cover",
        "direct_radiation",
        "diffuse_radiation",
        "direct_normal_irradiance",
        "global_tilted_irradiance",
        "is_day",
    ]
    archive_hourly = [
        "temperature_2m",
        "cloud_cover",
        "direct_radiation",
        "diffuse_radiation",
        "direct_normal_irradiance",
    ]

    api_url = FORECAST_API_URL
    use_archive = False

    if target_date:
        if (
            target_date > today + timedelta(days=FUTURE_FORECAST_WINDOW_DAYS)
            or target_date < today - timedelta(days=PAST_FORECAST_WINDOW_DAYS)
        ):
            api_url = ARCHIVE_API_URL
            use_archive = True

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": archive_hourly if use_archive else forecast_hourly,
        "timezone": "auto",
    }

    if target_date:
        params["start_date"] = target_date.isoformat()
        params["end_date"] = target_date.isoformat()
    else:
        params["forecast_days"] = 1

    data = await fetch_with_retry(api_url, params=params, timeout=30.0)

    # If archive API was used, compute is_day from direct_radiation
    # (radiation > 0 means the sun is up)
    if use_archive:
        hourly = data.get("hourly", {})
        direct = hourly.get("direct_radiation", [])
        diffuse = hourly.get("diffuse_radiation", [])
        hourly["is_day"] = [
            1 if ((direct[i] or 0) + (diffuse[i] or 0)) > 0 else 0
            for i in range(len(direct))
        ]

    return data



def calculate_hourly_efficiency(
    hour_index: int,
    hourly_data: dict,
    panel_data: PanelData,
    latitude: float,
    day_of_year: int,
    shading_factor: float = 1.0,
    albedo: float = 0.2,
) -> HourlyEfficiencyResult:
    time = hourly_data["time"][hour_index]
    temperature = hourly_data["temperature_2m"][hour_index]
    cloud_cover = hourly_data["cloud_cover"][hour_index]
    direct_radiation = hourly_data.get("direct_radiation", [0] * 24)[hour_index] or 0
    diffuse_radiation = hourly_data.get("diffuse_radiation", [0] * 24)[hour_index] or 0
    dni = hourly_data.get("direct_normal_irradiance", [0] * 24)[hour_index] or 0
    is_day = hourly_data.get("is_day", [0] * 24)[hour_index] == 1

    ghi = direct_radiation + diffuse_radiation
    angle_of_incidence = estimate_angle_of_incidence(hour_index, latitude, day_of_year, panel_data.tilt)

    solar_resource = SolarResourceData(
        ghi=ghi,
        dni=dni,
        dhi=diffuse_radiation,
        ambient_temperature=temperature,
        angle_of_incidence=angle_of_incidence,
    )

    weather_data = WeatherData(cloud_cover=cloud_cover)

    solar_score = calculate_solar_resource_score(solar_resource, panel_data, albedo) if is_day else 0.0
    weather_score = calculate_weather_reliability_score(weather_data)
    area_score = calculate_area_suitability_score(panel_data)

    efficiency_data = EfficiencyData(
        sunlight_level=solar_score,
        shading_level=shading_factor,
        panel_efficiency=1,
        weather_reliability=weather_score,
        area_suitability=area_score,
    )

    efficiency_score = calculate_efficiency_score(efficiency_data) if is_day else 0.0

    breakdown = FactorBreakdown(
        solar_resource=solar_score,
        shading_impact=shading_factor,
        system_efficiency=panel_data.efficiency,
        weather_reliability=weather_score,
        area_suitability=area_score,
        solar_resource_weighted=solar_score * CalculationFactors.SOLAR_RESOURCE.weight,
        shading_impact_weighted=shading_factor * CalculationFactors.SHADING_IMPACT.weight,
        system_efficiency_weighted=panel_data.efficiency * CalculationFactors.SYSTEM_EFFICIENCY.weight,
        weather_reliability_weighted=weather_score * CalculationFactors.WEATHER_RELIABILITY.weight,
        area_suitability_weighted=area_score * CalculationFactors.AREA_SUITABILITY.weight,
    ) if is_day else None

    # Use the tilt-corrected POA irradiance from calculate_panel_energy
    # (accounts for panel tilt, angle of incidence, diffuse sky, ground-reflected)
    poa_irradiance = calculate_panel_energy(solar_resource, panel_data, albedo) if is_day else 0.0

    energy_output_wh = poa_irradiance * panel_data.area * panel_data.efficiency * shading_factor
    energy_output_kwh = energy_output_wh / 1000.0

    # Temperature and efficiency-loss metrics for graphing
    cell_temp = calculate_cell_temperature(solar_resource, panel_data, albedo) if is_day else temperature
    eff_loss = calculate_energy_efficiency_loss(solar_resource, panel_data, albedo) if is_day else 1.0

    return HourlyEfficiencyResult(
        hour=time,
        solar_resource_score=solar_score,
        weather_reliability_score=weather_score,
        efficiency_score=efficiency_score,
        is_daylight=is_day,
        energy_output_kwh=energy_output_kwh,
        irradiance_wm2=poa_irradiance,
        ambient_temperature_c=round(temperature, 2),
        cell_temperature_c=round(cell_temp, 2),
        energy_efficiency_loss=round(eff_loss, 4),
        breakdown=breakdown,
    )


async def calculate_daily_efficiency(
    latitude: float,
    longitude: float,
    panel_data: PanelData,
    target_date: date | None = None,
    shading_factor: float = 1.0,
    albedo: float | None = None,
) -> DailyEfficiencyResult:
    if target_date is None:
        target_date = date.today()

    # Fetch real albedo from NASA POWER if not provided
    if albedo is None:
        albedo = await fetch_albedo(latitude, longitude)

    weather_response = await fetch_hourly_solar_data(latitude, longitude, target_date)
    hourly_data = weather_response.get("hourly", {})
    day_of_year = target_date.timetuple().tm_yday

    hourly_results = []
    for hour in range(24):
        result = calculate_hourly_efficiency(
            hour, hourly_data, panel_data, latitude, day_of_year, shading_factor, albedo
        )
        hourly_results.append(result)

    all_scores = [r.efficiency_score for r in hourly_results]
    daylight_scores = [r.efficiency_score for r in hourly_results if r.is_daylight]

    average_score = sum(all_scores) / len(all_scores) if all_scores else 0.0
    daylight_avg = sum(daylight_scores) / len(daylight_scores) if daylight_scores else 0.0
    peak_score = max(all_scores) if all_scores else 0.0
    peak_hour = hourly_results[all_scores.index(peak_score)].hour if all_scores else ""

    total_energy_kwh = sum(r.energy_output_kwh for r in hourly_results)
    peak_power_kw = max(r.energy_output_kwh for r in hourly_results)

    return DailyEfficiencyResult(
        date=target_date.isoformat(),
        latitude=latitude,
        longitude=longitude,
        hourly_results=hourly_results,
        average_efficiency_score=average_score,
        daylight_average_efficiency_score=daylight_avg,
        peak_efficiency_score=peak_score,
        peak_hour=peak_hour,
        total_daylight_hours=len(daylight_scores),
        total_energy_kwh=total_energy_kwh,
        peak_power_kw=peak_power_kw,
    )


@dataclass
class MonthlyEfficiencyResult:
    year: int
    month: int
    month_name: str
    latitude: float
    longitude: float
    days_calculated: int
    average_efficiency_score: float
    total_energy_kwh: float
    average_daily_energy_kwh: float
    peak_daily_energy_kwh: float
    average_daylight_hours: float


@dataclass
class YearlyEfficiencyResult:
    year: int
    latitude: float
    longitude: float
    monthly_results: list[MonthlyEfficiencyResult]
    total_energy_kwh: float
    average_efficiency_score: float
    best_month: str
    worst_month: str


MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]


async def calculate_monthly_efficiency(
    latitude: float,
    longitude: float,
    panel_data: PanelData,
    year: int,
    month: int,
    sample_days: int = 3,
    shading_factor: float = 1.0,
    albedo: float | None = None,
) -> MonthlyEfficiencyResult:
    """
    Calculate efficiency for a month by sampling representative days.
    sample_days: Number of days to sample (start, middle, end of month)
    """
    import calendar
    
    days_in_month = calendar.monthrange(year, month)[1]
    
    if sample_days >= days_in_month:
        sample_indices = list(range(1, days_in_month + 1))
    else:
        sample_indices = [
            1,
            days_in_month // 2,
            days_in_month,
        ]
        if sample_days > 3:
            step = days_in_month // sample_days
            sample_indices = [1 + i * step for i in range(sample_days)]
    
    daily_results = []
    for day in sample_indices:
        target_date = date(year, month, day)
        candidate_dates = _candidate_dates_for_sampling(target_date)

        for candidate_date in candidate_dates:
            try:
                result = await calculate_daily_efficiency(
                    latitude, longitude, panel_data, candidate_date, shading_factor, albedo
                )
                # Keep label aligned to the requested year/month/day while using fallback weather.
                result.date = target_date.isoformat()
                daily_results.append(result)
                break
            except Exception as e:
                logger.warning(
                    "Failed to calculate efficiency for %s (candidate %s): %s",
                    target_date, candidate_date, e,
                )
                continue
    
    if not daily_results:
        return MonthlyEfficiencyResult(
            year=year,
            month=month,
            month_name=MONTH_NAMES[month - 1],
            latitude=latitude,
            longitude=longitude,
            days_calculated=0,
            average_efficiency_score=0.0,
            total_energy_kwh=0.0,
            average_daily_energy_kwh=0.0,
            peak_daily_energy_kwh=0.0,
            average_daylight_hours=0.0,
        )
    
    avg_efficiency = sum(r.daylight_average_efficiency_score for r in daily_results) / len(daily_results)
    avg_daily_energy = sum(r.total_energy_kwh for r in daily_results) / len(daily_results)
    total_monthly_energy = avg_daily_energy * days_in_month
    peak_daily = max(r.total_energy_kwh for r in daily_results)
    avg_daylight = sum(r.total_daylight_hours for r in daily_results) / len(daily_results)
    
    return MonthlyEfficiencyResult(
        year=year,
        month=month,
        month_name=MONTH_NAMES[month - 1],
        latitude=latitude,
        longitude=longitude,
        days_calculated=len(daily_results),
        average_efficiency_score=avg_efficiency,
        total_energy_kwh=total_monthly_energy,
        average_daily_energy_kwh=avg_daily_energy,
        peak_daily_energy_kwh=peak_daily,
        average_daylight_hours=avg_daylight,
    )


async def calculate_yearly_efficiency(
    latitude: float,
    longitude: float,
    panel_data: PanelData,
    year: int | None = None,
    sample_days_per_month: int = 3,
    shading_factor: float = 1.0,
) -> YearlyEfficiencyResult:
    """
    Calculate efficiency for an entire year by running monthly calculations.
    """
    if year is None:
        year = date.today().year
    
    # Fetch albedo once for the whole year
    albedo = await fetch_albedo(latitude, longitude)

    monthly_results = []
    for month in range(1, 13):
        result = await calculate_monthly_efficiency(
            latitude, longitude, panel_data, year, month, sample_days_per_month, shading_factor, albedo
        )
        monthly_results.append(result)
    
    total_energy = sum(r.total_energy_kwh for r in monthly_results)
    avg_efficiency = sum(r.average_efficiency_score for r in monthly_results) / 12
    
    best_month_result = max(monthly_results, key=lambda r: r.total_energy_kwh)
    worst_month_result = min(monthly_results, key=lambda r: r.total_energy_kwh)
    
    return YearlyEfficiencyResult(
        year=year,
        latitude=latitude,
        longitude=longitude,
        monthly_results=monthly_results,
        total_energy_kwh=total_energy,
        average_efficiency_score=avg_efficiency,
        best_month=best_month_result.month_name,
        worst_month=worst_month_result.month_name,
    )


async def main():
    location_key = "berlin"
    
    if len(sys.argv) >= 2:
        arg = sys.argv[1].lower().replace(" ", "_").replace("-", "_")
        if arg == "--list" or arg == "-l":
            print("Available locations:")
            print("-" * 50)
            for key, (name, lat, lon) in LOCATIONS.items():
                print(f"  {key:<15} {name:<25} ({lat:.4f}, {lon:.4f})")
            return
        elif arg in LOCATIONS:
            location_key = arg
        else:
            print(f"Unknown location: {arg}")
            print(f"Use --list to see available locations")
            print(f"Or provide custom coordinates: python -m calculations.daily_efficiency <lat> <lon>")
            return

    if len(sys.argv) >= 3:
        try:
            latitude = float(sys.argv[1])
            longitude = float(sys.argv[2])
            location_name = f"Custom ({latitude}, {longitude})"
        except ValueError:
            pass
    else:
        location_name, latitude, longitude = LOCATIONS[location_key]

    panel = PanelData(
        efficiency=0.20,
        area=50.0,
        tilt=30.0,
        points_array=[[0, 0], [10, 0], [10, 5], [0, 5]],
    )

    print(f"Calculating daily efficiency for {location_name}")
    print(f"Coordinates: ({latitude}, {longitude})")
    print(f"Panel: {panel.area}m², {panel.efficiency*100}% efficiency, {panel.tilt}° tilt")
    print("-" * 60)

    result = await calculate_daily_efficiency(latitude, longitude, panel)

    print(f"\nDate: {result.date}")
    print(f"Daylight Hours: {result.total_daylight_hours}")

    print(f"\n{'='*100}")
    print("FACTOR WEIGHTS:")
    print(f"{'='*100}")
    for factor in CalculationFactors:
        print(f"  {factor.label:<20} = {factor.weight:.2f} ({factor.weight*100:.0f}%)")

    print(f"\n{'='*100}")
    print("HOURLY BREAKDOWN (Daylight Hours Only)")
    print(f"{'='*100}")

    for hr in result.hourly_results:
        if not hr.is_daylight or hr.breakdown is None:
            continue

        b = hr.breakdown
        print(f"\n{hr.hour}")
        print("-" * 80)
        print(f"  {'Factor':<25} {'Raw Score':>12} {'Weight':>10} {'Weighted':>12}")
        print(f"  {'-'*25} {'-'*12} {'-'*10} {'-'*12}")
        print(f"  {'Solar Resource':<25} {b.solar_resource:>12.4f} {CalculationFactors.SOLAR_RESOURCE.weight:>10.2f} {b.solar_resource_weighted:>12.4f}")
        print(f"  {'Shading Impact':<25} {b.shading_impact:>12.4f} {CalculationFactors.SHADING_IMPACT.weight:>10.2f} {b.shading_impact_weighted:>12.4f}")
        print(f"  {'System Efficiency':<25} {b.system_efficiency:>12.4f} {CalculationFactors.SYSTEM_EFFICIENCY.weight:>10.2f} {b.system_efficiency_weighted:>12.4f}")
        print(f"  {'Weather Reliability':<25} {b.weather_reliability:>12.4f} {CalculationFactors.WEATHER_RELIABILITY.weight:>10.2f} {b.weather_reliability_weighted:>12.4f}")
        print(f"  {'Area Suitability':<25} {b.area_suitability:>12.4f} {CalculationFactors.AREA_SUITABILITY.weight:>10.2f} {b.area_suitability_weighted:>12.4f}")
        print(f"  {'-'*25} {'-'*12} {'-'*10} {'-'*12}")
        print(f"  {'TOTAL SCORE':<25} {'':<12} {'':<10} {hr.efficiency_score:>12.4f}")
        print(f"\n  Irradiance: {hr.irradiance_wm2:.1f} W/m²  |  Energy Output: {hr.energy_output_kwh:.3f} kWh")

    print(f"\n{'='*100}")
    print("ENERGY OUTPUT (Hourly)")
    print(f"{'='*100}")
    print(f"  {'Hour':<20} {'Irradiance (W/m²)':>18} {'Energy (kWh)':>15}")
    print(f"  {'-'*20} {'-'*18} {'-'*15}")
    for hr in result.hourly_results:
        if hr.is_daylight:
            print(f"  {hr.hour:<20} {hr.irradiance_wm2:>18.1f} {hr.energy_output_kwh:>15.3f}")

    print(f"\n{'='*100}")
    print("SUMMARY")
    print(f"{'='*100}")
    print(f"  Average Efficiency (24h):      {result.average_efficiency_score:.4f}")
    print(f"  Average Efficiency (daylight): {result.daylight_average_efficiency_score:.4f}")
    print(f"  Peak Efficiency:               {result.peak_efficiency_score:.4f} at {result.peak_hour}")
    print(f"\n  Panel Size:                    {panel.area} m²")
    print(f"  Panel Efficiency:              {panel.efficiency * 100:.1f}%")
    print(f"  Total Daily Energy:            {result.total_energy_kwh:.3f} kWh")
    print(f"  Peak Hourly Output:            {result.peak_power_kw:.3f} kWh")


if __name__ == "__main__":
    asyncio.run(main())
