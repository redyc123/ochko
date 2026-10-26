import json

from fastapi.testclient import TestClient

from gigachat import CHAT_URL, OAUTH_URL, GigaChatClient, Response
from main import app


class FakeTransport:
    def __init__(self, chat_statuses: list[int], oauth_status: int = 200) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.chat_statuses = chat_statuses
        self.oauth_status = oauth_status
        self.tokens_issued = 0

    async def __call__(self, url: str, headers: dict[str, str], body: bytes) -> Response:
        self.calls.append((url, headers))
        if url == OAUTH_URL:
            if self.oauth_status != 200:
                return Response(self.oauth_status, b"denied")
            self.tokens_issued += 1
            data = {"access_token": f"t{self.tokens_issued}", "expires_at": 1_800_000 * 1000}
            return Response(200, json.dumps(data).encode())
        return Response(self.chat_statuses.pop(0), b'{"choices":[]}')


async def test_token_is_cached() -> None:
    t = FakeTransport([200, 200])
    client = GigaChatClient("key", t, now=lambda: 1_000_000)
    await client.chat(b"{}")
    await client.chat(b"{}")
    assert t.tokens_issued == 1
    assert t.calls[0][1]["Authorization"] == "Basic key"
    assert t.calls[1][0] == CHAT_URL
    assert t.calls[1][1]["Authorization"] == "Bearer t1"


async def test_token_refreshed_near_expiry() -> None:
    t = FakeTransport([200, 200])
    now = [1_000_000.0]
    client = GigaChatClient("key", t, now=lambda: now[0])
    await client.chat(b"{}")
    now[0] = 1_800_000 - 30  # меньше минуты до истечения
    await client.chat(b"{}")
    assert t.tokens_issued == 2


async def test_retry_once_on_401() -> None:
    t = FakeTransport([401, 200])
    client = GigaChatClient("key", t, now=lambda: 1_000_000)
    res = await client.chat(b"{}")
    assert res.status == 200
    assert t.tokens_issued == 2
    assert t.calls[-1][1]["Authorization"] == "Bearer t2"


def test_chat_endpoint_proxies_and_sets_cors() -> None:
    app.state.gigachat = GigaChatClient("key", FakeTransport([200]), now=lambda: 1_000_000)
    with TestClient(app) as http:
        res = http.post("/chat", content=b"{}", headers={"Origin": "http://localhost:8081"})
    assert res.status_code == 200
    assert res.json() == {"choices": []}
    assert res.headers["access-control-allow-origin"] == "*"


def test_chat_endpoint_oauth_failure_is_502() -> None:
    app.state.gigachat = GigaChatClient(
        "key", FakeTransport([], oauth_status=401), now=lambda: 1_000_000
    )
    with TestClient(app) as http:
        res = http.post("/chat", content=b"{}")
    assert res.status_code == 502
    assert "401" in res.json()["error"]
