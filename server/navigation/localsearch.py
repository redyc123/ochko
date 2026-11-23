"""Локальный поиск адресов с проверкой расстояния и ограничением попыток."""

from __future__ import annotations

import math

from .geocode import GeocodeResult, NominatimClient, SearchOptions

MAX_SEARCH_ATTEMPTS = 5
SEARCH_RADII_METERS = (2_000, 5_000, 20_000)
EARTH_RADIUS_M = 6_371_000


class LocalSearchError(Exception):
    pass


class LocationRequiredError(LocalSearchError):
    pass


class LocalSearch:
    def __init__(
        self,
        geocoder: NominatimClient,
        max_distance_meters: float,
        max_attempts: int = MAX_SEARCH_ATTEMPTS,
    ) -> None:
        self.geocoder = geocoder
        self.max_distance_meters = max_distance_meters
        self.max_attempts = max_attempts

    async def search(self, query: str, position: dict | None, limit: int = 5) -> list[GeocodeResult]:
        origin = _position(position)
        if origin is None:
            raise LocationRequiredError("Нужна текущая позиция: включите GPS или укажите точку на карте.")
        trimmed = query.strip()
        if not trimmed:
            return []

        limit = max(1, min(limit, 40))
        attempts = 0
        last_error: Exception | None = None
        had_response = False

        async def run(query_text: str, radius: float | None) -> list[GeocodeResult]:
            nonlocal attempts, last_error, had_response
            if attempts >= self.max_attempts:
                return []
            attempts += 1
            options = SearchOptions(
                viewbox=_viewbox(origin, radius) if radius is not None else None,
                limit=limit,
                bounded=radius is not None,
            )
            try:
                results = await self.geocoder.search(query_text, options)
                had_response = True
                return _nearby_results(results, origin, self.max_distance_meters)[:limit]
            except Exception as err:
                last_error = err
                return []

        radii = (*SEARCH_RADII_METERS[:-1], min(SEARCH_RADII_METERS[-1], self.max_distance_meters))
        for radius in radii:
            results = await run(trimmed, radius)
            if results:
                return results

        locality = await self._locality(origin) if attempts < self.max_attempts else None
        localized_query = _with_locality(trimmed, locality)
        if localized_query != trimmed:
            for radius in (self.max_distance_meters, None):
                results = await run(localized_query, radius)
                if results:
                    return results
        elif attempts < self.max_attempts:
            results = await run(trimmed, None)
            if results:
                return results

        if not had_response and last_error is not None:
            raise LocalSearchError("Не удалось проверить адрес: сервис поиска недоступен, повторите позже.") from last_error
        return []

    async def _locality(self, position: dict) -> str | None:
        try:
            result = await self.geocoder.reverse(position["lat"], position["lon"], zoom=10)
        except Exception:
            return None
        if result is None:
            return None
        for key in ("city", "town", "village", "municipality"):
            value = result.address.get(key)
            if value:
                return str(value)
        return result.displayName.split(",", 1)[0].strip() or None


def _position(value: dict | None) -> dict | None:
    if not isinstance(value, dict):
        return None
    try:
        lat = float(value["lat"])
        lon = float(value["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return None
    return {"lat": lat, "lon": lon}


def _viewbox(position: dict, radius_meters: float) -> tuple[float, float, float, float]:
    lat_delta = radius_meters / 111_320
    cos_lat = max(0.01, abs(math.cos(math.radians(position["lat"]))))
    lon_delta = radius_meters / (111_320 * cos_lat)
    return (
        position["lon"] - lon_delta,
        position["lat"] - lat_delta,
        position["lon"] + lon_delta,
        position["lat"] + lat_delta,
    )


def _with_locality(query: str, locality: str | None) -> str:
    if not locality or locality.casefold() in query.casefold():
        return query
    return f"{query}, {locality}"


def _nearby_results(
    results: list[GeocodeResult], origin: dict, max_distance_meters: float
) -> list[GeocodeResult]:
    nearby: list[tuple[float, GeocodeResult]] = []
    seen: set[tuple[float, float]] = set()
    for result in results:
        lat = _coordinate(result.lat, -90, 90)
        lon = _coordinate(result.lon, -180, 180)
        if not result.displayName.strip() or lat is None or lon is None:
            continue
        key = (round(lat, 6), round(lon, 6))
        if key in seen:
            continue
        seen.add(key)
        distance = haversine_meters(origin["lat"], origin["lon"], lat, lon)
        if distance <= max_distance_meters:
            nearby.append((distance, result))
    nearby.sort(key=lambda item: item[0])
    return [result for _, result in nearby]


def _coordinate(value, minimum: float, maximum: float) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and minimum <= number <= maximum else None


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(d_lon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(min(1, math.sqrt(a)))
