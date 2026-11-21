import json

import pytest

from agent import (
    AGENT_TEXT_MAX_CHARS,
    Agent,
    AgentContext,
    StartRouteAction,
    StopNavigationAction,
    normalize_nav_status,
    to_display_text,
)
from llm import GigaChatProvider, parse_gigachat_reply, to_gigachat_messages
from maneuver_map import ManeuverIcon, map_osrm_maneuver_to_icon
from parsechoice import parse_choice
from polyline import decode_polyline6, encode_polyline6
from router import build_osrm_url, parse_osrm_response
from tools import format_distance_short_ru, format_duration_ru, short_place_name


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


# --- polyline ---

def test_polyline6_roundtrip():
    pts = [(55.7558, 37.6173), (55.7511, 37.6173), (55.7500, 37.6000)]
    assert decode_polyline6(encode_polyline6(pts)) == pts


def test_polyline6_decodes_coordinates():
    # Известная строка, закодированная вручную тем же алгоритмом
    pts = decode_polyline6(encode_polyline6([(59.91, 30.31)]))
    assert abs(pts[0][0] - 59.91) < 1e-5
    assert abs(pts[0][1] - 30.31) < 1e-5


# --- maneuver mapping ---

def test_fork_keep_right():
    assert map_osrm_maneuver_to_icon("fork", "right") == ManeuverIcon.KEEP_RIGHT
    assert map_osrm_maneuver_to_icon("fork", "left") == ManeuverIcon.KEEP_LEFT


def test_fixed_types():
    assert map_osrm_maneuver_to_icon("depart") == ManeuverIcon.START
    assert map_osrm_maneuver_to_icon("arrive") == ManeuverIcon.ARRIVE
    assert map_osrm_maneuver_to_icon("roundabout") == ManeuverIcon.ROUNDABOUT


def test_unknown_type_none():
    assert map_osrm_maneuver_to_icon("bogus") == ManeuverIcon.NONE


def test_modifier_turns():
    assert map_osrm_maneuver_to_icon("turn", "left") == ManeuverIcon.LEFT
    assert map_osrm_maneuver_to_icon("continue", "slight right") == ManeuverIcon.SLIGHT_RIGHT


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


# --- router ---

def test_build_osrm_url_order_lon_lat():
    url = build_osrm_url("https://routing.openstreetmap.de", (37.6, 55.75), (37.7, 55.76), "pedestrian")
    assert "routed-foot/route/v1/foot/37.6,55.75;37.7,55.76" in url


def test_parse_osrm_response_builds_route():
    # Один шаг, geometry в polyline6 одной точки
    single = encode_polyline6([(55.75, 37.6)])
    data = {
        "code": "Ok",
        "routes": [{"distance": 1000, "duration": 300, "legs": [{"steps": [
            {"distance": 1000, "duration": 300, "name": "Тверская", "geometry": single,
             "maneuver": {"type": "arrive", "modifier": "straight"}},
        ]}]}],
    }
    route = parse_osrm_response(data, "pedestrian")
    assert route["distanceMeters"] == 1000
    assert route["maneuvers"][0]["type"] == ManeuverIcon.ARRIVE
    assert route["maneuvers"][0]["streetNames"] == ["Тверская"]
    assert route["profile"] == "pedestrian"


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