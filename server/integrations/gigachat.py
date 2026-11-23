"""Клиент GigaChat: OAuth-токен с кэшем и проброс запросов chat/completions.

Корневой сертификат Минцифры (russian_trusted_root_ca.crt) добавляется к
системным — без него TLS к серверам Сбера не проходит.
"""

from __future__ import annotations

import asyncio
import json
import ssl
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

import aiohttp

OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
CHAT_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"
# Обновляем токен заранее, чтобы запрос не умер на полпути.
TOKEN_REFRESH_MARGIN_S = 60
REQUEST_TIMEOUT_S = 60


@dataclass
class Response:
    status: int
    body: bytes


Transport = Callable[[str, dict[str, str], bytes], Awaitable[Response]]


def make_ssl_context(ca_file: Path) -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.load_verify_locations(cafile=str(ca_file))
    return ctx


def make_session(ctx: ssl.SSLContext) -> aiohttp.ClientSession:
    return aiohttp.ClientSession(
        connector=aiohttp.TCPConnector(ssl=ctx),
        timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S),
    )


def aiohttp_transport(session: aiohttp.ClientSession) -> Transport:
    async def send(url: str, headers: dict[str, str], body: bytes) -> Response:
        async with session.post(url, headers=headers, data=body) as res:
            return Response(res.status, await res.read())

    return send


class GigaChatError(Exception):
    pass


class GigaChatClient:
    def __init__(
        self,
        auth_key: str,
        transport: Transport,
        scope: str = "GIGACHAT_API_PERS",
        now: Callable[[], float] = time.time,
    ) -> None:
        self._auth_key = auth_key
        self._transport = transport
        self._scope = scope
        self._now = now
        self._token: str | None = None
        self._expires_at_s = 0.0
        # Параллельные запросы не должны получать токен каждый сам по себе
        self._lock = asyncio.Lock()

    async def access_token(self, force: bool = False) -> str:
        async with self._lock:
            if (
                not force
                and self._token is not None
                and self._now() < self._expires_at_s - TOKEN_REFRESH_MARGIN_S
            ):
                return self._token
            res = await self._transport(
                OAUTH_URL,
                {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                    "RqUID": str(uuid.uuid4()),
                    "Authorization": f"Basic {self._auth_key}",
                },
                f"scope={self._scope}".encode(),
            )
            if res.status != 200:
                raise GigaChatError(
                    f"OAuth GigaChat ответил {res.status}: {res.body.decode(errors='replace')}"
                )
            data = json.loads(res.body)
            token: str = data["access_token"]
            self._token = token
            # expires_at приходит в миллисекундах
            self._expires_at_s = data["expires_at"] / 1000
            return token

    async def chat(self, body: bytes) -> Response:
        """Пробрасывает тело chat/completions как есть; при 401 — один повтор с новым токеном."""
        res = await self._send_chat(body, await self.access_token())
        if res.status == 401:
            res = await self._send_chat(body, await self.access_token(force=True))
        return res

    async def _send_chat(self, body: bytes, token: str) -> Response:
        return await self._transport(
            CHAT_URL,
            {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {token}",
            },
            body,
        )
