# Клиент Apple Notification Center Service: очки сами получают уведомления iPhone.
# Работает поверх уже зашифрованного соединения (ANCS виден только сопряжённому
# устройству). Текст уходит в приложение событием NOTIFY, рисует его телефон.
# Спецификация: developer.apple.com, "Apple Notification Center Service (ANCS) Specification".
import asyncio
import bluetooth
import struct
from micropython import const

_IRQ_GATTC_SERVICE_RESULT = const(9)
_IRQ_GATTC_SERVICE_DONE = const(10)
_IRQ_GATTC_CHARACTERISTIC_RESULT = const(11)
_IRQ_GATTC_CHARACTERISTIC_DONE = const(12)
_IRQ_GATTC_DESCRIPTOR_RESULT = const(13)
_IRQ_GATTC_DESCRIPTOR_DONE = const(14)
_IRQ_GATTC_WRITE_DONE = const(17)
_IRQ_GATTC_NOTIFY = const(18)

_UUID_ANCS = bluetooth.UUID("7905F431-B5CE-4E99-A40F-4B1E122D00D0")
_UUID_NS = bluetooth.UUID("9FBF120D-6301-42D9-8C58-25E699A21DBD")  # Notification Source
_UUID_CP = bluetooth.UUID("69D1D8F3-45E1-49A8-9821-9BBDFDAAD9D9")  # Control Point
_UUID_DS = bluetooth.UUID("22EAC6E9-24D6-4BB5-BE44-B36ACE7C7BFB")  # Data Source
_UUID_CCCD = bluetooth.UUID(0x2902)

_EVENT_ADDED = const(0)
_FLAG_PRE_EXISTING = const(0x04)
_CMD_GET_ATTRS = const(0)
_ATTR_TITLE = const(1)
_ATTR_MESSAGE = const(3)
_TITLE_MAX = const(48)
_MESSAGE_MAX = const(120)  # событие NOTIFY должно влезть в одну нотификацию при MTU 185
_OP_TIMEOUT_MS = const(3000)
_QUEUE_LEN = const(4)


