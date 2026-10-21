# Протокол О.Ч.К.О. v2: константы, кодеры и сборщик фрагментов.
# Модуль не зависит от железа и тестируется на ПК (см. docs/PROTOCOL.md).

PROTO_VER = 2

# UUID: 1277XXXX-4f16-4cec-abf9-1d12f945b15b
UUID_BASE = "1277%04x-4f16-4cec-abf9-1d12f945b15b"
UUID_SERVICE = UUID_BASE % 0x0001
UUID_DISPLAY = UUID_BASE % 0x0002
UUID_EVENTS = UUID_BASE % 0x0003
UUID_AUDIO = UUID_BASE % 0x0004
UUID_CONTROL = UUID_BASE % 0x0005
UUID_INFO = UUID_BASE % 0x0006

# Каналы для RESULT и таблицы обработчиков
CH_DISPLAY = 0
CH_CONTROL = 1

# display
T_FRAME = 0x30
T_CLEAR = 0x7F
T_EXT_FIRST = 0x40
T_EXT_LAST = 0x6F

# control
T_SET_TIME = 0x01
T_BRIGHTNESS = 0x02
T_AUDIO_CTRL = 0x03
T_CONN_PARAMS = 0x04

# events
EV_BUTTON = 0x01
EV_WAKEWORD = 0x02  # резерв
EV_CONFIRM_RESULT = 0x03  # резерв
EV_BATTERY = 0x04
EV_ERROR = 0x05
EV_RESULT = 0x06

# BUTTON kind
BTN_SHORT = 1
BTN_HOLD = 2
BTN_RELEASE = 3
BTN_DOUBLE = 4

# Статусы RESULT
ST_OK = 0
ST_BAD_VERSION = 1
ST_UNKNOWN_TYPE = 2
ST_BAD_LENGTH = 3
ST_OUT_OF_BOUNDS = 4
ST_DECODE_ERROR = 5
ST_FRAGMENT_ERROR = 6
ST_HW_ERROR = 7

# Коды ERROR
ERR_AUDIO_LOST = 1
ERR_MTU = 2
ERR_MIC = 3
ERR_DISPLAY = 4
ERR_INTERNAL = 5

# Флаги заголовка
F_MORE = 0x01
F_LAST = 0x02

# Флаги аудиокадра
AF_FIRST = 0x01
AF_LAST = 0x02
AF_WAKEWORD = 0x04

# Биты caps
CAP_AUDIO = 0x0001
CAP_WAKEWORD = 0x0002
CAP_NAV_ICONS = 0x0004
CAP_CYRILLIC = 0x0008
CAP_FRAME = 0x0010
CAP_PACKBITS = 0x0020

# FRAME enc
ENC_RAW = 0
ENC_PACKBITS = 1

HEADER_SIZE = 4
MAX_MESSAGE = 1024
AUDIO_HEADER_SIZE = 6
AUDIO_DATA_SIZE = 160
AUDIO_FRAME_SIZE = AUDIO_HEADER_SIZE + AUDIO_DATA_SIZE  # 166
AUDIO_MIN_MTU = AUDIO_FRAME_SIZE + 3  # 169

SCREEN_W = 72
SCREEN_PAGES = 5
SCREEN_H = SCREEN_PAGES * 8


def header(buf, type_, seq, flags=0, ver=PROTO_VER):
    buf[0] = ver
    buf[1] = type_
    buf[2] = flags
    buf[3] = seq & 0xFF


def encode_message(type_, seq, payload=b"", flags=0):
    b = bytearray(HEADER_SIZE + len(payload))
    header(b, type_, seq, flags)
    b[HEADER_SIZE:] = payload
    return b


def fragment(type_, seq, payload, chunk):
    """Режет сообщение на фрагменты с payload не больше chunk байт (для клиента и тестов)."""
    n = len(payload)
    if n <= chunk:
        return [encode_message(type_, seq, payload)]
    out = []
    i = 0
    while i < n:
        part = payload[i:i + chunk]
        i += chunk
        out.append(encode_message(type_, seq, part, F_LAST if i >= n else F_MORE))
    return out


def encode_result(seq, chan, msg_seq, msg_type, status):
    return encode_message(EV_RESULT, seq, bytes((chan, msg_seq & 0xFF, msg_type, status)))


def encode_button(seq, kind):
    return encode_message(EV_BUTTON, seq, bytes((kind,)))


