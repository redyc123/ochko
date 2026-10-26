# GATT-сервис О.Ч.К.О. на низкоуровневом модуле bluetooth (без aioble).
# IRQ ничего не обрабатывает сам: копирует запись в ограниченную очередь и будит задачу.
import asyncio
import bluetooth
import random
from micropython import const

from . import protocol as P
from .bonds import Bonds

_IRQ_CENTRAL_CONNECT = const(1)
_IRQ_CENTRAL_DISCONNECT = const(2)
_IRQ_GATTS_WRITE = const(3)
_IRQ_MTU_EXCHANGED = const(21)
_IRQ_ENCRYPTION_UPDATE = const(28)
_IRQ_GET_SECRET = const(29)
_IRQ_SET_SECRET = const(30)
_IRQ_PASSKEY_ACTION = const(31)

_PASSKEY_ACTION_DISP = const(3)
_IO_DISPLAY_ONLY = const(0)

_F_READ = const(0x0002)
_F_WRITE = const(0x0008)
_F_NOTIFY = const(0x0010)
_F_READ_ENC = const(0x0200)
_F_READ_AUTHEN = const(0x0400)
_F_WRITE_ENC = const(0x1000)
_F_WRITE_AUTHEN = const(0x2000)

_RD = _F_READ_ENC | _F_READ_AUTHEN
_WR = _F_WRITE_ENC | _F_WRITE_AUTHEN

# Номера каналов в очереди приёма совпадают с CH_* протокола
_SERVICE = (
    bluetooth.UUID(P.UUID_SERVICE),
    (
        (bluetooth.UUID(P.UUID_DISPLAY), _F_WRITE | _WR),
        (bluetooth.UUID(P.UUID_EVENTS), _F_NOTIFY | _RD),
        (bluetooth.UUID(P.UUID_AUDIO), _F_NOTIFY | _RD),
        (bluetooth.UUID(P.UUID_CONTROL), _F_WRITE | _WR),
        (bluetooth.UUID(P.UUID_INFO), _F_READ | _RD),
    ),
)


def _uuid128_le(s):
    b = bytes.fromhex(s.replace("-", ""))
    return bytes(reversed(b))


def adv_payloads(name):
    """Флаги + UUID сервиса в рекламе, имя в scan response (вместе не влезает в 31 байт)."""
    adv = b"\x02\x01\x06" + bytes((17, 0x07)) + _uuid128_le(P.UUID_SERVICE)
    n = name.encode()
    resp = bytes((len(n) + 1, 0x09)) + n
    return adv, resp


class Ble:
    def __init__(self, cfg, log):
        self.cfg = cfg
        self.log = log
        self.bonds = Bonds(cfg.bonds_file)
        self.conn = None
        self.mtu = 23
        self.encrypted = False
        self.flag = asyncio.ThreadSafeFlag()
        self.queue = []  # (канал, bytes)
        self.overflow = 0
        # хуки, ставит sdk
        self.on_connect = None
        self.on_disconnect = None
        self.on_passkey = None
        self.on_secure = None
        self.on_gattc = None  # события GATT-клиента (ANCS), вызываются из IRQ

        b = self.ble = bluetooth.BLE()
        b.active(True)
        b.config(gap_name=cfg.device_name, mtu=cfg.mtu, bond=True, le_secure=True,
                 mitm=True, io=_IO_DISPLAY_ONLY)
        b.irq(self._irq)
        ((self.h_display, self.h_events, self.h_audio, self.h_control, self.h_info),) = \
            b.gatts_register_services((_SERVICE,))
        b.gatts_set_buffer(self.h_display, 512)
        b.gatts_set_buffer(self.h_control, 512)
        self._chan = {self.h_display: P.CH_DISPLAY, self.h_control: P.CH_CONTROL}
        self._adv, self._resp = adv_payloads(cfg.device_name)

    def set_info(self, data):
        self.ble.gatts_write(self.h_info, data)

    def advertise(self):
        try:
            self.ble.gap_advertise(self.cfg.adv_interval_ms * 1000, adv_data=self._adv,
                                   resp_data=self._resp, connectable=True)
        except OSError as e:
            self.log("adv error", e)

    def _irq(self, event, data):
        if 9 <= event <= 18:  # _IRQ_GATTC_*
            if self.on_gattc:
                self.on_gattc(event, data)
            return
        if event == _IRQ_GATTS_WRITE:
            conn, h = data
            ch = self._chan.get(h)
            if ch is None or conn != self.conn:
                return
            if len(self.queue) >= self.cfg.rx_queue_len:
                self.overflow += 1
            else:
                self.queue.append((ch, self.ble.gatts_read(h)))
            self.flag.set()
        elif event == _IRQ_CENTRAL_CONNECT:
            conn, _t, _a = data
            if self.conn is not None:  # только одно подключение
                self.ble.gap_disconnect(conn)
                return
            self.conn = conn
            self.mtu = 23
            self.encrypted = False
            del self.queue[:]
            try:
                self.ble.gattc_exchange_mtu(conn)
            except Exception:
                pass
            if self.on_connect:
                self.on_connect()
        elif event == _IRQ_CENTRAL_DISCONNECT:
            conn, _t, _a = data
            if conn != self.conn:
                return
            self.conn = None
            self.encrypted = False
            del self.queue[:]
            if self.on_disconnect:
                self.on_disconnect()
            self.advertise()
        elif event == _IRQ_MTU_EXCHANGED:
            conn, mtu = data
            if conn == self.conn:
                self.mtu = mtu
                self.log("mtu", mtu)
        elif event == _IRQ_ENCRYPTION_UPDATE:
            conn, enc, auth, bonded, key_size = data
            self.log("enc", enc, auth, bonded, key_size)
            if conn == self.conn:
                self.encrypted = bool(enc)
                if self.on_secure:
                    self.on_secure(bool(enc and auth))
        elif event == _IRQ_PASSKEY_ACTION:
            conn, action, _pk = data
            if action == _PASSKEY_ACTION_DISP:
                code = random.randint(0, 999999)
                if self.on_passkey:
                    self.on_passkey(code)
                self.ble.gap_passkey(conn, action, code)
        elif event == _IRQ_GET_SECRET:
            sec_type, index, key = data
            return self.bonds.get(sec_type, index, key)
        elif event == _IRQ_SET_SECRET:
            sec_type, key, value = data
            return self.bonds.set(sec_type, key, value)

    def pop(self):
        q = self.queue
        return q.pop(0) if q else None

    def notify(self, handle, data, retry=1):
        """True, если пакет ушёл в стек. При ошибке повторяет retry раз."""
        conn = self.conn
        if conn is None:
            return False
        for _ in range(retry + 1):
            try:
                self.ble.gatts_notify(conn, handle, data)
                return True
            except OSError:
                pass
        return False

    def notify_event(self, data):
        return self.notify(self.h_events, data, 1)

    def notify_audio(self, data):
        return self.notify(self.h_audio, data, 0)
