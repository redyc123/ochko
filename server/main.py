"""Сервер О.Ч.К.О. для мобильного приложения.

Вся «умная» часть живёт здесь: LLM-агент с инструментами, геокодинг
(Nominatim), роутинг (OSRM), распознавание речи (STT). Держит ключи вне бандла
приложения и снимает CORS для веба. Клиент — тонкий: шлёт запросы и исполняет
структурированные actions (start_route/stop_navigation).

Запуск: uv run main.py  (читает server/.env)
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

import aiohttp
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from agent import Agent, AgentContext, NavPort, normalize_nav_status, to_display_text
from geocode import GeocodeError, GeocodeResult, NominatimClient, SearchOptions
from gigachat import (
    GigaChatClient,
    GigaChatError,
    aiohttp_transport,
    make_session,
    make_ssl_context,
)
from llm import GigaChatProvider, LlmError
from router import OsrmRouter, RouteError
from sessions import SessionStore, global_store
from stt import SpeechToText, UnconfiguredSpeechToText

HERE = Path(__file__).resolve().parent
log = logging.getLogger("ochko-server")

# Профиль маршрута по умолчанию и разброс viewbox для геокодинга "рядом".
DEFAULT_PROFILE = "pedestrian"
VIEWBOX_DELTA_DEG = 0.05


def load_env_file(path: Path) -> None:
    """Минимальный разбор .env: KEY=VALUE, комментарии; окружение важнее файла."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


class ServerNavPort(NavPort):
    """Порт агента к навигации: использует серверные геокодинг и роутинг."""

    def __init__(self, geocoder: NominatimClient, router: OsrmRouter) -> None:
        self.geocoder = geocoder
        self.router = router
        self.current_position: dict | None = None

    def set_position(self, position: dict | None) -> None:
        self.current_position = position

    async def search(self, query: str) -> list[dict]:
        viewbox = None
        if self.current_position:
            lat = self.current_position.get("lat")
            lon = self.current_position.get("lon")
            if lat is not None and lon is not None:
                viewbox = (lon - VIEWBOX_DELTA_DEG, lat - VIEWBOX_DELTA_DEG, lon + VIEWBOX_DELTA_DEG, lat + VIEWBOX_DELTA_DEG)
        results = await self.geocoder.search(query, SearchOptions(viewbox=viewbox, limit=5))
        return [r.to_json() for r in results]

    async def build_route(self, destination: dict) -> dict | None:
        if not self.current_position:
            return None
        from_ll = (self.current_position["lon"], self.current_position["lat"])
        to_ll = (destination["lon"], destination["lat"])
        try:
            return await self.router.route(from_ll, to_ll, DEFAULT_PROFILE)
        except RouteError:
            return None


class AppState:
    """Хранит клиенты и scoped-состояние (без глобалов на time.time)."""

    def __init__(self) -> None:
        self.gigachat: GigaChatClient | None = None
        self.llm: GigaChatProvider | None = None
        self.geocoder: NominatimClient | None = None
        self.router: OsrmRouter | None = None
        self.sessions: SessionStore = global_store
        self.stt: SpeechToText | None = None


app_state = AppState()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # В тестах клиенты подставляются заранее — сеть не нужна
    if app_state.gigachat is not None:
        yield
        return
    load_env_file(HERE / ".env")
    auth_key = os.environ.get("GIGA_CHAT_AUTH_TOKEN")
    if not auth_key:
        raise RuntimeError("GIGA_CHAT_AUTH_TOKEN не задан (server/.env)")
    # Сессия должна жить всё время работы приложения: закрывать её до yield
    # нельзя, иначе первый же запрос к GigaChat упадёт с "Session is closed".
    async with make_session(make_ssl_context(HERE / "russian_trusted_root_ca.crt")) as session:
        app_state.gigachat = GigaChatClient(
            auth_key,
            aiohttp_transport(session),
            scope=os.environ.get("GIGA_CHAT_SCOPE", "GIGACHAT_API_PERS"),
        )
        app_state.llm = GigaChatProvider(app_state.gigachat)
        try:
            yield
        finally:
            app_state.gigachat = None
            app_state.llm = None


def _ensure_services() -> None:
    if app_state.geocoder is None:
        app_state.geocoder = NominatimClient()
    if app_state.router is None:
        app_state.router = OsrmRouter()


