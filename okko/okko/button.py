# Кнопка: прерывание по обоим фронтам будит задачу, опрос идёт только пока жест не завершён.
import asyncio
import time
from machine import Pin

from .gesture import Gesture


class Button:
    def __init__(self, cfg, on_event):
        self.cfg = cfg
        self.on_event = on_event
        self.pin = Pin(cfg.button_pin, Pin.IN, Pin.PULL_UP)
        self.g = Gesture(cfg.debounce_ms, cfg.hold_ms, cfg.double_ms)
        self.flag = asyncio.ThreadSafeFlag()
        self.pin.irq(self._irq, Pin.IRQ_FALLING | Pin.IRQ_RISING)

    def _irq(self, _pin):
        self.flag.set()

    async def run(self):
        g = self.g
        pin = self.pin
        poll = self.cfg.button_poll_ms
        while True:
            await self.flag.wait()
            while True:
                for ev in g.update(pin.value() == 0, time.ticks_ms()):
                    self.on_event(ev)
                if not g.busy():
                    break
                await asyncio.sleep_ms(poll)
