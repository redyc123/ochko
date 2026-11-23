"""Хранилище сессий диалога агента.

Агент помнит историю и ожидание выбора адреса между запросами клиента.
In-memory, без персистентности — достаточно для одного сервера.
"""

from __future__ import annotations

import threading
import uuid
from typing import Any

from .core import Agent


class Session:
    def __init__(self, agent: Agent) -> None:
        self.id = uuid.uuid4().hex
        self.agent = agent
        self.created_ms: int | None = None

    def to_json(self) -> str:
        return self.id


class SessionStore:
    """Потокобезопасное in-memory хранилище сессий."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, Session] = {}

    def get(self, session_id: str) -> Session | None:
        with self._lock:
            return self._sessions.get(session_id)

    def create(self, agent: Agent) -> Session:
        s = Session(agent)
        with self._lock:
            self._sessions[s.id] = s
        return s

    def remove(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)


# Глобальный экземпляр, используемый эндпоинтом /agent.
global_store = SessionStore()