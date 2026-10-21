# Точка входа прошивки О.Ч.К.О.
from machine import Pin
from okko.config import Config

cfg = Config()

# RF-переключатель антенны XIAO ESP32-C6 — до запуска BLE
if cfg.rf_switch_pin is not None:
    Pin(cfg.rf_switch_pin, Pin.OUT, value=cfg.rf_switch_level)
if cfg.ant_select_pin is not None:
    Pin(cfg.ant_select_pin, Pin.OUT, value=1 if cfg.ant_external else 0)

from okko.sdk import Glasses

g = Glasses(cfg)
g.run()
