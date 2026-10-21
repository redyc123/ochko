import random

from okko import packbits


def _roundtrip(data):
    enc = packbits.encode(data)
    out = bytearray(len(data))
    assert packbits.decode_into(enc, out, len(data)) == len(data)
    assert bytes(out) == bytes(data)


def test_roundtrip_random():
    random.seed(1)
    for _ in range(200):
        n = random.randint(1, 360)
        mode = random.randint(0, 2)
        if mode == 0:
            data = bytes(random.getrandbits(8) for _ in range(n))
        elif mode == 1:
            data = bytes(random.randint(0, 2) for _ in range(n))
        else:
            data = bytes((i // random.randint(1, 50)) & 0xFF for i in range(n))
        _roundtrip(data)


def test_edges():
    for d in (b"\x00", bytes(128), bytes(129), bytes(360), bytes(range(256)) + bytes(104), b"\x01\x02" * 180):
        _roundtrip(d)


def test_skip_128():
    out = bytearray(2)
    assert packbits.decode_into(b"\x80\xff\x07", out, 2) == 2 and out == bytearray(b"\x07\x07")


def test_broken():
    out = bytearray(360)
    bad = (
        b"",  # пусто при ожидании 10 байт
        b"\x05\x01\x02",  # литерал короче заявленного
        b"\xfe",  # повтор без байта
        b"\xfe\x00",  # 3 байта вместо 10
        b"\x81\x00",  # 128 байт вместо 10
        b"\xf7\x00\x00\x01",  # 10 + лишний литерал
    )
    for b in bad:
        assert packbits.decode_into(b, out, 10) == -1, b
    assert packbits.decode_into(b"\x00\x01", bytearray(1), 2) == -1
