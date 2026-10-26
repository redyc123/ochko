"""Сервер О.Ч.К.О. для мобильного приложения: прокси к GigaChat.

Держит GIGA_CHAT_AUTH_TOKEN вне бандла приложения и снимает CORS для веба.

Запуск: uv run main.py  (читает server/.env)
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

import aiohttp
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from gigachat import (
    GigaChatClient,
    GigaChatError,
    aiohttp_transport,
    make_session,
    make_ssl_context,
)

HERE = Path(__file__).resolve().parent
log = logging.getLogger("ochko-server")


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


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # В тестах клиент подставляется заранее — сеть не нужна
    if getattr(app.state, "gigachat", None) is not None:
        yield
        return
    load_env_file(HERE / ".env")
    auth_key = os.environ.get("GIGA_CHAT_AUTH_TOKEN")
    if not auth_key:
        raise RuntimeError("GIGA_CHAT_AUTH_TOKEN не задан (server/.env)")
    async with make_session(make_ssl_context(HERE / "russian_trusted_root_ca.crt")) as session:
        app.state.gigachat = GigaChatClient(
            auth_key,
            aiohttp_transport(session),
            scope=os.environ.get("GIGA_CHAT_SCOPE", "GIGACHAT_API_PERS"),
        )
        yield
        app.state.gigachat = None


app = FastAPI(title="О.Ч.К.О. server", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/chat")
async def chat(request: Request) -> Response:
    """Тело GigaChat chat/completions пробрасывается как есть."""
    client: GigaChatClient = request.app.state.gigachat
    try:
        res = await client.chat(await request.body())
    except (GigaChatError, aiohttp.ClientError, TimeoutError) as err:
        log.exception("Ошибка запроса к GigaChat")
        return JSONResponse({"error": str(err)}, status_code=502)
    return Response(res.body, status_code=res.status, media_type="application/json")


if __name__ == "__main__":
    import uvicorn

    load_env_file(HERE / ".env")
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("SERVER_PORT", "8787")))
