FROM ghcr.io/astral-sh/uv:0.11.7-python3.11-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_DEV=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Сначала только зависимости — слой кэшируется, пока не меняется uv.lock
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project

COPY gigachat.py main.py russian_trusted_root_ca.crt ./

ENV PATH="/app/.venv/bin:$PATH" \
    SERVER_PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/health', timeout=3)"

# Секреты (GIGA_CHAT_AUTH_TOKEN) — только через переменные окружения, не в образе
CMD ["python", "main.py"]
