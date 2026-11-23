# AGENTS.md

Three independent projects in one repo. There is no root workspace, no CI, and no root README — run commands from the project directory.

| Directory | What it is | Toolchain |
|---|---|---|
| `client/` | Expo SDK 58 / React Native app | npm |
| `server/` | FastAPI + GigaChat agent | uv, Python 3.11 |
| `okko/` | MicroPython firmware SDK for ESP32-C6 glasses | uv + Makefile |

`client/docs/` and `okko/docs/` contain the real protocol/limitations docs. Root `docs/` is a static design page; `task-sdk.md` and `client/task-react-native.md` are assignment specs, not current state.

## Client (`client/`, npm)

```bash
npm install
npm test                              # Jest
npm test -- tests/nav/geo.test.ts     # one test file
npm test -- -t "1 градус широты"      # one test by name
npm run typecheck                     # tsc --noEmit
npm run lint                          # ESLint
npm run web                           # browser; no BLE, no map
npm start                             # Expo dev server; emulator glasses by default
```

- Navigation is `@react-navigation/native` + native-stack, screens in `src/screens/`, stack in `RootNavigator.tsx`. Do not add Expo Router or create `src/app/`.
- `@/` maps to `client/src/`; tests mirror `src/` under `client/tests/`.
- The wire protocol to real glasses is **v2 FRAME** (`src/ble/protocol/frame.ts`). `GlassesApi` still emits v1 semantic packets; `FrameCompositor` renders them into a 72×40 bitmap and sends `encodeFrame`. The emulator consumes v1 directly. Do not "simplify" this bridge.
- Protocol docs are versioned: `client/docs/PROTOCOL.md` is v1 (app/emulator), `okko/docs/PROTOCOL.md` is v2 (wire to firmware).
- `react-native-maps` has no web implementation; `RouteMap.web.tsx` is the intentional placeholder.
- `client/ios/` is checked-in prebuild output; `client/android/` is absent. Configure native behavior in `app.json`/config plugins, not by hand-editing generated folders.
- Server URL comes from `EXPO_PUBLIC_AGENT_PROXY_URL` in `client/.env` (default `http://localhost:8787`). On a phone use the computer's LAN IP.
- `client/README.md` and `client/docs/LIMITATIONS.md` stop at stages 0–1 and are behind the code (agent, notifications, server integration now exist). Trust the code.

## Server (`server/`, uv)

```bash
cp .env.example .env       # set GIGA_CHAT_AUTH_TOKEN
uv run main.py             # :8787
uv run pytest
uv run pytest tests/api/test_api.py::test_health   # one test
```

- Packages by responsibility: `agent/` (core loop, LLM adapter, tools, sessions), `navigation/` (geocoding, local search, OSRM, polylines), `integrations/` (GigaChat transport), `speech/` (STT). `main.py` stays at the root as the entry point and only FastAPI wiring. Imports are package-qualified (`from agent.core import Agent`); use relative imports inside a package.
- Tests mirror the packages under `tests/agent/`, `tests/navigation/`, `tests/integrations/`, plus endpoint tests in `tests/api/`. Run pytest from `server/`.
- `ServerNavPort` does Nominatim + OSRM; `agent/sessions.py` is in-memory, so restarting drops dialog state.
- `integrations/gigachat.py` needs `russian_trusted_root_ca.crt`. `lifespan` must keep one `aiohttp` session open across `yield`; closing it early gives `RuntimeError: Session is closed` on the first LLM call.
- The client sends `nav_status` as a dict with route progress and the next maneuver; `normalize_nav_status` still accepts the legacy string form. Client `action_results` report whether the previous server actions were applied.
- `LocalSearch` makes at most five Nominatim search calls and keeps only results within `MAX_PEDESTRIAN_ROUTE_DISTANCE_METERS` (default 20 km). Reverse geocoding is separate and exposed as `POST /reverse-geocode`. Pedestrian routes over the same limit are rejected; bicycle/auto routes are not.
- Nominatim/OSRM are public services limited to ~1 req/s; the clients already pace requests.
- Docker has no volume mounts. After editing `server/`, run `docker compose up -d --build` from the repo root or the old image keeps running. `docker compose logs -f server` has the full traceback.
- Neither Python project has lint/typecheck config; pytest is the check.

## Firmware (`okko/`, uv + Makefile)

```bash
make setup                 # uv sync --group dev --group tools
make test                  # uv run pytest -q tests
uv run pytest -q tests/test_protocol.py::test_frame_black_packbits   # one test
micropython tests/run.py   # MicroPython unix port; python3 tests/run.py also works
make upload                # build .mpy + flash; needs the board
```

- Host tests need no hardware; the firmware has not been run on a real device (see `okko/README.md` status). Stages 0–4 require the board.
- `okko/Makefile` uses `env -u VIRTUAL_ENV uv`; prefer `make` targets when an unrelated venv is active.
- `.mpy` must be built with the matching MicroPython 1.29 `mpy-cross`; `make upload` handles it. `okko/build/` is generated.
- `okko/docs/PROTOCOL.md` is the v2 wire contract; `okko/tests/test_protocol.py` checks the examples byte-for-byte.
