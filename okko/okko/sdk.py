# Класс Glasses: связывает железо, BLE и протокол, диспетчеризует сообщения
# по таблице (канал, тип) -> обработчик.
import asyncio
import gc
import time
import machine

from . import protocol as P
from .config import LOG_INFO, LOG_DEBUG


def _hex(b):
    return " ".join("%02x" % x for x in b)


class Glasses:
    def __init__(self, cfg):
        self.cfg = cfg
        if cfg.cpu_freq:
            machine.freq(cfg.cpu_freq)
        self._handlers = {}
        self._seq = 0  # events
        self._aseq = 0  # audio, u16
        self._cb_connect = []
        self._cb_disconnect = []
        self._recording = False
        self._stop_req = False
        self._audio_flag = asyncio.ThreadSafeFlag()
        self._lost = 0
        self._sent_overflow = 0
        self._wdt = None
        self._last_batt = None

        from .display import Display
        self.display = Display(cfg)

        from .mic import Mic
        self.mic = Mic(cfg)

        self._adc = None
        if cfg.battery_adc_pin is not None:
            self._adc = machine.ADC(machine.Pin(cfg.battery_adc_pin), atten=machine.ADC.ATTN_11DB)

        from .ble import Ble
        self.ble = Ble(cfg, self.log)
        self.ble.on_connect = self._connected
        self.ble.on_disconnect = self._disconnected
        self.ble.on_passkey = self.display.show_passkey
        self.ble.on_secure = self._secured

        self.ancs = None
        if cfg.ancs:
            from .ancs import Ancs
            self.ancs = Ancs(self.ble.ble, self.log, self._phone_notification)
            self.ble.on_gattc = self.ancs.irq

        from .protocol import Reassembler
        self._rx = (Reassembler(), Reassembler())

        from .button import Button
        self.button = Button(cfg, self._button)

        caps = P.CAP_FRAME | P.CAP_PACKBITS | (P.CAP_AUDIO if self.mic.available else 0) \
            | (P.CAP_ANCS if self.ancs else 0)
        self.info = P.encode_info(cfg.fw_version, caps)
        self.ble.set_info(self.info)

        d = P.CH_DISPLAY
        c = P.CH_CONTROL
        self.on_message(d, P.T_FRAME, self.display.frame)
        self.on_message(d, P.T_CLEAR, self._clear)
        self.on_message(c, P.T_SET_TIME, self._set_time)
        self.on_message(c, P.T_BRIGHTNESS, self._brightness)
        self.on_message(c, P.T_AUDIO_CTRL, self._audio_ctrl)
        self.on_message(c, P.T_CONN_PARAMS, self._conn_params)

    # --- публичный API ---

    def on_message(self, chan, type_, handler):
        """handler(payload: memoryview) -> статус ST_* (None = OK)."""
        self._handlers[(chan << 8) | type_] = handler

    def on_connect(self, cb):
        self._cb_connect.append(cb)

    def on_disconnect(self, cb):
        self._cb_disconnect.append(cb)

    def send_event(self, type_, payload=b""):
        pkt = P.encode_message(type_, self._seq, payload)
        self._seq = (self._seq + 1) & 0xFF
        if self.cfg.log_level >= LOG_DEBUG:
            print("tx", _hex(pkt))
        return self.ble.notify_event(pkt)

    def send_error(self, code, text=""):
        t = text.encode() if isinstance(text, str) else bytes(text)
        t = t[:255]
        return self.send_event(P.EV_ERROR, bytes((code, len(t))) + t)

    def run(self):
        asyncio.run(self._main())

    def log(self, *a):
        if self.cfg.log_level >= LOG_INFO:
            print("[okko]", *a)

    # --- события BLE ---

    def _connected(self):
        for r in self._rx:
            r.reset()
        self.ble.set_info(self.info)
        self.log("connected")
        self._run_cbs(self._cb_connect)
        self._last_batt = None
        self._audio_flag.set()  # разбудить батарею/аудио

    def _secured(self, ok):
        # Код пары остаётся в буфере, пока его не перерисует FRAME: стираем сразу после шифрования
        self.log("secure", ok)
        if ok:
            try:
                self.display.clear()
            except OSError:
                pass
            if self.ancs and self.ble.conn is not None:
                self.ancs.start(self.ble.conn)

    def _phone_notification(self, category, title, message):
        self.log("notify", category, len(title), len(message))
        self.send_event(P.EV_NOTIFY, P.notify_payload(category, title, message))

    def _disconnected(self):
        self.log("disconnected")
        if self.ancs:
            self.ancs.stop()
        if self._recording:
            self._recording = False
            self.mic.stop()
        for r in self._rx:
            r.reset()
        try:
            self.display.show_no_link()
        except OSError:
            pass
        self._run_cbs(self._cb_disconnect)

    def _run_cbs(self, cbs):
        for cb in cbs:
            try:
                cb()
            except Exception as e:
                self.log("hook", e)

    def _button(self, kind):
        self.log("button", kind)
        self.send_event(P.EV_BUTTON, bytes((kind,)))

    # --- обработчики ---

    def _clear(self, p):
        self.display.clear()

    def _set_time(self, p):
        if len(p) < 6:
            return P.ST_BAD_LENGTH
        unix = p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24)
        tz = p[4] | (p[5] << 8)
        if tz >= 0x8000:
            tz -= 0x10000
        t = time.gmtime(unix - 946684800 + tz * 60)  # эпоха MicroPython на ESP32 — 2000 год
        machine.RTC().datetime((t[0], t[1], t[2], t[6], t[3], t[4], t[5], 0))

    def _brightness(self, p):
        if len(p) < 1:
            return P.ST_BAD_LENGTH
        self.display.set_brightness(p[0])

    def _conn_params(self, p):
        # Периферия MicroPython не умеет запрашивать параметры соединения: только подтверждаем
        if len(p) < 1:
            return P.ST_BAD_LENGTH

    def _audio_ctrl(self, p):
        if len(p) < 1:
            return P.ST_BAD_LENGTH
        if not self.mic.available:
            return P.ST_HW_ERROR
        if p[0] == 1:
            if self.ble.mtu < P.AUDIO_MIN_MTU:
                self.send_error(P.ERR_MTU, "MTU")
                return P.ST_HW_ERROR
            if not self._recording:
                self.mic.start()
                self._lost = 0
                self._stop_req = False
                self._recording = True
                self._audio_flag.set()
        elif p[0] == 0:
            if self._recording:
                self._stop_req = True
        else:
            return P.ST_BAD_LENGTH

    # --- задачи ---

    def _result(self, chan, seq, type_, status):
        self.send_event(P.EV_RESULT, bytes((chan, seq, type_, status)))

    def _handle(self, chan, pkt):
        if self.cfg.log_level >= LOG_DEBUG:
            print("rx", chan, _hex(pkt))
        r = self._rx[chan]
        st = r.feed(pkt)
        if st == P.NEED_MORE:
            return
        if st != P.COMPLETE:
            self._result(chan, r.seq, r.type, st)
            return
        if not P.ver_allowed(chan, r.ver, r.type):
            self._result(chan, r.seq, r.type, P.ST_BAD_VERSION)
            return
        h = self._handlers.get((chan << 8) | r.type)
        if h is None:
            self._result(chan, r.seq, r.type, P.ST_UNKNOWN_TYPE)
            return
        try:
            st = h(r.payload())
            if st is None:
                st = P.ST_OK
        except OSError as e:
            self.log("hw", e)
            st = P.ST_HW_ERROR
            if chan == P.CH_DISPLAY and self.display.available:
                # Без повторной инициализации здесь: при отвалившемся экране каждая
                # попытка ждёт таймаутов I2C и блокирует цикл до срабатывания WDT.
                # Экран переинициализирует главный цикл раз в 2 с.
                self.display.available = False
                self.send_error(P.ERR_DISPLAY, "I2C")
        except Exception as e:
            self.log("handler", repr(e))
            st = P.ST_HW_ERROR
            self.send_error(P.ERR_INTERNAL, type(e).__name__)
        self._result(chan, r.seq, r.type, st)

    async def _rx_task(self):
        ble = self.ble
        while True:
            await ble.flag.wait()
            while True:
                item = ble.pop()
                if item is None:
                    break
                try:
                    self._handle(item[0], item[1])
                except Exception as e:
                    self.log("rx", repr(e))
                await asyncio.sleep_ms(0)  # отдать цикл WDT и другим задачам между пакетами
            if ble.overflow != self._sent_overflow:
                self._sent_overflow = ble.overflow
                self.send_error(P.ERR_INTERNAL, "rx overflow")

    async def _audio_task(self):
        mic = self.mic
        ble = self.ble
        while True:
            await self._audio_flag.wait()
            first = True
            while self._recording:
                last = self._stop_req
                flags = (P.AF_FIRST if first else 0) | (P.AF_LAST if last else 0)
                try:
                    pkt = await mic.read_frame(self._aseq, flags)
                except Exception as e:
                    self.log("mic", repr(e))
                    self.send_error(P.ERR_MIC, type(e).__name__)
                    self._recording = False
                    break
                if not self._recording:
                    break  # разрыв связи во время чтения
                if not ble.notify_audio(pkt):
                    self._lost += 1
                self._aseq = (self._aseq + 1) & 0xFFFF
                first = False
                if last:
                    self._recording = False
            mic.stop()
            if self._lost:
                self.send_error(P.ERR_AUDIO_LOST, str(self._lost))
                self._lost = 0

    def _battery(self):
        c = self.cfg
        mv = int(self._adc.read_uv() / 1000 * c.battery_divider)
        pct = (mv - c.battery_min_mv) * 100 // (c.battery_max_mv - c.battery_min_mv)
        pct = 0 if pct < 0 else 100 if pct > 100 else pct
        return pct, mv

    async def _battery_task(self):
        while True:
            if self.ble.conn is not None and self.ble.encrypted:
                now = time.ticks_ms()
                if self._last_batt is None or time.ticks_diff(now, self._last_batt) >= self.cfg.battery_period_s * 1000:
                    try:
                        pct, mv = self._battery()
                        self.send_event(P.EV_BATTERY, bytes((pct, mv & 0xFF, mv >> 8, 0)))
                        self._last_batt = now
                    except Exception as e:
                        self.log("battery", repr(e))
            await asyncio.sleep(5)

    async def _main(self):
        cfg = self.cfg
        self.display.show_no_link()
        self.ble.advertise()
        asyncio.create_task(self._rx_task())
        asyncio.create_task(self.button.run())
        if self.ancs:
            asyncio.create_task(self.ancs.run())
        if self.mic.available:
            asyncio.create_task(self._audio_task())
        if self._adc is not None:
            asyncio.create_task(self._battery_task())
        if cfg.wdt_timeout_ms:
            self._wdt = machine.WDT(timeout=cfg.wdt_timeout_ms)
        period = max(1000, cfg.wdt_timeout_ms // 4) if cfg.wdt_timeout_ms else 60000
        while True:
            if self._wdt:
                self._wdt.feed()
            if not self.display.available and self.display.try_init():
                # Экран появился позже старта: вернуть системный экран, кадры пришлёт приложение
                self.log("display ready")
                if self.ble.conn is None:
                    self.display.show_no_link()
            if cfg.log_level >= LOG_DEBUG:
                print("[okko] mem_free", gc.mem_free())
            await asyncio.sleep_ms(period)
