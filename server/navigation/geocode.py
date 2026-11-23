"""Геокодинг через публичный Nominatim.

Правила публичного сервиса: не больше 1 запроса в секунду, осмысленный
User-Agent, кэширование. Интеграция живёт только на сервере — клиент не знает
о Nominatim.
"""

from __future__ import annotations

import asyncio
import math
import time
from dataclasses import dataclass, field
from urllib.parse import urlencode

import aiohttp

DEFAULT_NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org"
APP_USER_AGENT = "ochko-server/0.1 (OCHKO smart glasses diploma project; https://github.com/)"
MIN_INTERVAL_MS = 1000
CACHE_TTL_MS = 10 * 60 * 1000


class GeocodeError(Exception):
    pass


@dataclass
class SearchOptions:
    viewbox: tuple[float, float, float, float] | None = None
    limit: int = 5
    bounded: bool = False


@dataclass
class GeocodeResult:
    displayName: str
    lat: float
    lon: float
    type: str
    importance: float
    address: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        result = {
            "displayName": self.displayName,
            "lat": self.lat,
            "lon": self.lon,
            "type": self.type,
            "importance": self.importance,
        }
        if self.address:
            result["address"] = self.address
        return result


def _to_float(value, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def _coordinate(value, minimum: float, maximum: float) -> float | None:
    number = _to_float(value, default=math.nan)
    return number if math.isfinite(number) and minimum <= number <= maximum else None


class NominatimClient:
    """Клиент публичного Nominatim с очередью (<= 1 req/s), кэшем и UA."""

    def __init__(
        self,
        base_url: str = DEFAULT_NOMINATIM_BASE_URL,
        user_agent: str = APP_USER_AGENT,
        min_interval_ms: int = MIN_INTERVAL_MS,
        cache_ttl_ms: int = CACHE_TTL_MS,
        *,
        session: aiohttp.ClientSession | None = None,
    ) -> None:
        self.base_url = base_url
        self.user_agent = user_agent
        self.min_interval_ms = min_interval_ms
        self.cache_ttl_ms = cache_ttl_ms
        self._session = session
        self._lock = asyncio.Lock()
        self._last_request_at: float | None = None
        self._cache: dict[str, tuple[float, list[GeocodeResult]]] = {}
        self._reverse_cache: dict[str, tuple[float, GeocodeResult | None]] = {}

    async def search(self, query: str, options: SearchOptions | None = None) -> list[GeocodeResult]:
        options = options or SearchOptions()
        trimmed = query.strip()
        if not trimmed:
            return []

        key = self._cache_key(trimmed, options)
        cached = self._cache.get(key)
        if cached and time.monotonic() - cached[0] < self.cache_ttl_ms / 1000:
            return cached[1]

        results = await self._scheduled(lambda: self._perform_search(trimmed, options))
        self._cache[key] = (time.monotonic(), results)
        return results

    async def reverse(self, lat: float, lon: float, zoom: int = 18) -> GeocodeResult | None:
        if _coordinate(lat, -90, 90) is None or _coordinate(lon, -180, 180) is None:
            raise GeocodeError("Некорректные координаты")
        if not 0 <= zoom <= 18:
            raise GeocodeError("zoom должен быть от 0 до 18")

        key = f"{lat:.6f},{lon:.6f}|{zoom}"
        cached = self._reverse_cache.get(key)
        if cached and time.monotonic() - cached[0] < self.cache_ttl_ms / 1000:
            return cached[1]

        result = await self._scheduled(lambda: self._perform_reverse(lat, lon, zoom))
        self._reverse_cache[key] = (time.monotonic(), result)
        return result

    async def _scheduled(self, task):
        async with self._lock:
            if self._last_request_at is not None:
                elapsed_ms = (time.monotonic() - self._last_request_at) * 1000
                if elapsed_ms < self.min_interval_ms:
                    await asyncio.sleep((self.min_interval_ms - elapsed_ms) / 1000)
            self._last_request_at = time.monotonic()
            return await task()

    def _cache_key(self, query: str, options: SearchOptions) -> str:
        vb = (
            f"{options.viewbox[0]},{options.viewbox[1]},{options.viewbox[2]},{options.viewbox[3]}"
            if options.viewbox
            else ""
        )
        return f"{query.strip().lower()}|{vb}|{options.limit}|{int(options.bounded)}"

    def build_url(self, query: str, options: SearchOptions) -> str:
        params = {
            "format": "jsonv2",
            "accept-language": "ru",
            "countrycodes": "ru",
            "limit": str(options.limit),
            "q": query,
        }
        if options.viewbox:
            min_lon, min_lat, max_lon, max_lat = options.viewbox
            params["viewbox"] = f"{min_lon},{min_lat},{max_lon},{max_lat}"
            params["bounded"] = "1" if options.bounded else "0"
        return f"{self.base_url}/search?{urlencode(params)}"

    def build_reverse_url(self, lat: float, lon: float, zoom: int = 18) -> str:
        params = {
            "format": "jsonv2",
            "accept-language": "ru",
            "addressdetails": "1",
            "lat": str(lat),
            "lon": str(lon),
            "zoom": str(zoom),
        }
        return f"{self.base_url}/reverse?{urlencode(params)}"

    async def _perform_search(self, query: str, options: SearchOptions) -> list[GeocodeResult]:
        if self._session is None:
            async with aiohttp.ClientSession() as session:
                return await self._do_search(session, query, options)
        return await self._do_search(self._session, query, options)

    async def _do_search(
        self, session: aiohttp.ClientSession, query: str, options: SearchOptions
    ) -> list[GeocodeResult]:
        url = self.build_url(query, options)
        headers = {"User-Agent": self.user_agent}
        async with session.get(url, headers=headers) as resp:
            if resp.status != 200:
                raise GeocodeError(f"Nominatim ответил {resp.status}")
            data = await resp.json()
        if not isinstance(data, list):
            return []
        return [result for raw in data if (result := _parse_entry(raw)) is not None]

    async def _perform_reverse(self, lat: float, lon: float, zoom: int) -> GeocodeResult | None:
        if self._session is None:
            async with aiohttp.ClientSession() as session:
                return await self._do_reverse(session, lat, lon, zoom)
        return await self._do_reverse(self._session, lat, lon, zoom)

    async def _do_reverse(
        self, session: aiohttp.ClientSession, lat: float, lon: float, zoom: int
    ) -> GeocodeResult | None:
        url = self.build_reverse_url(lat, lon, zoom)
        headers = {"User-Agent": self.user_agent}
        async with session.get(url, headers=headers) as resp:
            if resp.status == 404:
                return None
            if resp.status != 200:
                raise GeocodeError(f"Nominatim reverse ответил {resp.status}")
            data = await resp.json()
        return _parse_entry(data)


def _parse_entry(raw) -> GeocodeResult | None:
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("display_name") or raw.get("name") or "").strip()
    lat = _coordinate(raw.get("lat"), -90, 90)
    lon = _coordinate(raw.get("lon"), -180, 180)
    if not name or lat is None or lon is None:
        return None
    address = raw.get("address") if isinstance(raw.get("address"), dict) else {}
    return GeocodeResult(
        displayName=name,
        lat=lat,
        lon=lon,
        type=str(raw.get("type") or raw.get("addresstype") or ""),
        importance=_to_float(raw.get("importance")),
        address=address,
    )
