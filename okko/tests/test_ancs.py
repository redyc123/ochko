import struct
import sys
import types

from okko import protocol as P

# ancs.py рассчитан на MicroPython: подменяем модули, которых нет в CPython
_bt = types.ModuleType("bluetooth")
_bt.UUID = lambda v: v
sys.modules.setdefault("bluetooth", _bt)
_mp = types.ModuleType("micropython")
_mp.const = lambda v: v
sys.modules.setdefault("micropython", _mp)

from okko.ancs import parse_attrs  # noqa: E402


def attrs_response(uid, *attrs):
    b = bytearray(struct.pack("<BI", 0, uid))
    for aid, val in attrs:
        b += struct.pack("<BH", aid, len(val)) + val
    return b


def test_parse_attrs_complete():
    buf = attrs_response(7, (1, "Мама".encode()), (3, b"hi"))
    assert parse_attrs(buf, 7, 2) == {1: "Мама".encode(), 3: b"hi"}


def test_parse_attrs_partial_waits():
    buf = attrs_response(7, (1, b"Title"), (3, b"message"))
    for n in (0, 4, 8, len(buf) - 1):
        assert parse_attrs(buf[:n], 7, 2) is None


def test_parse_attrs_other_uid_ignored():
    assert parse_attrs(attrs_response(8, (1, b"x"), (3, b"y")), 7, 2) == {}


def test_utf8_cut_keeps_whole_chars():
    s = "ЖЖЖ".encode()  # по 2 байта
    assert P.utf8_cut(s, 3) == "Ж".encode()
    assert P.utf8_cut(s, 6) == s


def test_notify_payload():
    p = P.notify_payload(4, "Чат".encode(), b"hello")
    t = "Чат".encode()
    assert p == bytes((4, len(t))) + t + bytes((5,)) + b"hello"
    assert P.encode_notify(3, 4, "Чат".encode(), b"hello") == bytes((2, 0x07, 0, 3)) + p


def test_notify_fits_mtu_185():
    p = P.notify_payload(0, b"t" * 200, b"m" * 300)
    assert P.HEADER_SIZE + len(p) <= 185 - 3
