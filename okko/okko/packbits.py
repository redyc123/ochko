# PackBits: декодер для прошивки и эталонный кодер для тестов и приложения.
# n 0..127: следом n+1 байт как есть; n 129..255: следующий байт 257-n раз; n 128 пропускается.


def decode_into(src, dst, expected):
    """Распаковывает src в dst. Возвращает expected или -1, если вход битый
    либо размер распакованных данных не равен expected. Не создаёт объектов."""
    i = 0
    o = 0
    n = len(src)
    if expected > len(dst):
        return -1
    while i < n:
        c = src[i]
        i += 1
        if c < 128:
            c += 1
            if i + c > n or o + c > expected:
                return -1
            dst[o:o + c] = src[i:i + c]
            i += c
            o += c
        elif c > 128:
            c = 257 - c
            if i >= n or o + c > expected:
                return -1
            v = src[i]
            i += 1
            for k in range(o, o + c):
                dst[k] = v
            o += c
    return o if o == expected else -1


def encode(data):
    """Эталонный кодер: повторы от 2 байт кодируются серией, блоки не длиннее 128."""
    out = bytearray()
    n = len(data)
    i = 0
    while i < n:
        r = 1
        while i + r < n and r < 128 and data[i + r] == data[i]:
            r += 1
        if r >= 2:
            out.append(257 - r)
            out.append(data[i])
            i += r
            continue
        j = i
        while j < n and j - i < 128 and not (j + 1 < n and data[j] == data[j + 1]):
            j += 1
        out.append(j - i - 1)
        out.extend(data[i:j])
        i = j
    return bytes(out)
