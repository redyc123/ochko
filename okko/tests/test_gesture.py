from okko.gesture import Gesture, TICKS_PERIOD
from okko.protocol import BTN_SHORT, BTN_HOLD, BTN_RELEASE, BTN_DOUBLE


def run(g, script, t0=0, step=5):
    """script: список (длительность_мс, нажата). Возвращает все события."""
    out = []
    t = t0
    for dur, p in script:
        end = t + dur
        while t < end:
            out.extend(g.update(p, t % TICKS_PERIOD))
            t += step
    return out


def test_short():
    g = Gesture()
    assert run(g, [(10, 0), (100, 1), (500, 0)]) == [BTN_SHORT]
    assert not g.busy()


def test_short_no_double():
    g = Gesture(double_ms=0)
    ev = run(g, [(10, 0), (100, 1), (40, 0)])
    assert ev == [BTN_SHORT]


def test_double():
    g = Gesture()
    assert run(g, [(10, 0), (100, 1), (100, 0), (100, 1), (500, 0)]) == [BTN_DOUBLE]


def test_hold():
    g = Gesture()
    ev = run(g, [(10, 0), (700, 1)])
    assert ev == [BTN_HOLD]
    assert run(g, [(100, 0)]) == [BTN_RELEASE]


def test_second_press_to_hold():
    g = Gesture()
    ev = run(g, [(10, 0), (100, 1), (100, 0), (800, 1), (100, 0)])
    assert ev == [BTN_SHORT, BTN_HOLD, BTN_RELEASE]


def test_bounce():
    g = Gesture()
    # дребезг 10 мс короче debounce 30 мс — ничего
    assert run(g, [(10, 0), (10, 1), (10, 0), (10, 1), (500, 0)], step=5) == []
    assert not g.busy()


def test_ticks_overflow():
    g = Gesture()
    t0 = TICKS_PERIOD - 120
    assert run(g, [(10, 0), (100, 1), (100, 0), (100, 1), (500, 0)], t0=t0) == [BTN_DOUBLE]
    g = Gesture()
    assert run(g, [(10, 0), (700, 1), (50, 0)], t0=TICKS_PERIOD - 300) == [BTN_HOLD, BTN_RELEASE]
