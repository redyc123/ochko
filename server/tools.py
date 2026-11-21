"""Инструменты агента (порт `client/src/agent/tools.ts`).

Определения функций (JSON Schema) и форматирование для ответа агенту.
"""

from __future__ import annotations

AGENT_FUNCTIONS: list[dict] = [
    {
        "name": "navigate_to",
        "description": (
            "Построить маршрут от текущего положения пользователя до места. "
            "Вызывай, когда пользователь просит отвести, проложить маршрут, "
            "дойти/доехать куда-то."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Адрес или название места на русском, как для поиска на карте",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "choose_destination",
        "description": (
            "Выбрать один из вариантов адреса, которые вернул navigate_to, когда их было несколько."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "number": {"type": "integer", "description": "Номер варианта из списка, начиная с 1"}
            },
            "required": ["number"],
        },
    },
    {
        "name": "stop_navigation",
        "description": "Остановить текущую навигацию и сбросить маршрут.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_navigation_status",
        "description": "Узнать, идёт ли навигация, куда и сколько осталось.",
        "parameters": {"type": "object", "properties": {}},
    },
]


def short_place_name(display_name: str) -> str:
    """«Пятёрочка, 12, Тверская улица, Тверской район, Москва, …» → первые 3 части."""
    parts = [p.strip() for p in display_name.split(",") if p.strip()]
    return ", ".join(parts[:3])


def format_duration_ru(seconds: float | int) -> str:
    minutes = max(1, round(seconds / 60))
    if minutes < 60:
        return f"{minutes} мин"
    h = minutes // 60
    m = minutes % 60
    return f"{h} ч" if m == 0 else f"{h} ч {m} мин"


def format_distance_short_ru(meters: float | int) -> str:
    meters = max(0, round(meters / 10) * 10) if meters < 1000 else meters
    if meters < 1000:
        return f"{round(meters / 10) * 10} м"
    return f"{(meters / 1000):.1f}".replace(".", ",") + " км"