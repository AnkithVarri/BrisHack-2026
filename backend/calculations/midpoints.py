import math

from pydantic import BaseModel


class Point(BaseModel):
    latitude: float
    longitude: float


class PointsRequest(BaseModel):
    points: list[Point]


class MidpointResponse(BaseModel):
    midpoint: Point
    num_points: int


def calculate_midpoint(points: list[Point]) -> MidpointResponse:
    if len(points) == 1:
        return MidpointResponse(
            midpoint=points[0],
            num_points=1,
        )

    x_sum = 0.0
    y_sum = 0.0
    z_sum = 0.0

    for point in points:
        lat_rad = math.radians(point.latitude)
        lon_rad = math.radians(point.longitude)

        x_sum += math.cos(lat_rad) * math.cos(lon_rad)
        y_sum += math.cos(lat_rad) * math.sin(lon_rad)
        z_sum += math.sin(lat_rad)

    n = len(points)
    x_avg = x_sum / n
    y_avg = y_sum / n
    z_avg = z_sum / n

    lon_rad = math.atan2(y_avg, x_avg)
    hyp = math.sqrt(x_avg * x_avg + y_avg * y_avg)
    lat_rad = math.atan2(z_avg, hyp)

    return MidpointResponse(
        midpoint=Point(
            latitude=math.degrees(lat_rad),
            longitude=math.degrees(lon_rad),
        ),
        num_points=n,
    )

