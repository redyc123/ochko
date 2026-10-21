# Быстрый кодер IMA ADPCM на viper. Тот же интерфейс и те же байты, что adpcm.encode_i2s_py.
# viper принимает не больше 4 аргументов, поэтому таблицы берутся из глобальных.
# Перевод int32 -> int16 и сжатие делаются за один проход без аллокаций.
import micropython
from array import array

_STEPS = array("H", (
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
    253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
    1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
    3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
    11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
    32767,
))
# INDEX + 1, чтобы хранить без знака
_INDEX1 = bytes((0, 0, 0, 0, 3, 5, 7, 9))


@micropython.viper
def _enc(src, dst, state, shift: int):
    s8 = ptr8(src)
    d8 = ptr8(dst)
    st = ptr32(state)
    tab = ptr16(_STEPS)
    itab = ptr8(_INDEX1)
    # знак восстанавливаем вручную: на 64-битном unix-порту ptr32 не расширяет знак
    pred = int(st[0]) & 0xFFFF
    if pred > 32767:
        pred -= 65536
    idx = int(st[1])
    n = int(len(dst)) * 2
    i = 0
    while i < n:
        j = i * 4
        hi = int(s8[j + 3])
        if hi > 127:
            hi -= 256
        v = (hi << 24) | (int(s8[j + 2]) << 16) | (int(s8[j + 1]) << 8) | int(s8[j])
        s = v >> shift
        if s > 32767:
            s = 32767
        elif s < -32768:
            s = -32768
        step = int(tab[idx])
        diff = s - pred
        code = 0
        if diff < 0:
            code = 8
            diff = 0 - diff
        vp = step >> 3
        if diff >= step:
            code |= 4
            diff -= step
            vp += step
        step >>= 1
        if diff >= step:
            code |= 2
            diff -= step
            vp += step
        step >>= 1
        if diff >= step:
            code |= 1
            vp += step
        if code & 8:
            pred -= vp
            if pred < -32768:
                pred = -32768
        else:
            pred += vp
            if pred > 32767:
                pred = 32767
        idx += int(itab[code & 7]) - 1
        if idx < 0:
            idx = 0
        elif idx > 88:
            idx = 88
        if i & 1:
            d8[i >> 1] = int(d8[i >> 1]) | (code << 4)
        else:
            d8[i >> 1] = code
        i += 1
    st[0] = pred
    st[1] = idx


def encode_i2s(src, dst, state, shift):
    _enc(src, dst, state, shift)
