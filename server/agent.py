"""Ядро LLM-агента (порт `client/src/agent/agent.ts`).

Агент уехал целиком на сервер: он сам делает геокодинг и роутинг (через
внедрённый port), а побочные эффекты, которые надо исполнить на клиенте
(старт/останов маршрута), собирает в `actions` и отдаёт вместе с ответом.
Клиент исполняет actions в рамках сессии и шлёт результаты тул-вызовов обратно.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from llm import LlmError
from parsechoice import parse_choice
from tools import (
    AGENT_FUNCTIONS,
    format_distance_short_ru,
    format_duration_ru,
    short_place_name,
)

AGENT_TEXT_MAX_CHARS = 60
MAX_HISTORY_MESSAGES = 20
MAX_TOOL_STEPS = 4
MAX_CANDIDATES = 5

SYSTEM_PROMPT = (
    "Ты — голосовой ассистент смарт-очков. Отвечай по-русски, коротко и по делу: "
    "ответ показывается на маленьком экране очков, первые ~60 символов — самое важное. "
    "Без markdown, списков и эмодзи, если о них не просят. Отвечай на любые вопросы пользователя. "
    "Если просят проложить маршрут, отвести или подсказать дорогу — вызывай navigate_to. "
    "Если navigate_to вернул несколько вариантов — НЕ выбирай сам: коротко перечисли их с номерами "
    "и спроси, какой нужен. Когда пользователь ответит — вызови choose_destination с номером. "
    "Если ничего не найдено — попроси уточнить адрес."
)


@dataclass
class AgentContext:
    now: "object" = None
    position: dict | None = None
    nav_status: dict = field(default_factory=dict)


class NavPort:
    """Серверный порт к навигации: геокодинг и роутинг живут здесь."""

    async def search(self, query: str) -> list[dict]:
        raise NotImplementedError

    async def build_route(self, destination: dict) -> dict | None:
        """Строит маршрут от текущей позиции до destination; None — невозможно."""
        raise NotImplementedError


@dataclass
class Action:
    def to_json(self) -> dict:
        raise NotImplementedError


@dataclass
class StartRouteAction(Action):
    destination: dict
    route: dict

    def to_json(self) -> dict:
        return {"type": "start_route", "destination": self.destination, "route": self.route}


@dataclass
class StopNavigationAction(Action):
    def to_json(self) -> dict:
        return {"type": "stop_navigation"}


@dataclass
class AgentReply:
    display: str
    full: str
    candidates: list = field(default_factory=list)
    actions: list = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "display": self.display,
            "full": self.full,
            "candidates": list(self.candidates),
            "actions": [a.to_json() for a in self.actions],
        }


def normalize_nav_status(value) -> dict:
    """Приводит nav_status к словарю.

    Клиент шлёт строку NavStatus ('idle', 'navigating', ...), но агент и тесты
    работают с объектом {status, destinationName}. Принимаем оба варианта.
    """
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        return {"status": value.strip()}
    return {}


def to_display_text(text: str, max_chars: int = AGENT_TEXT_MAX_CHARS) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    chars = list(clean)
    if len(chars) <= max_chars:
        return clean
    cut = "".join(chars[: max_chars - 1])
    last_space = cut.rfind(" ")
    return (cut[:last_space] if last_space > max_chars / 2 else cut) + "…"


class Agent:
    def __init__(self, llm, nav: NavPort, context=None) -> None:
        self.llm = llm
        self.nav = nav
        self.context = context or (lambda: AgentContext())
        self.history: list[dict] = []
        self.pending: list[dict] = []
        self.actions: list[Action] = []

    @property
    def pending_candidates(self) -> list[dict]:
        return self.pending

    def clear_pending(self) -> None:
        self.pending = []

    def reset(self) -> None:
        self.history = []
        self.pending = []
        self.actions = []

    async def ask(self, text: str) -> AgentReply:
        user_text = text.strip()
        if not user_text:
            return self.reply("Не расслышал, повторите.")

        # Быстрый путь: ответ на уточнение адреса без похода в LLM
        if self.pending:
            choice = parse_choice(user_text, len(self.pending))
            if choice is not None:
                self.history.append({"role": "user", "content": user_text})
                if choice["kind"] == "cancel":
                    self.pending = []
                    answer = "Хорошо, маршрут не строю."
                else:
                    res = await self.choose_index(choice["index"])
                    answer = res["message"] if res.get("ok") else res.get("error", "Не вышло.")
                self.history.append({"role": "assistant", "content": answer})
                self.trim_history()
                return self.reply(answer)

        self.history.append({"role": "user", "content": user_text})
        try:
            for _ in range(MAX_TOOL_STEPS):
                result = await self.llm.chat(self.build_messages(), AGENT_FUNCTIONS)
                if result["kind"] == "text":
                    answer = result.get("text") or "Не знаю, что ответить."
                    self.history.append({"role": "assistant", "content": answer})
                    self.trim_history()
                    return self.reply(answer)

                call = result["call"]
                self.history.append(
                    {
                        "role": "assistant",
                        "content": "",
                        "functionCall": call,
                        "functionsStateId": result.get("functionsStateId"),
                    }
                )
                output = await self.run_tool(call["name"], call.get("arguments", {}))
                self.history.append(
                    {
                        "role": "function",
                        "name": call["name"],
                        "content": _json(output),
                    }
                )
            return self.reply("Не получилось выполнить запрос.")
        except LlmError as err:
            self.drop_dangling_turn()
            return self.reply(str(err))

    def reply(self, full: str) -> AgentReply:
        actions = list(self.actions)
        self.actions = []
        return AgentReply(display=to_display_text(full), full=full, candidates=list(self.pending), actions=actions)

    def build_messages(self) -> list[dict]:
        return [{"role": "system", "content": f"{SYSTEM_PROMPT}\n{self._build_facts()}"}, *self.history]

    def _build_facts(self) -> str:
        ctx = self.context()
        facts = []
        if ctx.now is not None:
            try:
                facts.append(f"Сейчас {ctx.now.strftime('%d.%m.%Y %H:%M')}.")
            except Exception:
                facts.append(f"Сейчас {ctx.now}.")
        if ctx.position:
            facts.append(f"Пользователь в точке {ctx.position['lat']}, {ctx.position['lon']}.")
        else:
            facts.append("Положение пользователя неизвестно.")
        nav = normalize_nav_status(ctx.nav_status)
        dest = nav.get("destinationName")
        facts.append(
            f"Навигация: {nav.get('status')}, цель — {dest}." if dest else f"Навигация: {nav.get('status')}."
        )
        if self.pending:
            names = "; ".join(f"{i + 1}) {short_place_name(c['displayName'])}" for i, c in enumerate(self.pending))
            facts.append(f"Ждём выбора адреса: {names}.")
        return " ".join(facts)

    async def run_tool(self, name: str, args: dict) -> dict:
        if name == "navigate_to":
            return await self.navigate_to(str(args.get("query", "")))
        if name == "choose_destination":
            n = int(args.get("number", 0))
            if n < 1 or n > len(self.pending):
                return {"error": "Нет варианта с таким номером."}
            res = await self.choose_index(n - 1)
            return res if res.get("ok") else {"error": res.get("error", "Не вышло.")}
        if name == "stop_navigation":
            self.pending = []
            self.actions.append(StopNavigationAction())
            return {"result": "Навигация остановлена."}
        if name == "get_navigation_status":
            return normalize_nav_status(self.context().nav_status)
        return {"error": f"Неизвестная функция {name}"}

    async def navigate_to(self, query: str) -> dict:
        if not query.strip():
            return {"error": "Пустой адрес."}
        try:
            results = await self.nav.search(query)
        except Exception:
            return {"error": "Нет сети: не удалось найти адрес."}

        self.pending = []
        if not results:
            return {"found": 0, "error": "Ничего не найдено, попроси уточнить адрес."}
        if len(results) == 1:
            return await self._plan_route(results[0])
        self.pending = results[:MAX_CANDIDATES]
        return {
            "found": len(self.pending),
            "need_clarification": True,
            "candidates": [
                {"number": i + 1, "name": short_place_name(c["displayName"])}
                for i, c in enumerate(self.pending)
            ],
        }

    async def choose_index(self, index: int) -> dict:
        candidate = self.pending[index]
        self.pending = []
        return await self._plan_route(candidate)

    async def _plan_route(self, candidate: dict) -> dict:
        """Строит маршрут и отдаёт его клиенту как action; для LLM — только описание."""
        route = await self.nav.build_route(candidate)
        if route is None:
            return {"error": "Не удалось построить маршрут."}
        self.actions.append(StartRouteAction(candidate, route))
        return {
            "result": (
                f'Маршрут до «{short_place_name(candidate["displayName"])}»: '
                f"{format_distance_short_ru(route['distanceMeters'])}, "
                f"{format_duration_ru(route['durationSeconds'])}. Уточните, если нужно."
            )
        }

    def trim_history(self) -> None:
        if len(self.history) <= MAX_HISTORY_MESSAGES:
            return
        start = len(self.history) - MAX_HISTORY_MESSAGES
        while start < len(self.history) and self.history[start]["role"] != "user":
            start += 1
        self.history = self.history[start:]

    def drop_dangling_turn(self) -> None:
        for i in range(len(self.history) - 1, -1, -1):
            if self.history[i]["role"] == "user":
                self.history = self.history[:i]
                return


def _json(obj) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False)