app = FastAPI(title="О.Ч.К.О. server", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/chat")
async def chat(request: Request) -> Response:
    """Тело GigaChat chat/completions пробрасывается как есть (обратная совместимость)."""
    if not app_state.gigachat:
        raise HTTPException(status_code=503, detail="GigaChat не инициализирован")
    try:
        res = await app_state.gigachat.chat(await request.body())
    except (GigaChatError, aiohttp.ClientError, TimeoutError) as err:
        log.exception("Ошибка запроса к GigaChat")
        return JSONResponse({"error": str(err)}, status_code=502)
    return Response(res.body, status_code=res.status, media_type="application/json")


@app.post("/geocode")
async def geocode(request: Request) -> Response:
    """Поиск адреса. Тело: {"query": str, "position": {lat, lon}|null, "limit": int}."""
    _ensure_services()
    body = await request.json()
    query = str(body.get("query", ""))
    position = body.get("position")
    limit = int(body.get("limit", 5))

    viewbox = None
    if position and position.get("lat") is not None and position.get("lon") is not None:
        lat = float(position["lat"])
        lon = float(position["lon"])
        viewbox = (lon - VIEWBOX_DELTA_DEG, lat - VIEWBOX_DELTA_DEG, lon + VIEWBOX_DELTA_DEG, lat + VIEWBOX_DELTA_DEG)
    try:
        results = await app_state.geocoder.search(query, SearchOptions(viewbox=viewbox, limit=limit))
    except GeocodeError as err:
        return JSONResponse({"error": str(err)}, status_code=502)
    return JSONResponse({"results": [r.to_json() for r in results]})


@app.post("/route")
async def route_endpoint(request: Request) -> Response:
    """Построить маршрут. Тело: {"from": {lat,lon}, "to": {lat,lon}, "profile": str}."""
    _ensure_services()
    body = await request.json()
    fr = body.get("from")
    to = body.get("to")
    if not fr or not to or "lat" not in fr or "lon" not in fr or "lat" not in to or "lon" not in to:
        return JSONResponse({"error": "Нужны from и to с полями lat/lon"}, status_code=400)
    profile = str(body.get("profile", DEFAULT_PROFILE))
    try:
        route = await app_state.router.route(
            (float(fr["lon"]), float(fr["lat"])),
            (float(to["lon"]), float(to["lat"])),
            profile,
        )
    except RouteError as err:
        return JSONResponse({"error": str(err)}, status_code=502)
    return JSONResponse({"route": route})


@app.post("/agent")
async def agent_endpoint(request: Request) -> Response:
    """Сессионный диалог агента.

    Тело: {"session_id": str|null, "user_text": str, "context": {position, nav_status}}.
    Ответ: {"session_id", "reply": {display, full, candidates, actions}}.
    """
    if not app_state.llm:
        return JSONResponse({"error": "LLM не инициализирован"}, status_code=503)
    _ensure_services()

    body = await request.json()
    session_id = body.get("session_id")
    user_text = str(body.get("user_text", ""))
    context_body = body.get("context") or {}
    position = context_body.get("position")
    nav_status = normalize_nav_status(context_body.get("nav_status"))

    port = ServerNavPort(app_state.geocoder, app_state.router)
    port.set_position(position)

    if session_id and (session := app_state.sessions.get(session_id)):
        agent = session.agent
        agent.nav = port
    else:
        agent = Agent(app_state.llm, port, context=lambda: AgentContext(now=time.localtime(), position=position, nav_status=nav_status))
        session = app_state.sessions.create(agent)

    # Контекст должен обновляться: привязываем актуальные данные к этому агенту на время запроса.
    agent.context = lambda: AgentContext(now=time.localtime(), position=position, nav_status=nav_status)
    agent.nav = port

    try:
        reply = await agent.ask(user_text)
    except LlmError as err:
        return JSONResponse({"error": str(err)}, status_code=502)

    payload = reply.to_json()
    payload["candidates"] = [c for c in (payload["candidates"] or [])]
    return JSONResponse({"session_id": session.id, "reply": payload})


@app.post("/stt")
async def stt_endpoint(request: Request) -> Response:
    """Распознавание речи из присланного аудио. Пока заглушка без ключей."""
    provider: SpeechToText = app_state.stt or UnconfiguredSpeechToText()
    body = await request.body()
    sample_rate = int(request.headers.get("X-Sample-Rate", "16000"))
    try:
        result = await provider.transcribe(body, sample_rate)
    except Exception as err:
        return JSONResponse({"error": str(err)}, status_code=501)
    return JSONResponse({"text": result.text, "confidence": result.confidence})


if __name__ == "__main__":
    import uvicorn

    load_env_file(HERE / ".env")
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("SERVER_PORT", "8787")))