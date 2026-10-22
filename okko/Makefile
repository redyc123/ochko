# Команды разработки О.Ч.К.О.   `make help` — список.
# Порт определяется автоматически; переопределить: make PORT=/dev/cu.usbmodem1101 flash

PORT ?= $(firstword $(wildcard /dev/cu.usbmodem*))
FW   := ESP32_GENERIC_C6-20260824-v1.29.0.bin
# чужой активный venv (VIRTUAL_ENV) не должен мешать uv
UV   := env -u VIRTUAL_ENV uv
MPR  := $(UV) run mpremote connect $(PORT)
CLI  := $(UV) run --group tools python tools/client.py

.DEFAULT_GOAL := help
.PHONY: help setup port check-port erase firmware upload upload-src deploy run repl reset ls \
        i2c stage0 test scan info listen clean

help: ## список команд
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-11s %s\n", $$1, $$2}'

setup: ## установить зависимости (uv sync)
	$(UV) sync --group dev --group tools

port: ## показать найденный порт
	@echo "$(if $(PORT),$(PORT),порт не найден: проверьте кабель (нужен с данными))"

check-port:
	@test -n "$(PORT)" || { echo "Плата не найдена: /dev/cu.usbmodem* отсутствует. Кабель с данными? Режим BOOT?"; exit 1; }

erase: check-port ## стереть flash целиком
	$(UV) run esptool --chip esp32c6 --port $(PORT) erase_flash

firmware: check-port ## стереть и залить MicroPython v1.29.0
	$(UV) run esptool --chip esp32c6 --port $(PORT) erase_flash
	$(UV) run esptool --chip esp32c6 --port $(PORT) write_flash 0 $(FW)

upload: check-port ## собрать .mpy и залить SDK + main.py, перезагрузить
	$(UV) run sh tools/build_mpy.sh
	-$(MPR) mkdir :okko
	$(MPR) cp -r build/okko/ : + cp build/main.py :main.py + reset

upload-src: check-port ## залить исходники .py (для отладки)
	-$(MPR) mkdir :okko
	$(MPR) cp okko/*.py :okko/ + cp main.py :main.py + reset

deploy: firmware upload ## с нуля: MicroPython + SDK

run: check-port ## запустить main.py и видеть логи/Traceback (Ctrl-C — стоп)
	$(MPR) exec "exec(open('main.py').read())"

repl: check-port ## консоль платы: логи, код сопряжения (Ctrl-D перезагрузка, Ctrl-] выход)
	$(MPR) repl

reset: check-port ## перезагрузить плату
	$(MPR) reset

ls: check-port ## файлы на плате
	$(MPR) ls : + ls :okko

i2c: check-port ## сканировать I2C (экран должен быть 0x3c)
	$(MPR) exec "from machine import I2C,Pin; print([hex(a) for a in I2C(0,sda=Pin(22),scl=Pin(23)).scan()])"

stage0: check-port ## тест экрана и кнопки на устройстве
	$(MPR) run tools/stage0.py

test: ## тесты на компьютере
	$(UV) run pytest -q tests

scan: ## найти очки по BLE с компьютера
	$(UV) run --group tools python -c "import asyncio,bleak; \
	ds=asyncio.run(bleak.BleakScanner.discover(8)); \
	print('\n'.join(f'{d.name} {d.address}' for d in ds if d.name) or 'ничего не найдено')"

info: ## BLE: запросить INFO у очков
	$(CLI) info

listen: ## BLE: события кнопки
	$(CLI) listen

clean: ## удалить build/
	rm -rf build
