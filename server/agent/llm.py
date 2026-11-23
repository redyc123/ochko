"""Адаптер LLM для агента (порт `client/src/agent/llm.ts`).

Сводит сообщения агента к формату GigaChat `chat/completions` и разбирает ответ
(текст или function_call). Сам транспорт — `gigachat.GigaChatClient`.
"""

from __future__ import annotations

import json


class LlmError(Exception):
    pass


class LlmProvider:
    """Интерфейс — агент работает с любым провайдером."""

    async def chat(self, messages: list[dict], functions: list[dict]) -> dict:
        raise NotImplementedError


def to_gigachat_messages(messages: list[dict]) -> list[dict]:
    """Сообщения в формате GigaChat: аргументы функции — объект, результат — role "function"."""
    out: list[dict] = []
    for m in messages:
        role = m.get("role")
        if role == "assistant" and m.get("functionCall"):
            item: dict = {"role": "assistant", "content": m.get("content", "")}
            fc = m["functionCall"]
            call: dict = {"name": fc["name"], "arguments": fc.get("arguments", {})}
            if m.get("functionsStateId"):
                call["functions_state_id"] = m["functionsStateId"]
            item["function_call"] = call
            out.append(item)
        elif role == "function":
            out.append({"role": "function", "name": m.get("name", ""), "content": m.get("content", "")})
        else:
            out.append({"role": role, "content": m.get("content", "")})
    return out


def parse_gigachat_reply(data) -> dict:
    """Разбирает ответ GigaChat `chat/completions` -> text или function_call."""
    choices = (data or {}).get("choices") or []
    message = (choices[0].get("message") if choices else None) or {}
    fc = message.get("function_call")
    if isinstance(fc, dict) and isinstance(fc.get("name"), str):
        args = fc.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except (ValueError, TypeError):
                args = {}
        elif not isinstance(args, dict):
            args = {}
        state_id = message.get("functions_state_id")
        result: dict = {
            "kind": "functionCall",
            "call": {"name": fc["name"], "arguments": args},
        }
        if isinstance(state_id, str):
            result["functionsStateId"] = state_id
        return result
    text = str(message.get("content", "") if message else "").strip()
    return {"kind": "text", "text": text}


class GigaChatProvider(LlmProvider):
    """Обёртка над GigaChatClient (транспорт уже держит токен и сертификат)."""

    def __init__(self, client, model: str = "GigaChat", temperature: float = 0.3) -> None:
        self._client = client
        self._model = model
        self._temperature = temperature

    async def chat(self, messages: list[dict], functions: list[dict]) -> dict:
        body: dict = {
            "model": self._model,
            "temperature": self._temperature,
            "messages": to_gigachat_messages(messages),
        }
        if functions:
            body["functions"] = functions
            body["function_call"] = "auto"
        res = await self._client.chat(json.dumps(body).encode())
        if res.status != 200:
            raise LlmError(f"GigaChat ответил {res.status}")
        return parse_gigachat_reply(json.loads(res.body))