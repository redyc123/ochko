# Эталонная упаковка картинки/текста в пакеты FRAME (тот же алгоритм должен быть в приложении).
#   python tools/frame_tool.py picture.png      — печатает hex пакета полного кадра
#   python tools/frame_tool.py --text "Hello"
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from okko import packbits  # noqa: E402
from okko import protocol as P  # noqa: E402

W = P.SCREEN_W
H = P.SCREEN_H


def pixels_to_vlsb(px):
    """px[y][x] (истина = горит), 72x40 -> 360 байт MONO_VLSB."""
    out = bytearray(W * P.SCREEN_PAGES)
    for y in range(H):
        row = px[y]
        for x in range(W):
            if row[x]:
                out[(y >> 3) * W + x] |= 1 << (y & 7)
    return bytes(out)


def image_to_vlsb(img, threshold=128):
    """PIL.Image любого режима -> 360 байт (картинка вписывается в 72x40)."""
    from PIL import Image
    img = img.convert("L")
    if img.size != (W, H):
        img = img.resize((W, H), Image.LANCZOS)
    p = img.load()
    return pixels_to_vlsb([[p[x, y] >= threshold for x in range(W)] for y in range(H)])


def text_to_vlsb(text, size=12):
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=size)
    except TypeError:
        font = ImageFont.load_default()
    d.multiline_text((1, 1), text, fill=255, font=font, spacing=1)
    return image_to_vlsb(img)


def crop(vlsb, x, page, w, h_pages):
    """Вырезать прямоугольник из полного кадра в порядке FRAME."""
    out = bytearray()
    for p in range(page, page + h_pages):
        out += vlsb[p * W + x:p * W + x + w]
    return bytes(out)


def frame_payload(data, x=0, page=0, w=W, h_pages=P.SCREEN_PAGES):
    """Выбирает меньшее из raw и PackBits, возвращает payload FRAME."""
    assert P.check_rect(x, page, w, h_pages) and len(data) == w * h_pages
    pb = packbits.encode(data)
    enc, body = (P.ENC_PACKBITS, pb) if len(pb) < len(data) else (P.ENC_RAW, bytes(data))
    return bytes((x, page, w, h_pages, enc)) + body


def dirty_rect(old, new):
    """Минимальный прямоугольник (x, page, w, h_pages) с изменениями или None."""
    xs, ps = [], []
    for p in range(P.SCREEN_PAGES):
        for x in range(W):
            i = p * W + x
            if old[i] != new[i]:
                xs.append(x)
                ps.append(p)
    if not xs:
        return None
    return min(xs), min(ps), max(xs) - min(xs) + 1, max(ps) - min(ps) + 1


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--text":
        v = text_to_vlsb(sys.argv[2].replace("\\n", "\n"))
    elif len(sys.argv) > 1:
        from PIL import Image
        v = image_to_vlsb(Image.open(sys.argv[1]))
    else:
        print(__doc__ if __doc__ else "usage: frame_tool.py picture.png | --text TEXT")
        sys.exit(1)
    pl = frame_payload(v)
    print(P.encode_message(P.T_FRAME, 0, pl).hex(" "))
