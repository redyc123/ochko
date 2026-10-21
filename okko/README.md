# О.Ч.К.О. — прошивка-SDK на MicroPython («тонкий» монитор)

Очки ничего не решают сами: приложение присылает готовую картинку (`FRAME`), очки показывают её
и отвечают `RESULT`; в обратную сторону идут только события — кнопка, аудио, батарея, ошибки.
Протокол: [`docs/PROTOCOL.md`](docs/PROTOCOL.md) (v2), ограничения: [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md),
замеры: [`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md).

## Структура

```
main.py            точка входа: RF-переключатель, Glasses(cfg).run()
okko/
  config.py        пины, тайминги, ориентация, имя
  protocol.py      константы, кодеры, сборщик фрагментов (без железа)
  packbits.py      декодер + эталонный кодер (без железа)
  gesture.py       автомат кнопки (без железа)
  adpcm.py         IMA ADPCM: чистый Python + декодер
  _adpcm_viper.py  быстрый кодер на viper (тот же результат байт в байт)
  display.py       SSD1306 72x40, теневой буфер, системные экраны
  button.py        пин + IRQ + gesture
  mic.py           I2S INMP441 -> кадры 20 мс
  bonds.py         ключи бондинга во flash
  ble.py           GATT, реклама, безопасность, очередь приёма
  sdk.py           класс Glasses, таблица обработчиков
tests/             тесты чистых модулей (pytest и MicroPython unix)
tools/client.py    тестовый клиент (bleak)
tools/frame_tool.py эталонная упаковка картинки/текста в FRAME
tools/stage0.py    проверка экрана и кнопки на устройстве
tools/build_mpy.sh сборка .mpy и заливка
```

## Подключение

| Узел | XIAO ESP32-C6 |
|---|---|
| OLED 0,42″ SSD1306 72×40, I2C `0x3C` | SDA = D4 (GPIO22), SCL = D5 (GPIO23), VCC 3V3, GND |
| Кнопка на землю | D1 (GPIO1), внутренняя подтяжка |
| INMP441 | SCK = D8 (GPIO19), WS = D9 (GPIO20), SD = D10 (GPIO18), L/R → GND, VDD 3V3 |
| Батарея LiPo 130 мА·ч | BAT+/BAT− через выключатель |
| Делитель батареи (опц.) | на любой пин АЦП, `battery_adc_pin` в конфиге |

Все пины — в `okko/config.py`.

## Прошивка MicroPython

Нужна **v1.27+**, рекомендуется **v1.29.0**, сборка `ESP32_GENERIC_C6` (файл уже лежит рядом:
`ESP32_GENERIC_C6-20260824-v1.29.0.bin`). Зависимости ставятся `uv sync`.

```sh
uv run esptool --chip esp32c6 --port /dev/cu.usbmodem* erase_flash
uv run esptool --chip esp32c6 --port /dev/cu.usbmodem* write_flash 0 ESP32_GENERIC_C6-20260824-v1.29.0.bin
```

## Заливка SDK

Исходниками (для отладки):

```sh
uv run mpremote mkdir :okko
uv run mpremote cp okko/*.py :okko/ + cp main.py :main.py + reset
```

В `.mpy` (меньше RAM, быстрее старт; `mpy-cross` той же версии ставится в dev-группу):

```sh
uv run sh tools/build_mpy.sh upload
```

**Заморозка в прошивку (релиз).** В дереве MicroPython v1.29.0 создать `manifest.py`:

```python
include("$(PORT_DIR)/boards/manifest.py")
package("okko", base_path="/путь/к/okko")
module("main.py", base_path="/путь/к/okko")
```

и собрать: `make -C ports/esp32 BOARD=ESP32_GENERIC_C6 FROZEN_MANIFEST=/путь/manifest.py`.

## Проверка по этапам

- Этап 0: `uv run mpremote run tools/stage0.py` — рамка по краю экрана (проверка смещения 28 и 40
  строк, зеркала), в REPL печатаются коды жестов 1/2/3/4.
- Этап 1–2 (нужен Bluetooth на ПК):

```sh
uv run --group tools python tools/client.py info
uv run --group tools python tools/client.py image picture.png
uv run --group tools python tools/client.py text "HELLO"
uv run --group tools python tools/client.py rect
uv run --group tools python tools/client.py bad          # коды ошибок
uv run --group tools python tools/client.py record 10 out.wav
uv run --group tools python tools/client.py listen       # события кнопки
```

При первом подключении на OLED появится 6-значный код — ввести его в диалоге сопряжения ОС.

## Тесты

```sh
uv run pytest -q tests          # CPython
micropython tests/run.py        # MicroPython unix-порт (из корня проекта)
python3 tests/run.py            # то же без pytest
```

Сравнение viper и чистого Python выполняется, только где есть нативный эмиттер (устройство,
unix-порт x64); на arm64 тест пропускается. На устройстве: `mpremote mount . run tests/run.py`.

## API

```python
from okko import Glasses, Config, CH_DISPLAY

g = Glasses(Config(mirror="h", log_level=2))
g.on_message(CH_DISPLAY, 0x40, lambda payload: 0)   # свой тип пакета -> статус RESULT
g.on_connect(lambda: print("up")); g.on_disconnect(lambda: print("down"))
g.send_event(0x01, b"\x01"); g.send_error(5, "text")
g.run()
```

## Принятые решения

- Корень прошивки — эта папка (`okko/`, uv-проект с esptool/mpremote) вместо `firmware/` из задания;
  пакет SDK — `okko/okko/`.
- Viper-кодер вынесен в отдельный модуль `_adpcm_viper.py`: в сборке без нативного эмиттера
  `@micropython.viper` даёт `SyntaxError` при компиляции всего модуля, а так `adpcm.py`
  откатывается на чистый Python. Viper ограничен 4 аргументами, таблицы берутся из глобальных.
- Знак `predictor` в viper восстанавливается вручную (`& 0xFFFF`), т. к. на 64-битном unix-порту
  `ptr32` не расширяет знак.
- `RESULT` на `AUDIO_CTRL start` отправляется сразу после включения I2S (запись запущена),
  а не после первого кадра. Последний кадр фразы (`bit1`) — следующий кадр после `stop`.
- `AUDIO_CTRL start` при MTU < 169 → `ERROR 2` + `RESULT HW_ERROR`.
- Записи при переполнении очереди приёма выбрасываются без `RESULT` (+ `ERROR 5`); приложение
  повторит по таймауту 1 с.
- Наличие микрофона определяется пробным созданием I2S при старте (сразу `deinit`).
- Батарея: задача просыпается раз в 5 с, но событие уходит при подключении (после шифрования)
  и не чаще `battery_period_s` (300 с). `charging` всегда 0 — на XIAO нет сигнала заряда на GPIO.
  Процент — линейная оценка между `battery_min_mv` и `battery_max_mv`.
- Основная задача просыпается раз в `wdt_timeout_ms/4` (2 с) только чтобы кормить WDT.
- Ошибка I2C в `FRAME` → `RESULT HW_ERROR` и повторная инициализация дисплея; если и она не
  удалась — `ERROR 4`.
- Последовательность инициализации SSD1306 взята из U8g2 `ssd1306_72x40_er`; зеркало по
  горизонтали = `0xA0` вместо штатного `0xA1`, по вертикали = `0xC0` вместо `0xC8`.
  Смещение 28 симметрично (28 + 72 + 28 = 128), поэтому зеркало его не меняет.
- RF-переключатель: по вики Seeed GPIO3 = LOW включает управление, GPIO14 = LOW — встроенная
  антенна. **Проверить на плате.**
- Байты на проводе соответствуют протоколу v2 без изменений.

## Статус

Написано и проверено на ПК: чистые модули (33 теста в CPython и MicroPython 1.29 unix),
компиляция всех модулей `mpy-cross -march=rv32imc` (включая viper). **На устройстве код ещё
не запускался**: этапы 0–4 требуют проверки на железе, замеры не проведены.
