"""Роутинг через публичный OSRM (порт `client/src/nav/router.ts`).

Правила FOSSGIS-инстанса routing.openstreetmap.de: <= 1 req/s, осмысленный UA.
Роутер живёт только на сервере; клиент получает готовый Route.
"""

from __future__ import annotations

import asyncio
import time

import aiohttp

from maneuver_map import map_osrm_maneuver_to_icon, uses_exit_number
from polyline import decode_polyline6

DEFAULT_OSRM_BASE_URL = "https://routing.openstreetmap.de"
APP_USER_AGENT = "ochko-server/0.1 (OCHKO smart glasses diploma project; https://github.com/)"
MIN_INTERVAL_MS = 1000
MAX_RETRIES = 3
RETRY_BASE_DELAY_MS = 500

Profile = str  # 'pedestrian' | 'bicycle' | 'auto'
PROFILE_TO_OSRM = {
    "pedestrian": "foot",
    "bicycle": "bike",
    "auto": "car",
}


class RouteError(Exception):
    pass


def profile_to_osrm(profile: Profile) -> str:
    if profile not in PROFILE_TO_OSRM:
        raise RouteError(f"Неизвестный профиль маршрута: {profile}")
    return PROFILE_TO_OSRM[profile]


def build_osrm_url(base_url: str, from_ll, to_ll, profile: Profile) -> str:
    """Координаты в пути — ВНИМАНИЕ, порядок `lon,lat`, не `lat,lon`."""
    osrm_profile = profile_to_osrm(profile)
    f_lon, f_lat = from_ll
    t_lon, t_lat = to_ll
    coords = f"{f_lon},{f_lat};{t_lon},{t_lat}"
    params = {
        "steps": "true",
        "geometries": "polyline6",
        "overview": "false",
    }
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{base_url}/routed-{osrm_profile}/route/v1/{osrm_profile}/{coords}?{qs}"


def parse_osrm_response(data, profile: Profile) -> dict:
    """Склеивает shape из geometry отдельных шагов (см. router.ts по индексам)."""
    if not isinstance(data, dict) or data.get("code") != "Ok":
        raise RouteError(str((data or {}).get("message") or (data or {}).get("code") or "OSRM error"))
    routes = data.get("routes") or []
    leg = (routes[0].get("legs") or [None])[0] if routes else None
    if not leg:
        raise RouteError("OSRM вернул маршрут без ни одного leg")

    shape: list[tuple[float, float]] = []  # (lat, lon)
    maneuvers: list[dict] = []

    for step in leg.get("steps", []):
        points = decode_polyline6(step.get("geometry", ""))
        begin_shape_index = 0 if len(shape) == 0 else len(shape) - 1
        points_to_append = points if len(shape) == 0 else points[1:]
        shape.extend(points_to_append)
        end_shape_index = 0 if len(shape) == 0 else len(shape) - 1

        mtype = step.get("maneuver", {}).get("type", "")
        modifier = step.get("maneuver", {}).get("modifier")
        maneuver = {
            "type": map_osrm_maneuver_to_icon(mtype, modifier),
            "streetNames": [step.get("name", "")] if step.get("name") else [],
            "distanceMeters": _num(step.get("distance")),
            "durationSeconds": _num(step.get("duration")),
            "beginShapeIndex": begin_shape_index,
            "endShapeIndex": end_shape_index,
        }
        exit_no = step.get("maneuver", {}).get("exit")
        if uses_exit_number(mtype) and exit_no is not None:
            maneuver["roundaboutExitCount"] = _num(exit_no)
        maneuvers.append(maneuver)

    route = routes[0]
    return {
        "shape": [{"lat": la, "lon": lo} for la, lo in shape],
        "maneuvers": maneuvers,
        "distanceMeters": _num(route.get("distance")),
        "durationSeconds": _num(route.get("duration")),
        "profile": profile,
    }


def _num(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


class OsrmRouter:
    """Router поверх OSRM /route с паузой >= 1 req/s и ретраями."""

    def __init__(
        self,
        base_url: str = DEFAULT_OSRM_BASE_URL,
        user_agent: str = APP_USER_AGENT,
        min_interval_ms: int = MIN_INTERVAL_MS,
        max_retries: int = MAX_RETRIES,
        retry_base_delay_ms: int = RETRY_BASE_DELAY_MS,
        *,
        session: aiohttp.ClientSession | None = None,
    ) -> None:
        self.base_url = base_url
        self.user_agent = user_agent
        self.min_interval_ms = min_interval_ms
        self.max_retries = max_retries
        self.retry_base_delay_ms = retry_base_delay_ms
        self._session = session
        self._lock = asyncio.Lock()
        self._last_request_at: float | None = None

    async def route(self, from_ll, to_ll, profile: Profile) -> dict:
        url = build_osrm_url(self.base_url, from_ll, to_ll, profile)
        base_delay = self.retry_base_delay_ms / 1000
        for attempt in range(self.max_retries + 1):
            try:
                await self._pace()
                session = self._session or aiohttp.ClientSession()
                close = session is not self._session
                try:
                    async with session.get(url, headers={"User-Agent": self.user_agent}) as resp:
                        if resp.status != 200:
                            if self._is_retryable(resp.status) and attempt < self.max_retries:
                                await asyncio.sleep(base_delay * 2**attempt)
                                continue
                            raise RouteError(f"OSRM ответил {resp.status}")
                        data = await resp.json()
                finally:
                    if close:
                        await session.close()
                return parse_osrm_response(data, profile)
            except RouteError:
                raise
            except Exception:
                if attempt < self.max_retries:
                    await asyncio.sleep(base_delay * 2**attempt)
                    continue
                raise RouteError("Не удалось построить маршрут: нет сети")

    async def _pace(self) -> None:
        async with self._lock:
            if self._last_request_at is not None:
                elapsed_ms = (time.monotonic() - self._last_request_at) * 1000
                if elapsed_ms < self.min_interval_ms:
                    await asyncio.sleep((self.min_interval_ms - elapsed_ms) / 1000)
            self._last_request_at = time.monotonic()

    def _is_retryable(self, status: int) -> bool:
        return status == 429 or status >= 500