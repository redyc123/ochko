import pytest

from navigation.maneuver_map import ManeuverIcon, map_osrm_maneuver_to_icon
from navigation.polyline import decode_polyline6, encode_polyline6
from navigation.router import (
    RouteTooLongError,
    RouteValidationError,
    build_osrm_url,
    parse_osrm_response,
    validate_route,
)


# --- polyline ---

def test_polyline6_roundtrip():
    pts = [(55.7558, 37.6173), (55.7511, 37.6173), (55.7500, 37.6000)]
    assert decode_polyline6(encode_polyline6(pts)) == pts


def test_polyline6_decodes_coordinates():
    # Известная строка, закодированная вручную тем же алгоритмом
    pts = decode_polyline6(encode_polyline6([(59.91, 30.31)]))
    assert abs(pts[0][0] - 59.91) < 1e-5
    assert abs(pts[0][1] - 30.31) < 1e-5


# --- maneuver mapping ---

def test_fork_keep_right():
    assert map_osrm_maneuver_to_icon("fork", "right") == ManeuverIcon.KEEP_RIGHT
    assert map_osrm_maneuver_to_icon("fork", "left") == ManeuverIcon.KEEP_LEFT


def test_fixed_types():
    assert map_osrm_maneuver_to_icon("depart") == ManeuverIcon.START
    assert map_osrm_maneuver_to_icon("arrive") == ManeuverIcon.ARRIVE
    assert map_osrm_maneuver_to_icon("roundabout") == ManeuverIcon.ROUNDABOUT


def test_unknown_type_none():
    assert map_osrm_maneuver_to_icon("bogus") == ManeuverIcon.NONE


def test_modifier_turns():
    assert map_osrm_maneuver_to_icon("turn", "left") == ManeuverIcon.LEFT
    assert map_osrm_maneuver_to_icon("continue", "slight right") == ManeuverIcon.SLIGHT_RIGHT


# --- router ---

def test_build_osrm_url_order_lon_lat():
    url = build_osrm_url("https://routing.openstreetmap.de", (37.6, 55.75), (37.7, 55.76), "pedestrian")
    assert "routed-foot/route/v1/foot/37.6,55.75;37.7,55.76" in url


def test_parse_osrm_response_builds_route():
    # Один шаг, geometry в polyline6 одной точки
    single = encode_polyline6([(55.75, 37.6)])
    data = {
        "code": "Ok",
        "routes": [{"distance": 1000, "duration": 300, "legs": [{"steps": [
            {"distance": 1000, "duration": 300, "name": "Тверская", "geometry": single,
             "maneuver": {"type": "arrive", "modifier": "straight"}},
        ]}]}],
    }
    route = parse_osrm_response(data, "pedestrian")
    assert route["distanceMeters"] == 1000
    assert route["maneuvers"][0]["type"] == ManeuverIcon.ARRIVE
    assert route["maneuvers"][0]["streetNames"] == ["Тверская"]
    assert route["profile"] == "pedestrian"


def valid_route(distance=1000, profile="pedestrian"):
    return {
        "shape": [{"lat": 55.75, "lon": 37.6}, {"lat": 55.76, "lon": 37.61}],
        "maneuvers": [],
        "distanceMeters": distance,
        "durationSeconds": 300,
        "profile": profile,
    }


def test_validate_route_rejects_pedestrian_route_over_twenty_km():
    with pytest.raises(RouteTooLongError, match="Максимум — 20 км"):
        validate_route(valid_route(20_001), "pedestrian")


@pytest.mark.parametrize("profile", ["bicycle", "auto"])
def test_validate_route_has_no_pedestrian_limit_for_other_profiles(profile):
    assert validate_route(valid_route(200_000, profile), profile) is not None


@pytest.mark.parametrize("shape", [[], [{"lat": 55.75, "lon": 37.6}], [{"lat": 200, "lon": 37.6}] * 2])
def test_validate_route_rejects_incomplete_geometry(shape):
    route = valid_route()
    route["shape"] = shape
    with pytest.raises(RouteValidationError):
        validate_route(route, "pedestrian")
