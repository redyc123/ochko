import math
from array import array

from okko import adpcm

SHIFT = 14


def _i2s(samples):
    b = bytearray(len(samples) * 4)
    for i, s in enumerate(samples):
        v = (s << SHIFT) & 0xFFFFFFFF
        b[i * 4] = v & 0xFF
        b[i * 4 + 1] = (v >> 8) & 0xFF
        b[i * 4 + 2] = (v >> 16) & 0xFF
        b[i * 4 + 3] = (v >> 24) & 0xFF
    return b


def _sine(n):
    return [int(16000 * math.sin(2 * math.pi * 1000 * i / 16000)) for i in range(n)]


def _encode(fn, samples):
    st = array("i", (0, 0))
    frames = []
    for k in range(0, len(samples), 320):
        dst = bytearray(160)
        head = (st[0], st[1])
        fn(_i2s(samples[k:k + 320]), dst, st, SHIFT)
        frames.append((head, bytes(dst)))
    return frames


def test_snr():
    x = _sine(16000)
    y = []
    for (pred, idx), data in _encode(adpcm.encode_i2s_py, x):
        adpcm.decode(data, pred, idx, y)  # каждый кадр декодируется независимо
    skip = 800  # первые 50 мс
    sig = sum(v * v for v in x[skip:])
    noise = sum((a - b) ** 2 for a, b in zip(x[skip:], y[skip:]))
    snr = 10 * math.log10(sig / noise)
    assert snr >= 25, snr


def test_saturation():
    st = array("i", (0, 0))
    b = bytearray(8)
    for i, v in enumerate((0x7FFFFFFF, -0x80000000)):
        v &= 0xFFFFFFFF
        for k in range(4):
            b[i * 4 + k] = (v >> (8 * k)) & 0xFF
    dst = bytearray(1)
    adpcm.encode_i2s_py(b, dst, st, SHIFT)
    assert 0 <= st[1] <= 88


def test_viper_matches_python():
    if not adpcm.HAVE_VIPER:
        print("  (viper недоступен, пропуск)")
        return
    x = _sine(3200)
    x = [v + ((i * 7919) % 4000) - 2000 for i, v in enumerate(x)]
    assert _encode(adpcm.encode_i2s, x) == _encode(adpcm.encode_i2s_py, x)
