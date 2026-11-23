"""Ядро LLM-агента (порт `client/src/agent/agent.ts`).

Агент уехал целиком на сервер: он сам делает геокодинг и роутинг (через
внедрённый port), а побочные эффекты, которые надо исполнить на клиенте
(старт/останов маршрута), собирает в `actions` и отдаёт вместе с ответом.
Клиент исполняет actions в рамках сессии и шлёт результаты тул-вызовов обратно.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .llm import LlmError
from .parsechoice import parse_choice
from .tools import (
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
    "Если после пяти попыток не найден подходящий адрес рядом — предложи переформулировать запрос, "
    "повторить попытку позже или указать точку на карте в приложении. Не выбирай адрес в другом городе. "
    "Если маршрут слишком длинный для пешего перехода — не предлагай его, а попроси более близкий адрес. "
    "Используй расстояние, время и следующий манёвр из контекста навигации, не выдумывай их. "
    "Учитывай результаты действий на клиенте: failed означает, что действие не выполнено."
)


@dataclass
class AgentContext:
    now: "object" = None
    position: dict | None = None
    nav_status: dict | str = field(default_factory=dict)
    action_results: list[dict] = field(default_factory=list)


class NavError(Exception):
    def __init__(self, message: str, code: str = "nav_error") -> None:
        super().__init__(message)
        self.code = code


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
                    answer = res.get("result") or res.get("error") or "Не вышло."
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
        distance = nav.get("remainingDistanceMeters")
        duration = nav.get("remainingDurationSeconds")
        if isinstance(distance, (int, float)):
            facts.append(f"Осталось {format_distance_short_ru(distance)}.")
        if isinstance(duration, (int, float)):
            facts.append(f"Примерное время в пути: {format_duration_ru(duration)}.")
        maneuver = nav.get("nextManeuver")
        if isinstance(maneuver, dict):
            kind = maneuver.get("kind", "unknown")
            streets = ", ".join(maneuver.get("streetNames") or []) or "улица не указана"
            maneuver_distance = maneuver.get("distanceToManeuverMeters")
            distance_text = (
                f" через {format_distance_short_ru(maneuver_distance)}"
                if isinstance(maneuver_distance, (int, float))
                else ""
            )
            facts.append(f"Следующий манёвр: {kind}, {streets}{distance_text}.")
        if nav.get("gpsOk") is False:
            facts.append("GPS: нет актуального сигнала.")
        if ctx.action_results:
            facts.append(f"Результаты последних действий на клиенте: {_json(ctx.action_results)}.")
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
            return {"error": res["error"]} if "error" in res else res
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
        except NavError as err:
            self.pending = []
            return {"found": 0, "code": err.code, "error": str(err)}
        except Exception:
            self.pending = []
            return {"found": 0, "code": "geocode_unavailable", "error": "Нет сети: не удалось найти адрес. Повторите позже или укажите точку на карте в приложении."}

        self.pending = []
        if not results:
            return {
                "found": 0,
                "code": "local_address_not_found",
                "error": (
                    "Подходящий адрес рядом не найден после пяти попыток. "
                    "Предложи переформулировать запрос, повторить позже или указать точку на карте в приложении."
                ),
            }
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
        try:
            route = await self.nav.build_route(candidate)
        except NavError as err:
            return {"code": err.code, "error": str(err)}
        if route is None:
            return {"code": "route_unavailable", "error": "Не удалось построить маршрут. Выберите другую точку или повторите позже."}
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