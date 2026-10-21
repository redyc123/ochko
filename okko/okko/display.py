# Драйвер SSD1306 72x40 с теневым буфером и системными экранами.
# Инициализация по образцу U8g2 ssd1306_72x40_er.
import framebuf
from machine import I2C, Pin

from . import packbits
from .protocol import (SCREEN_W, SCREEN_H, SCREEN_PAGES, ENC_RAW, ENC_PACKBITS, check_rect,
                       ST_OK, ST_BAD_LENGTH, ST_OUT_OF_BOUNDS, ST_DECODE_ERROR)

_FRAME_HDR = 5


class Display:
    def __init__(self, cfg):
        self.cfg = cfg
        self.addr = cfg.oled_addr
        self.off = cfg.oled_col_offset
        self.buf = bytearray(SCREEN_W * SCREEN_PAGES)  # теневой буфер MONO_VLSB
        self.fb = framebuf.FrameBuffer(self.buf, SCREEN_W, SCREEN_H, framebuf.MONO_VLSB)
        self._tmp = bytearray(SCREEN_W * SCREEN_PAGES)  # распаковка PackBits
        self._tmv = memoryview(self._tmp)
        self._cmd = bytearray(2)
        self._win = bytearray(7)
        self._ctl = b"\x40"
        self._vec = [self._ctl, None]
        self.on = False
        self.contrast = cfg.oled_contrast
        self.i2c = I2C(cfg.i2c_id, sda=Pin(cfg.i2c_sda), scl=Pin(cfg.i2c_scl), freq=cfg.i2c_freq)
        self.init()

    def _c(self, *cmds):
        c = self._cmd
        for b in cmds:
            c[1] = b
            self.i2c.writeto(self.addr, c)

    def init(self):
        m = self.cfg.mirror
        seg = 0xA0 if "h" in m else 0xA1
        com = 0xC0 if "v" in m else 0xC8
        self._c(0xAE, 0xD5, 0x80, 0xA8, 0x27, 0xD3, 0x00, 0x40, 0x8D, 0x14,
                0x20, 0x00, seg, com, 0xDA, 0x12, 0x81, self.contrast,
                0xD9, 0x22, 0xDB, 0x20, 0xAD, 0x30, 0x2E, 0xA4, 0xA6)
        self.flush()
        self._c(0xAF)
        self.on = True

    def _window(self, x, page, w, h):
        b = self._win
        b[0] = 0x00
        b[1] = 0x21
        b[2] = self.off + x
        b[3] = self.off + x + w - 1
        b[4] = 0x22
        b[5] = page
        b[6] = page + h - 1
        self.i2c.writeto(self.addr, b)

    def _send(self, x, page, w, h, data):
        self._window(x, page, w, h)
        self._vec[1] = data
        self.i2c.writevto(self.addr, self._vec)

    def flush(self):
        self._send(0, 0, SCREEN_W, SCREEN_PAGES, self.buf)

    def set_brightness(self, level):
        if level == 0:
            self._c(0xAE)
            self.on = False
        else:
            self.contrast = level
            self._c(0x81, level, 0xAF)
            self.on = True

    def power(self, on):
        self._c(0xAF if on else 0xAE)
        self.on = on

    def clear(self):
        self.fb.fill(0)
        self.flush()

    def frame(self, p):
        """Обработчик FRAME. p — payload (memoryview). Возвращает статус RESULT."""
        if len(p) < _FRAME_HDR:
            return ST_BAD_LENGTH
        x = p[0]
        page = p[1]
        w = p[2]
        h = p[3]
        enc = p[4]
        if not check_rect(x, page, w, h):
            return ST_OUT_OF_BOUNDS
        n = w * h
        data = p[_FRAME_HDR:]
        if enc == ENC_RAW:
            if len(data) != n:
                return ST_BAD_LENGTH
        elif enc == ENC_PACKBITS:
            if packbits.decode_into(data, self._tmp, n) != n:
                return ST_DECODE_ERROR
            data = self._tmv[:n]
        else:
            return ST_DECODE_ERROR
        buf = self.buf
        for r in range(h):
            o = (page + r) * SCREEN_W + x
            buf[o:o + w] = data[r * w:r * w + w]
        self._send(x, page, w, h, data)
        return ST_OK

    # --- системные экраны (встроенный шрифт 8x8, 9 символов в строке) ---

    def _text(self, lines):
        fb = self.fb
        fb.fill(0)
        y = (SCREEN_H - 10 * len(lines)) // 2 + 1
        for s in lines:
            fb.text(s, max(0, (SCREEN_W - 8 * len(s)) // 2), y, 1)
            y += 10
        if not self.on:
            self._c(0xAF)
            self.on = True
        self.flush()

    def show_passkey(self, code):
        self._text(("PAIR", "%06d" % code))

    def show_no_link(self):
        if self.cfg.show_no_link:
            self._text(("NO LINK",))
        else:
            self.fb.fill(0)
            self.power(False)

    def show_error(self, msg):
        self._text(("ERROR", msg[:9]))

    def test_pattern(self):
        """Рамка по краю и диагональ: проверка смещения столбцов, 40 строк и зеркала."""
        fb = self.fb
        fb.fill(0)
        fb.rect(0, 0, SCREEN_W, SCREEN_H, 1)
        fb.line(0, 0, 15, 15, 1)
        fb.text("R", SCREEN_W - 12, 4, 1)
        self.flush()