class Ancs:
    def __init__(self, ble, log, on_notification):
        self.ble = ble  # объект bluetooth.BLE
        self.log = log
        self.on_notification = on_notification  # (category, title: bytes, message: bytes)
        self._flag = asyncio.ThreadSafeFlag()
        self._gen = 0  # меняется при каждом start/stop: старая сессия видит это и выходит
        self._reset(None)

    def _reset(self, conn):
        self.conn = conn
        self._gen += 1
        self._done = False
        self._status = 0
        self._svc = None
        self._chars = {}  # uuid -> (value_handle, end_handle)
        self._cccd = None
        self._ns = self._ds = None
        self._uids = []
        self._data = bytearray()

    # start/stop вызываются из IRQ BLE: только меняют состояние, задачи не трогают

    def start(self, conn):
        self._reset(conn)
        self._flag.set()

    def stop(self):
        self._reset(None)
        self._flag.set()

    async def run(self):
        """Постоянная задача: ждёт зашифрованного соединения и обслуживает его."""
        while True:
            while self.conn is None:
                await self._flag.wait()
            gen = self._gen
            try:
                await self._session(gen)
            except _Stale:
                pass
            except Exception as e:
                self.log("ancs:", repr(e))
            while gen == self._gen:  # сессия кончилась сама: ждать нового соединения
                await self._flag.wait()

    # --- IRQ: только копирует данные и будит задачу ---

    def irq(self, event, data):
        if self.conn is None or data[0] != self.conn:
            return
        if event == _IRQ_GATTC_NOTIFY:
            _c, h, d = data
            if h == self._ns:
                if len(d) >= 8 and d[0] == _EVENT_ADDED and not d[1] & _FLAG_PRE_EXISTING:
                    if len(self._uids) < _QUEUE_LEN:
                        self._uids.append((d[2], struct.unpack_from("<I", d, 4)[0]))
                    self._flag.set()
            elif h == self._ds:
                self._data.extend(d)
                self._flag.set()
        elif event == _IRQ_GATTC_SERVICE_RESULT:
            _c, start, end, uuid = data
            if uuid == _UUID_ANCS:
                self._svc = (start, end)
        elif event == _IRQ_GATTC_CHARACTERISTIC_RESULT:
            _c, end, value, _props, uuid = data
            self._chars[bytes(uuid)] = (value, end)
        elif event == _IRQ_GATTC_DESCRIPTOR_RESULT:
            _c, h, uuid = data
            if uuid == _UUID_CCCD and self._cccd is None:
                self._cccd = h
        elif event in (_IRQ_GATTC_SERVICE_DONE, _IRQ_GATTC_CHARACTERISTIC_DONE,
                       _IRQ_GATTC_DESCRIPTOR_DONE, _IRQ_GATTC_WRITE_DONE):
            self._status = data[-1]
            self._done = True
            self._flag.set()

    # --- задача ---

    async def _wait(self, gen):
        await self._flag.wait()
        if gen != self._gen:
            raise _Stale()

    async def _op(self, gen, call, *args):
        self._done = False
        try:
            call(self.conn, *args)
        except OSError as e:
            self.log("ancs:", call.__name__, args, e)
            raise
        await asyncio.wait_for_ms(self._wait_done(gen), _OP_TIMEOUT_MS)
        return self._status == 0

    async def _wait_done(self, gen):
        while not self._done:
            await self._wait(gen)

    async def _subscribe(self, gen, uuid):
        value, end = self._chars[bytes(uuid)]
        self._cccd = None
        if value < end:
            # NimBLE ждёт хэндл значения и сам ищет после него; value + 1 даёт EINVAL
            await self._op(gen, self.ble.gattc_discover_descriptors, value, end)
        cccd = self._cccd or value + 1
        return await self._op(gen, self.ble.gattc_write, cccd, b"\x01\x00", 1)

    async def _session(self, gen):
        b = self.ble
        await self._op(gen, b.gattc_discover_services, _UUID_ANCS)
        if not self._svc:
            self.log("ancs: no service (not an iPhone?)")
            return
        await self._op(gen, b.gattc_discover_characteristics, *self._svc)
        if not all(bytes(u) in self._chars for u in (_UUID_NS, _UUID_CP, _UUID_DS)):
            self.log("ancs: characteristics missing")
            return
        self._ns = self._chars[bytes(_UUID_NS)][0]
        self._ds = self._chars[bytes(_UUID_DS)][0]
        cp = self._chars[bytes(_UUID_CP)][0]
        # Data Source до Notification Source: иначе можно пропустить ответ
        if not (await self._subscribe(gen, _UUID_DS) and await self._subscribe(gen, _UUID_NS)):
            self.log("ancs: subscribe failed (notifications sharing off?)")
            return
        self.log("ancs: ready")
        while True:
            while not self._uids:
                await self._wait(gen)
            category, uid = self._uids.pop(0)
            self._data = bytearray()  # в MicroPython у bytearray нет del [:]
            cmd = struct.pack("<BIBHBH", _CMD_GET_ATTRS, uid, _ATTR_TITLE, _TITLE_MAX,
                              _ATTR_MESSAGE, _MESSAGE_MAX)
            try:
                if not await self._op(gen, b.gattc_write, cp, cmd, 1):
                    continue
                attrs = await asyncio.wait_for_ms(self._read_attrs(gen, uid), _OP_TIMEOUT_MS)
            except asyncio.TimeoutError:
                self.log("ancs: timeout uid", uid)
                continue
            title = attrs.get(_ATTR_TITLE, b"")
            message = attrs.get(_ATTR_MESSAGE, b"")
            if title or message:
                self.on_notification(category, title, message)

    async def _read_attrs(self, gen, uid):
        """Ответ Data Source может прийти несколькими нотификациями: ждём оба атрибута."""
        while True:
            attrs = parse_attrs(self._data, uid, 2)
            if attrs is not None:
                return attrs
            await self._wait(gen)


class _Stale(Exception):
    """Соединение сменилось или закрылось, пока сессия ждала."""


def parse_attrs(buf, uid, count):
    """Ответ Get Notification Attributes: None, пока пришёл не весь."""
    if len(buf) < 5:
        return None
    if buf[0] != _CMD_GET_ATTRS or struct.unpack_from("<I", buf, 1)[0] != uid:
        return {}
    attrs = {}
    i = 5
    while len(attrs) < count:
        if i + 3 > len(buf):
            return None
        aid = buf[i]
        n = buf[i + 1] | (buf[i + 2] << 8)
        if i + 3 + n > len(buf):
            return None
        attrs[aid] = bytes(buf[i + 3:i + 3 + n])
        i += 3 + n
    return attrs
