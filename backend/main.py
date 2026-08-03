import math
from datetime import date

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from calculations.midpoints import Point, PointsRequest, MidpointResponse, calculate_midpoint
from calculations.daily_efficiency import (
    calculate_daily_efficiency,
    calculate_monthly_efficiency,
    calculate_yearly_efficiency,
    PanelData,
)
from services.weather import (
    get_climate_change_data,
    get_current_day_forecast,
    get_monthly_weather,
    get_yearly_weather,
)
from services.openai_signals import generate_signals, SignalType
from services.elevation import calculate_shading_factor
from services.nasa_power import fetch_albedo


class PolygonEfficiencyRequest(BaseModel):
    points: list[Point]
    panel_efficiency: float = 0.20
    panel_area: float = 50.0
    panel_tilt: float = 30.0
    param_area: float = 1.7  # Single panel area in m² (default ~1.0m × 1.7m, 400W class)


class HourlyGraphData(BaseModel):
    hour: str
    efficiency_score: float
    solar_resource: float
    weather_reliability: float
    shading_factor: float  # 0–1: terrain shading (1.0 = fully exposed)
    energy_kwh: float
    irradiance_wm2: float
    is_daylight: bool
    ambient_temperature_c: float
    cell_temperature_c: float
    energy_efficiency_loss: float  # 1.0 = no loss, <1.0 = heat-related loss


class PolygonEfficiencyResponse(BaseModel):
    midpoint: Point
    date: str
    hourly_data: list[HourlyGraphData]
    summary: dict


class MonthlyGraphData(BaseModel):
    month: int
    month_name: str
    average_efficiency_score: float
    total_energy_kwh: float
    average_daily_energy_kwh: float
    average_daylight_hours: float


class YearlyEfficiencyResponse(BaseModel):
    midpoint: Point
    year: int
    monthly_data: list[MonthlyGraphData]
    summary: dict


class SignalItem(BaseModel):
    type: str  # "info", "warning", "tip"
    title: str
    content: str
    climate: bool = False


class SignalsResponse(BaseModel):
    signals: list[SignalItem]


