"""Тесты API-эндпоинтов /geocode, /route, /agent, /stt и /health.

Подставляем app_state.geocoder/router/llm, чтобы не ходить в сеть.
"""

import json
from collections.abc import Callable

from fastapi.testclient import TestClient

from agent import Agent
from geocode import GeocodeResult
from gigachat import GigaChatClient
from main import app, app_state


class FakeGeocoder:
    def __init__(self, results: list[dict]):
        self._results = results
        self.calls: list[str] = []

    async def search(self, query, options=None):
        self.calls.append(query)
        return [GeocodeResult(**r) for r in self._results]


class FakeRouter:
    def __init__(self, route: dict):
        self._route = route
        self.calls: list[tuple] = []

    async def route(self, from_ll, to_ll, profile):
        self.calls.append((from_ll, to_ll, profile))
        return self._route


class FakeLlmProvider:
    def __init__(self, reply: dict):
        self._reply = reply

    async def chat(self, messages, functions):
        return dict(self._reply)


def make_client() -> TestClient:
    # Dummy, чтобы lifespan не пытался читать .env и ходить за токеном в сеть.
    app_state.gigachat = object.__new__(GigaChatClient)
    return TestClient(app)


def test_health():
    with make_client() as http:
        assert http.get("/health").json() == {"ok": True}


def test_geocode_endpoint():
    app_state.geocoder = FakeGeocoder(
        [{"displayName": "Театр, Москва", "lat": 55.75, "lon": 37.6, "type": "theatre", "importance": 0.9}]
    )
    with make_client() as http:
        res = http.post("/geocode", json={"query": "театр", "position": {"lat": 55.7, "lon": 37.6}})
    assert res.status_code == 200
    body = res.json()
    assert body["results"][0]["displayName"] == "Театр, Москва"


def test_route_endpoint():
    app_state.router = FakeRouter({"distanceMeters": 900, "durationSeconds": 300, "maneuvers": [], "shape": [], "profile": "pedestrian"})
    with make_client() as http:
        res = http.post(
            "/route",
            json={"from": {"lat": 55.7, "lon": 37.6}, "to": {"lat": 55.75, "lon": 37.7}, "profile": "pedestrian"},
        )
    assert res.status_code == 200
    assert res.json()["route"]["distanceMeters"] == 900


def test_route_endpoint_requires_from_to():
    with make_client() as http:
        res = http.post("/route", json={"to": {"lat": 1, "lon": 1}})
    assert res.status_code == 400


def test_agent_endpoint_text_reply():
    fake_llm = FakeLlmProvider({"kind": "text", "text": "Здравствуйте."})
    app_state.llm = fake_llm
    app_state.geocoder = FakeGeocoder([])
    app_state.router = FakeRouter({})
    with make_client() as http:
        res = http.post("/agent", json={"user_text": "привет", "context": {}})
    assert res.status_code == 200
    body = res.json()
    assert body["session_id"]
    assert body["reply"]["display"] == "Здравствуйте."
    assert body["reply"]["full"] == "Здравствуйте."


def test_agent_endpoint_accepts_string_nav_status():
    seen: list[list[dict]] = []

    class RecordingLlm:
        async def chat(self, messages, functions):
            seen.append(messages)
            return {"kind": "text", "text": "Ок."}

    app_state.llm = RecordingLlm()
    app_state.geocoder = FakeGeocoder([])
    app_state.router = FakeRouter({})
    with make_client() as http:
        res = http.post(
            "/agent",
            json={"user_text": "где я?", "context": {"nav_status": "navigating"}},
        )
    assert res.status_code == 200
    assert "Навигация: navigating" in seen[0][0]["content"]


def test_agent_endpoint_single_candidate_start_route():
    class ChainedLlm:
        def __init__(self, replies):
            self._replies = list(replies)

        async def chat(self, messages, functions):
            return self._replies.pop(0)

    app_state.llm = ChainedLlm(
        [
            {
                "kind": "functionCall",
                "call": {"name": "navigate_to", "arguments": {"query": "театр"}},
            },
            {"kind": "text", "text": "Маршрут до театра построен."},
        ]
    )
    app_state.geocoder = FakeGeocoder(
        [{"displayName": "Театр, Москва", "lat": 55.75, "lon": 37.6, "type": "theatre", "importance": 0.9}]
    )
    app_state.router = FakeRouter(
        {"distanceMeters": 1200, "durationSeconds": 900, "maneuvers": [], "shape": [{"lat": 55.75, "lon": 37.6}], "profile": "pedestrian"}
    )
    with make_client() as http:
        res = http.post(
            "/agent",
            json={"user_text": "отвези в театр", "context": {"position": {"lat": 55.7, "lon": 37.6}, "nav_status": {"status": "idle"}}},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["session_id"]
    actions = body["reply"]["actions"]
    assert len(actions) == 1
    assert actions[0]["type"] == "start_route"
    assert actions[0]["route"]["distanceMeters"] == 1200


def test_agent_endpoint_no_llm_503():
    app_state.llm = None
    with make_client() as http:
        res = http.post("/agent", json={"user_text": "привет", "context": {}})
    assert res.status_code == 503


def test_lifespan_keeps_gigachat_session_open(monkeypatch):
    """Сессия GigaChat должна жить всё время работы, а не закрываться до yield."""
    import main as main_module

    state = {"closed": False}

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            state["closed"] = True

    monkeypatch.setattr(main_module, "make_ssl_context", lambda path: object())
    monkeypatch.setattr(main_module, "make_session", lambda ctx: FakeSession())
    monkeypatch.setattr(main_module, "GigaChatClient", lambda *args, **kwargs: object())
    monkeypatch.setattr(main_module, "GigaChatProvider", lambda client: object())
    monkeypatch.setenv("GIGA_CHAT_AUTH_TOKEN", "test-token")
    monkeypatch.setattr(main_module.app_state, "gigachat", None)
    monkeypatch.setattr(main_module.app_state, "llm", None)

    with TestClient(main_module.app):
        assert state["closed"] is False
        assert main_module.app_state.gigachat is not None
        assert main_module.app_state.llm is not None

    assert state["closed"] is True