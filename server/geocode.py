"""Геокодинг через публичный Nominatim (порт `client/src/nav/geocode.ts`).

Правила публичного сервиса: не больше 1 запроса в секунду, осмысленный
User-Agent, кэширование. Интеграция живёт только на сервере — клиент не знает
о Nominatim.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

import aiohttp

DEFAULT_NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org"
APP_USER_AGENT = "ochko-server/0.1 (OCHKO smart glasses diploma project; https://github.com/)"
MIN_INTERVAL_MS = 1000
CACHE_TTL_MS = 10 * 60 * 1000


class GeocodeError(Exception):
    pass


@dataclass
class SearchOptions:
    viewbox: tuple[float, float, float, float] | None = None  # minLon,minLat,maxLon,maxLat
    limit: int = 5


@dataclass
class GeocodeResult:
    displayName: str
    lat: float
    lon: float
    type: str
    importance: float

    def to_json(self) -> dict:
        return {
            "displayName": self.displayName,
            "lat": self.lat,
            "lon": self.lon,
            "type": self.type,
            "importance": self.importance,
        }


def _to_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


class NominatimClient:
    """Клиент публичного Nominatim с глобальной очередью (<= 1 req/s), кэшем и UA."""

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

    async def search(self, query: str, options: SearchOptions | None = None) -> list[GeocodeResult]:
        options = options or SearchOptions()
        trimmed = query.strip()
        if not trimmed:
            return []

        key = self._cache_key(trimmed, options)
        now = time.monotonic()
        cached = self._cache.get(key)
        if cached and now - cached[0] < self.cache_ttl_ms / 1000:
            return cached[1]

        results = await self._scheduled(lambda: self._perform_search(trimmed, options))
        self._cache[key] = (time.monotonic(), results)
        return results

    async def _scheduled(self, task):
        """Сериализует запросы и не даёт двум идти чаще раза в min_interval_ms."""
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
        return f"{query.strip().lower()}|{vb}|{options.limit}"

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
            params["bounded"] = "0"
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{self.base_url}/search?{qs}"

    async def _perform_search(self, query: str, options: SearchOptions) -> list[GeocodeResult]:
        session = self._session
        if session is None:
            async with aiohttp.ClientSession() as s:
                return await self._do(s, query, options)
        return await self._do(session, query, options)

    async def _do(self, session: aiohttp.ClientSession, query: str, options: SearchOptions) -> list[GeocodeResult]:
        url = self.build_url(query, options)
        headers = {"User-Agent": self.user_agent}
        async with session.get(url, headers=headers) as resp:
            if resp.status != 200:
                raise GeocodeError(f"Nominatim ответил {resp.status}")
            data = await resp.json()
        if not isinstance(data, list):
            return []
        return [_parse_entry(raw) for raw in data]


def _parse_entry(raw) -> GeocodeResult:
    if not isinstance(raw, dict):
        return GeocodeResult("", 0.0, 0.0, "", 0.0)
    return GeocodeResult(
        displayName=str(raw.get("display_name", "")),
        lat=_to_float(raw.get("lat")),
        lon=_to_float(raw.get("lon")),
        type=str(raw.get("type", "")),
        importance=_to_float(raw.get("importance")),
    )