import pytest

from agent.core import (
    Agent,
    AgentContext,
    StartRouteAction,
    StopNavigationAction,
    normalize_nav_status,
)
from agent.llm import parse_gigachat_reply, to_gigachat_messages
from agent.parsechoice import parse_choice
from agent.tools import format_distance_short_ru, format_duration_ru, short_place_name


class FakeLlm:
    """Планируемые ответы модели: [(reply_dict), ...], расходуются по одному на chat()."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = 0

    async def chat(self, messages, functions):
        self.calls += 1
        return self.replies.pop(0)


class FakeNav:
    def __init__(self, search_results=None, route=None):
        self._results = search_results or []
        self._route = route
        self.searched = []

    async def search(self, query):
        self.searched.append(query)
        return self._results

    async def build_route(self, destination):
        return self._route


# --- parsechoice ---

def test_parsechoice_index_and_cancel():
    assert parse_choice("второй", 3) == {"kind": "index", "index": 1}
    assert parse_choice("номер 3", 3) == {"kind": "index", "index": 2}
    assert parse_choice("давай последний", 3) == {"kind": "index", "index": 2}
    assert parse_choice("отмена", 3) == {"kind": "cancel"}
    assert parse_choice("не надо", 3) == {"kind": "cancel"}
    assert parse_choice("найди кафе", 3) is None


# --- tools ---

def test_formatting():
    assert short_place_name("Пятёрочка, 12, Тверская улица, Тверской район, Москва") == (
        "Пятёрочка, 12, Тверская улица"
    )
    assert format_duration_ru(90) == "2 мин"
    assert format_duration_ru(3600) == "1 ч"
    assert format_distance_short_ru(500) == "500 м"
    assert format_distance_short_ru(1500) == "1,5 км"


# --- llm ---

def test_to_gigachat_messages_function_call():
    msgs = [
        {"role": "user", "content": "привет"},
        {"role": "assistant", "content": "", "functionCall": {"name": "navigate_to", "arguments": {"query": "X"}}},
        {"role": "function", "name": "navigate_to", "content": "{}"},
    ]
    out = to_gigachat_messages(msgs)
    assert out[1]["function_call"]["name"] == "navigate_to"
    assert out[2]["role"] == "function"


def test_parse_gigachat_text():
    assert parse_gigachat_reply({"choices": [{"message": {"content": " Привет "}}]}) == {
        "kind": "text",
        "text": "Привет",
    }


def test_parse_gigachat_function_call():
    data = {
        "choices": [
            {
                "message": {
                    "content": "",
                    "function_call": {"name": "get_navigation_status", "arguments": "{}"},
                }
            }
        ]
    }
    r = parse_gigachat_reply(data)
    assert r["kind"] == "functionCall"
    assert r["call"]["name"] == "get_navigation_status"


# --- agent ---

async def test_agent_text_reply():
    agent = Agent(FakeLlm([{"kind": "text", "text": "Здравствуй."}]), FakeNav())
    reply = await agent.ask("привет")
    assert reply.full == "Здравствуй."


async def test_agent_single_navigate_emits_start_route():
    nav = FakeNav(
        search_results=[{"displayName": "Театр, Москва", "lat": 55.75, "lon": 37.6}],
        route={"distanceMeters": 1200, "durationSeconds": 900},
    )
    agent = Agent(
        FakeLlm([{"kind": "functionCall", "call": {"name": "navigate_to", "arguments": {"query": "театр"}}}]),
        nav,
    )
    agent.llm.replies.append({"kind": "text", "text": "Куда-то"})
    reply = await agent.ask("отвези в театр")
    assert any(isinstance(a, StartRouteAction) for a in reply.actions)


async def test_agent_pending_clarification_then_choose():
    nav = FakeNav(
        search_results=[
            {"displayName": "Первый, Москва", "lat": 1, "lon": 1},
            {"displayName": "Второй, Москва", "lat": 2, "lon": 2},
        ],
        route={"distanceMeters": 500, "durationSeconds": 200},
    )
    # 1) navigate_to -> несколько результатов (ещё до LLM ответа об уточнении)
    agent = Agent(
        FakeLlm([{"kind": "functionCall", "call": {"name": "navigate_to", "arguments": {"query": "куда"}}}]),
        nav,
    )
    agent.llm.replies.append({"kind": "text", "text": "Какой вариант?"})
    reply1 = await agent.ask("отвези куда-нибудь")
    assert len(reply1.candidates) == 2  # ожидаем список для выбора

    # 2) пользователь выбирает «второй» -> без LLM, происходит choose_destination
    agent2 = agents_with_history_hack(agent)
    reply2 = await agent2.ask("второй")
    assert any(isinstance(a, StartRouteAction) for a in reply2.actions)
    assert reply2.full.startswith("Маршрут до «Второй, Москва»")


async def test_agent_choose_destination_tool_reports_success():
    agent = Agent(FakeLlm([]), FakeNav(route={"distanceMeters": 500, "durationSeconds": 200}))
    agent.pending = [{"displayName": "Первый, Москва", "lat": 1, "lon": 1}]

    result = await agent.run_tool("choose_destination", {"number": 1})

    assert "result" in result
    assert "error" not in result
    assert any(isinstance(a, StartRouteAction) for a in agent.actions)


def agents_with_history_hack(agent):
    """Возвращает нового агента, но переносит историю/ожидания из первого."""
    agent2 = Agent(agent.llm, agent.nav, context=agent.context)
    agent2.history = agent.history
    agent2.pending = agent.pending
    return agent2


async def test_agent_stop_navigation_action():
    agent = Agent(
        FakeLlm([{"kind": "functionCall", "call": {"name": "stop_navigation", "arguments": {}}}]),
        FakeNav(),
    )
    agent.llm.replies.append({"kind": "text", "text": "Стоп"})
    reply = await agent.ask("стоп")
    assert any(isinstance(a, StopNavigationAction) for a in reply.actions)


# --- nav_status ---

def test_normalize_nav_status():
    assert normalize_nav_status("navigating") == {"status": "navigating"}
    assert normalize_nav_status({"status": "idle"}) == {"status": "idle"}
    assert normalize_nav_status(None) == {}
    assert normalize_nav_status("") == {}


def test_build_facts_accepts_string_nav_status():
    agent = Agent(
        FakeLlm([]),
        FakeNav(),
        context=lambda: AgentContext(nav_status="navigating"),
    )
    facts = agent._build_facts()
    assert "Навигация: navigating" in facts


def test_build_facts_includes_destination_name():
    agent = Agent(
        FakeLlm([]),
        FakeNav(),
        context=lambda: AgentContext(
            nav_status={"status": "navigating", "destinationName": "Театр"}
        ),
    )
    facts = agent._build_facts()
    assert "цель — Театр" in facts


def test_build_facts_includes_navigation_progress():
    agent = Agent(
        FakeLlm([]),
        FakeNav(),
        context=lambda: AgentContext(
            nav_status={
                "status": "navigating",
                "destinationName": "Театр",
                "remainingDistanceMeters": 650,
                "remainingDurationSeconds": 480,
                "nextManeuver": {
                    "kind": "right",
                    "streetNames": ["Тверская улица"],
                    "distanceToManeuverMeters": 80,
                },
                "gpsOk": False,
            }
        ),
    )

    facts = agent._build_facts()

    assert "Осталось 650 м." in facts
    assert "Примерное время в пути: 8 мин." in facts
    assert "Следующий манёвр: right, Тверская улица через 80 м." in facts
    assert "GPS: нет актуального сигнала." in facts


def test_build_facts_includes_client_action_results():
    agent = Agent(
        FakeLlm([]),
        FakeNav(),
        context=lambda: AgentContext(
            action_results=[{"type": "start_route", "status": "applied"}]
        ),
    )

    facts = agent._build_facts()

    assert "Результаты последних действий на клиенте" in facts
    assert '"type": "start_route"' in facts
    assert '"status": "applied"' in facts
