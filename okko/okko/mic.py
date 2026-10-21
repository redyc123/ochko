# Микрофон INMP441 по I2S -> кадры 20 мс IMA ADPCM (166 байт с заголовком).
import asyncio
from array import array

from . import adpcm
from .protocol import AUDIO_HEADER_SIZE, AUDIO_DATA_SIZE, AUDIO_FRAME_SIZE, audio_header

_SAMPLES = AUDIO_DATA_SIZE * 2  # 320 отсчётов = 20 мс при 16 кГц


class Mic:
    def __init__(self, cfg):
        self.cfg = cfg
        self.raw = bytearray(_SAMPLES * 4)
        self._rmv = memoryview(self.raw)
        self.pkt = bytearray(AUDIO_FRAME_SIZE)
        self._data = memoryview(self.pkt)[AUDIO_HEADER_SIZE:]
        self.state = array("i", (0, 0))
        self.i2s = None
        self._reader = None
        self.available = cfg.mic_sck is not None and self._probe()

    def _create(self):
        from machine import I2S, Pin
        c = self.cfg
        return I2S(c.i2s_id, sck=Pin(c.mic_sck), ws=Pin(c.mic_ws), sd=Pin(c.mic_sd),
                   mode=I2S.RX, bits=32, format=I2S.MONO, rate=c.mic_rate, ibuf=c.mic_ibuf)

    def _probe(self):
        try:
            self._create().deinit()
            return True
        except Exception:
            return False

    def start(self):
        if self.i2s is None:
            self.i2s = self._create()
            self._reader = asyncio.StreamReader(self.i2s)
        self.state[0] = 0
        self.state[1] = 0

    def stop(self):
        if self.i2s is not None:
            try:
                self.i2s.deinit()
            except Exception:
                pass
        self.i2s = None
        self._reader = None

    async def read_frame(self, seq, flags):
        """Читает 20 мс, кодирует и возвращает готовый пакет (тот же буфер каждый раз)."""
        mv = self._rmv
        got = 0
        n = len(mv)
        while got < n:
            r = await self._reader.readinto(mv[got:])
            if not r:
                raise OSError("i2s")
            got += r
        st = self.state
        audio_header(self.pkt, seq, flags, st[0], st[1])
        adpcm.encode_i2s(self.raw, self._data, st, self.cfg.mic_shift)
        return self.pkt

