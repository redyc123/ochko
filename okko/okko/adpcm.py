# IMA ADPCM. Интерфейс кодера:
#   encode_i2s(src, dst, state, shift)
#   src   — bytearray с 32-битными отсчётами I2S (little-endian), отсчётов 2*len(dst)
#   dst   — bytearray под ADPCM, младший полубайт = первый отсчёт
#   state — array('i', [predictor, step_index]), обновляется на месте
#   shift — сдвиг 32 -> 16 бит (с насыщением)
# Быстрая версия на viper лежит в _adpcm_viper.py (отдельный модуль, чтобы
# сборка без нативного эмиттера не падала на компиляции); результат байт в байт тот же.

STEPS = (
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
    253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
    1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
    3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
    11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
    32767,
)
INDEX = (-1, -1, -1, -1, 2, 4, 6, 8)


def encode_i2s_py(src, dst, state, shift):
    pred = state[0]
    idx = state[1]
    n = len(dst) * 2
    for i in range(n):
        j = i * 4
        v = src[j] | (src[j + 1] << 8) | (src[j + 2] << 16) | (src[j + 3] << 24)
        if v & 0x80000000:
            v -= 0x100000000
        s = v >> shift
        if s > 32767:
            s = 32767
        elif s < -32768:
            s = -32768
        step = STEPS[idx]
        diff = s - pred
        code = 0
        if diff < 0:
            code = 8
            diff = -diff
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
        idx += INDEX[code & 7]
        if idx < 0:
            idx = 0
        elif idx > 88:
            idx = 88
        if i & 1:
            dst[i >> 1] |= code << 4
        else:
            dst[i >> 1] = code
    state[0] = pred
    state[1] = idx


def decode(data, predictor, step_index, out=None):
    """Декодер одного кадра (для клиента и тестов). Возвращает список int16."""
    if out is None:
        out = []
    pred = predictor
    idx = step_index
    for b in data:
        for code in (b & 0x0F, b >> 4):
            step = STEPS[idx]
            vp = step >> 3
            if code & 4:
                vp += step
            if code & 2:
                vp += step >> 1
            if code & 1:
                vp += step >> 2
            if code & 8:
                pred -= vp
                if pred < -32768:
                    pred = -32768
            else:
                pred += vp
                if pred > 32767:
                    pred = 32767
            idx += INDEX[code & 7]
            if idx < 0:
                idx = 0
            elif idx > 88:
                idx = 88
            out.append(pred)
    return out


try:
    from ._adpcm_viper import encode_i2s
    HAVE_VIPER = True
except Exception:
    encode_i2s = encode_i2s_py
    HAVE_VIPER = False