def encode_battery(seq, percent, mv, charging):
    return encode_message(EV_BATTERY, seq, bytes((percent, mv & 0xFF, (mv >> 8) & 0xFF, 1 if charging else 0)))


def encode_error(seq, code, text=""):
    t = text.encode() if isinstance(text, str) else bytes(text)
    t = t[:255]
    return encode_message(EV_ERROR, seq, bytes((code, len(t))) + t)


def encode_info(fw, caps, width=SCREEN_W, height=SCREEN_H):
    return bytes((PROTO_VER, fw[0], fw[1], fw[2], caps & 0xFF, (caps >> 8) & 0xFF, width, height))


def audio_header(buf, seq, flags, predictor, step_index):
    buf[0] = seq & 0xFF
    buf[1] = (seq >> 8) & 0xFF
    buf[2] = flags
    p = predictor & 0xFFFF
    buf[3] = p & 0xFF
    buf[4] = p >> 8
    buf[5] = step_index


def encode_frame(x, page, w, h_pages, enc, data, seq):
    return encode_message(T_FRAME, seq, bytes((x, page, w, h_pages, enc)) + bytes(data))


def check_rect(x, page, w, h_pages):
    return (w > 0 and h_pages > 0 and x + w <= SCREEN_W and page + h_pages <= SCREEN_PAGES)


def ver_allowed(chan, ver, type_):
    """v1 допускается для CLEAR и всего control, остальное только v2."""
    if ver == PROTO_VER:
        return True
    if ver == 1:
        return chan == CH_CONTROL or type_ == T_CLEAR
    return False


# Результат Reassembler.feed
NEED_MORE = -1
COMPLETE = 0


class Reassembler:
    """Собирает фрагменты одного канала в заранее выделенный буфер.

    feed() возвращает NEED_MORE, COMPLETE или статус ошибки (ST_*).
    После COMPLETE сообщение лежит в ver/type/seq и payload() (memoryview).
    После ошибки в type/seq лежат значения пакета, на который надо ответить RESULT.
    """

    def __init__(self, size=MAX_MESSAGE):
        self.buf = bytearray(size)
        self._mv = memoryview(self.buf)
        self.size = size
        self.reset()

    def reset(self):
        self.active = False
        self.length = 0
        self.ver = 0
        self.type = 0
        self.seq = 0
        self._skip = -1  # seq переполненного сообщения, хвост которого молча выбрасываем

    def payload(self):
        return self._mv[:self.length]

    def _start(self, pkt):
        self.ver = pkt[0]
        self.type = pkt[1]
        self.seq = pkt[3]
        self.length = 0

    def _append(self, pkt):
        n = len(pkt) - HEADER_SIZE
        if self.length + n > self.size:
            self.active = False
            self._skip = self.seq
            return ST_BAD_LENGTH
        self.buf[self.length:self.length + n] = pkt[HEADER_SIZE:]
        self.length += n
        return COMPLETE

    def feed(self, pkt):
        if len(pkt) < HEADER_SIZE:
            self.active = False
            self.type = pkt[1] if len(pkt) > 1 else 0
            self.seq = pkt[3] if len(pkt) > 3 else 0
            return ST_BAD_LENGTH
        flags = pkt[2]
        seq = pkt[3]
        if self._skip >= 0:
            if seq == self._skip and flags != 0:
                if flags & F_LAST:
                    self._skip = -1
                return NEED_MORE
            self._skip = -1
        if flags == 0:
            self.active = False
            self._start(pkt)
            st = self._append(pkt)
            if st:
                self._skip = -1
                return st
            return COMPLETE
        if flags == F_MORE:
            if not (self.active and seq == self.seq and pkt[1] == self.type):
                self._start(pkt)  # чужой seq: незаконченное сообщение выбрасывается
            self.active = True
            st = self._append(pkt)
            return st if st else NEED_MORE
        if flags == F_LAST:
            if not (self.active and seq == self.seq and pkt[1] == self.type):
                self.active = False
                self.type = pkt[1]
                self.seq = seq
                return ST_FRAGMENT_ERROR
            self.active = False
            st = self._append(pkt)
            if st:
                self._skip = -1
                return st
            return COMPLETE
        # недопустимая комбинация флагов
        self.active = False
        self.type = pkt[1]
        self.seq = seq
        return ST_FRAGMENT_ERROR
