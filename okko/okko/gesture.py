# Конечный автомат кнопки без зависимостей от железа.
# update(pressed, now_ms) возвращает список событий (BTN_* из protocol).

from .protocol import BTN_SHORT, BTN_HOLD, BTN_RELEASE, BTN_DOUBLE

TICKS_PERIOD = 1 << 30  # как у time.ticks_ms() в MicroPython

_IDLE = 0
_DOWN1 = 1
_WAIT2 = 2
_DOWN2 = 3
_HOLD = 4


class Gesture:
    def __init__(self, debounce_ms=30, hold_ms=600, double_ms=300, period=TICKS_PERIOD):
        self.debounce_ms = debounce_ms
        self.hold_ms = hold_ms
        self.double_ms = double_ms
        self._period = period
        self._half = period // 2
        self._mask = period - 1
        self._events = []
        self._raw = False
        self._raw_t = 0
        self._stable = False
        self._state = _IDLE
        self._t = 0

    def _diff(self, a, b):
        # аналог time.ticks_diff с учётом переполнения
        return ((a - b + self._half) & self._mask) - self._half

    def busy(self):
        """True, пока жест не завершён и нужен опрос по таймеру."""
        return self._state != _IDLE or self._raw != self._stable

    def update(self, pressed, now):
        ev = self._events
        del ev[:]
        pressed = bool(pressed)
        if pressed != self._raw:
            self._raw = pressed
            self._raw_t = now
        if self._raw != self._stable and self._diff(now, self._raw_t) >= self.debounce_ms:
            self._stable = self._raw
            self._edge(self._stable, self._raw_t)
        self._timers(now)
        return ev

    def _edge(self, down, t):
        s = self._state
        ev = self._events
        if down:
            if s == _IDLE:
                self._state = _DOWN1
                self._t = t
            elif s == _WAIT2:
                self._state = _DOWN2
                self._t = t
        else:
            if s == _DOWN1:
                if self.double_ms > 0:
                    self._state = _WAIT2
                    self._t = t
                else:
                    ev.append(BTN_SHORT)
                    self._state = _IDLE
            elif s == _DOWN2:
                ev.append(BTN_DOUBLE)
                self._state = _IDLE
            elif s == _HOLD:
                ev.append(BTN_RELEASE)
                self._state = _IDLE

    def _timers(self, now):
        s = self._state
        ev = self._events
        d = self._diff(now, self._t)
        if s == _DOWN1 and d >= self.hold_ms:
            ev.append(BTN_HOLD)
            self._state = _HOLD
        elif s == _DOWN2 and d >= self.hold_ms:
            ev.append(BTN_SHORT)
            ev.append(BTN_HOLD)
            self._state = _HOLD
        elif s == _WAIT2 and d >= self.double_ms:
            ev.append(BTN_SHORT)
            self._state = _IDLE
