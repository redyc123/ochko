# Сервер О.Ч.К.О.

Бэкенд для мобильного приложения (`../client`) — сюда вынесена вся «умная»
часть и внешние интеграции, чтобы на клиенте остались только связь с модулем
и отправка картинок на очки:

- **LLM-агент** (`agent.py`, `llm.py`, `tools.py`, `parsechoice.py`): весь цикл
  function-calling, промпт, история, разбор «второй/отмена». Управляет
  навигацией через структурированные `actions`, которые клиент исполняет локально.
- **Геокодинг** (`geocode.py`) — публичный Nominatim (1 req/s, кэш, как требовал
  публичный сервис).
- **Роутинг** (`router.py`) — публичный OSRM (1 req/s, ретраи) + маппинг манёвров
  (`maneuver_map.py`) и полилиния (`polyline.py`).
- **Распознавание речи** (`stt.py`) — интерфейс, провайдеры Этапа 3.
- **Прокси GigaChat** (`gigachat.py`) — держит `GIGA_CHAT_AUTH_TOKEN` и сертификат
  Минцифры вне бандла.

FastAPI + uvicorn (сервер), aiohttp (запросы к GigaChat/Nominatim/OSRM).

```bash
cp .env.example .env   # вписать GIGA_CHAT_AUTH_TOKEN
uv run main.py         # http://0.0.0.0:8787
uv run pytest
```

## Эндпоинты

- `GET /health` — проверка доступности.
- `GET /chat` — обратная совместимость: проброс GigaChat `chat/completions` как есть.
- `POST /geocode` — поиск адреса: `{"query", "position": {lat,lon}|null, "limit"}` → `{results[]}`.
- `POST /route` — маршрут: `{"from", "to", "profile"}` → `{route}`.
- `POST /agent` — сессионный диалог агента: `{"session_id"?, "user_text", "context": {position, nav_status}}`
  → `{session_id, reply: {display, full, candidates, actions}}`. `actions` клиент исполняет локально.
- `POST /stt` — распознавание речи (заглушка без ключей).

В приложении адрес задаётся `EXPO_PUBLIC_AGENT_PROXY_URL` (`client/.env`) или
полем на экране «Ассистент»; телефон и компьютер — в одной сети.

## Docker

Из корня репозитория (берёт секреты из `server/.env`):

```bash
docker compose up -d --build
docker compose logs -f server
```
