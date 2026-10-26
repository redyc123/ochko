# Сервер О.Ч.К.О.

Бэкенд для мобильного приложения (`../client`). Сейчас — прокси к GigaChat:
держит `GIGA_CHAT_AUTH_TOKEN` вне бандла приложения, получает и обновляет
`access_token`, доверяет корневому сертификату Минцифры
(`russian_trusted_root_ca.crt`) и снимает CORS для веб-версии.
FastAPI + uvicorn (сервер), aiohttp (запросы к GigaChat).

```bash
cp .env.example .env   # вписать GIGA_CHAT_AUTH_TOKEN
uv run main.py         # http://0.0.0.0:8787
uv run pytest
```

- `POST /chat` — тело запроса GigaChat `chat/completions` пробрасывается как есть.
- `GET /health` — проверка доступности.

В приложении адрес задаётся `EXPO_PUBLIC_AGENT_PROXY_URL` (`client/.env`) или
полем на экране «Ассистент»; телефон и компьютер — в одной сети.

## Docker

Из корня репозитория (берёт секреты из `server/.env`):

```bash
docker compose up -d --build
docker compose logs -f server
```