app = FastAPI(
    title="Hackathon Backend API",
    description="Backend API for the hackathon project",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "Welcome to the Hackathon Backend API"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.post("/geo/midpoint", response_model=MidpointResponse)
async def get_midpoint(request: PointsRequest):
    """
    Calculate the geographic midpoint of a set of latitude/longitude points.
    """
    if not request.points:
        raise HTTPException(status_code=400, detail="At least one point is required")

    return calculate_midpoint(request.points)


@app.post("/solar/polygon-efficiency", response_model=PolygonEfficiencyResponse)
async def get_polygon_efficiency(request: PolygonEfficiencyRequest):
    """
    Calculate solar efficiency for a polygon area.
    Takes polygon points, calculates midpoint, and returns hourly efficiency data for graphing.
    """
    if not request.points or len(request.points) < 3:
        raise HTTPException(status_code=400, detail="At least 3 points required for a polygon")

    midpoint_result = calculate_midpoint(request.points)
    midpoint = midpoint_result.midpoint

    panel = PanelData(
        efficiency=request.panel_efficiency,
        area=request.panel_area,
        tilt=request.panel_tilt,
        points_array=[[p.latitude, p.longitude] for p in request.points],
    )

    try:
        # Compute terrain-based shading factor and albedo in parallel
        shading_factor = await calculate_shading_factor(
            midpoint.latitude, midpoint.longitude
        )
        albedo = await fetch_albedo(midpoint.latitude, midpoint.longitude)

        result = await calculate_daily_efficiency(
            latitude=midpoint.latitude,
            longitude=midpoint.longitude,
            panel_data=panel,
            shading_factor=shading_factor,
            albedo=albedo,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate efficiency: {str(e)}")

    shadow_coverage_percent = round((1 - shading_factor) * 100, 2)

    hourly_data = []
    for hr in result.hourly_results:
        hourly_data.append(HourlyGraphData(
            hour=hr.hour,
            efficiency_score=hr.efficiency_score,
            solar_resource=hr.solar_resource_score,
            weather_reliability=hr.weather_reliability_score,
            shading_factor=round(shading_factor, 4),
            energy_kwh=hr.energy_output_kwh,
            irradiance_wm2=hr.irradiance_wm2,
            is_daylight=hr.is_daylight,
            ambient_temperature_c=hr.ambient_temperature_c,
            cell_temperature_c=hr.cell_temperature_c,
            energy_efficiency_loss=hr.energy_efficiency_loss,
        ))

    estimated_panel_count = int(request.panel_area / request.param_area)

    summary = {
        "average_efficiency_24h": result.average_efficiency_score,
        "average_efficiency_daylight": result.daylight_average_efficiency_score,
        "peak_efficiency": result.peak_efficiency_score,
        "peak_hour": result.peak_hour,
        "total_daylight_hours": result.total_daylight_hours,
        "total_energy_kwh": result.total_energy_kwh,
        "peak_power_kw": result.peak_power_kw,
        "panel_area_m2": request.panel_area,
        "panel_efficiency_percent": request.panel_efficiency * 100,
        "estimated_panel_count": estimated_panel_count,
        "shading_factor": round(shading_factor, 4),
        "shadow_coverage_percent": shadow_coverage_percent,
        "albedo": round(albedo, 4),
    }

    return PolygonEfficiencyResponse(
        midpoint=midpoint,
        date=result.date,
        hourly_data=hourly_data,
        summary=summary,
    )


@app.post("/solar/polygon-yearly", response_model=YearlyEfficiencyResponse)
async def get_polygon_yearly_efficiency(
    request: PolygonEfficiencyRequest,
    year: int = Query(default=None, description="Year to calculate (defaults to current year)"),
):
    """
    Calculate solar efficiency for a polygon area across an entire year.
    Returns monthly data for graphing seasonal variations.
    """
    if not request.points or len(request.points) < 3:
        raise HTTPException(status_code=400, detail="At least 3 points required for a polygon")

    midpoint_result = calculate_midpoint(request.points)
    midpoint = midpoint_result.midpoint

    panel = PanelData(
        efficiency=request.panel_efficiency,
        area=request.panel_area,
        tilt=request.panel_tilt,
        points_array=[[p.latitude, p.longitude] for p in request.points],
    )

    try:
        # Compute terrain-based shading factor and albedo in parallel
        shading_factor = await calculate_shading_factor(
            midpoint.latitude, midpoint.longitude
        )
        albedo = await fetch_albedo(midpoint.latitude, midpoint.longitude)

        result = await calculate_yearly_efficiency(
            latitude=midpoint.latitude,
            longitude=midpoint.longitude,
            panel_data=panel,
            year=year,
            shading_factor=shading_factor,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate yearly efficiency: {str(e)}")

    shadow_coverage_percent = round((1 - shading_factor) * 100, 2)

    monthly_data = []
    for m in result.monthly_results:
        monthly_data.append(MonthlyGraphData(
            month=m.month,
            month_name=m.month_name,
            average_efficiency_score=m.average_efficiency_score,
            total_energy_kwh=m.total_energy_kwh,
            average_daily_energy_kwh=m.average_daily_energy_kwh,
            average_daylight_hours=m.average_daylight_hours,
        ))

    estimated_panel_count = int(request.panel_area / request.param_area)

    summary = {
        "year": result.year,
        "total_energy_kwh": result.total_energy_kwh,
        "average_efficiency_score": result.average_efficiency_score,
        "best_month": result.best_month,
        "worst_month": result.worst_month,
        "panel_area_m2": request.panel_area,
        "panel_efficiency_percent": request.panel_efficiency * 100,
        "estimated_panel_count": estimated_panel_count,
        "shading_factor": round(shading_factor, 4),
        "shadow_coverage_percent": shadow_coverage_percent,
        "albedo": round(albedo, 4),
    }

    return YearlyEfficiencyResponse(
        midpoint=midpoint,
        year=result.year,
        monthly_data=monthly_data,
        summary=summary,
    )


@app.post("/solar/signals", response_model=SignalsResponse)
async def get_solar_signals(request: PolygonEfficiencyRequest):
    """
    Generate AI-powered advisory signals (info, warning, tip) for a solar polygon area.
    Calculates efficiency data then uses OpenAI to produce actionable insights.
    """
    if not request.points or len(request.points) < 3:
        raise HTTPException(status_code=400, detail="At least 3 points required for a polygon")

    midpoint_result = calculate_midpoint(request.points)
    midpoint = midpoint_result.midpoint

    panel = PanelData(
        efficiency=request.panel_efficiency,
        area=request.panel_area,
        tilt=request.panel_tilt,
        points_array=[[p.latitude, p.longitude] for p in request.points],
    )

    try:
        # Compute terrain-based shading factor and albedo
        shading_factor = await calculate_shading_factor(
            midpoint.latitude, midpoint.longitude
        )
        albedo = await fetch_albedo(midpoint.latitude, midpoint.longitude)

        result = await calculate_daily_efficiency(
            latitude=midpoint.latitude,
            longitude=midpoint.longitude,
            panel_data=panel,
            shading_factor=shading_factor,
            albedo=albedo,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate efficiency: {str(e)}")

    shadow_coverage_percent = round((1 - shading_factor) * 100, 2)

    summary = {
        "average_efficiency_24h": result.average_efficiency_score,
        "average_efficiency_daylight": result.daylight_average_efficiency_score,
        "peak_efficiency": result.peak_efficiency_score,
        "peak_hour": result.peak_hour,
        "total_daylight_hours": result.total_daylight_hours,
        "total_energy_kwh": result.total_energy_kwh,
        "peak_power_kw": result.peak_power_kw,
        "shading_factor": round(shading_factor, 4),
        "shadow_coverage_percent": shadow_coverage_percent,
        "albedo": round(albedo, 4),
    }

    # Fetch climate change projections (2024-2050) in parallel
    try:
        climate_data = await get_climate_change_data(
            midpoint.latitude, midpoint.longitude
        )
    except Exception:
        climate_data = None

    try:
        signals = await generate_signals(
            latitude=midpoint.latitude,
            longitude=midpoint.longitude,
            summary=summary,
            panel_area=request.panel_area,
            panel_efficiency=request.panel_efficiency,
            panel_tilt=request.panel_tilt,
            climate_data=climate_data,
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {str(e)}")

    return SignalsResponse(
        signals=[
            SignalItem(type=s.type.value, title=s.title, content=s.content, climate=s.climate)
            for s in signals
        ]
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
