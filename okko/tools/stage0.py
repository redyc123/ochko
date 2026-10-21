# Этап 0 на устройстве: рамка на экране и события кнопки в REPL.
#   mpremote run tools/stage0.py
import asyncio
from machine import Pin

from okko.config import Config
from okko.display import Display
from okko.button import Button

cfg = Config()
if cfg.rf_switch_pin is not None:
    Pin(cfg.rf_switch_pin, Pin.OUT, value=cfg.rf_switch_level)
d = Display(cfg)
d.test_pattern()
b = Button(cfg, lambda k: print("button", k))
print("рамка выведена, жмите кнопку (1 короткое, 2 удержание, 3 отпускание, 4 двойное)")
asyncio.run(b.run())
