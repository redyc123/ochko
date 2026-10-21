from okko import protocol as P


def h(s):
    return bytes.fromhex(s.replace(" ", ""))


def test_frame_black_packbits():
    from okko import packbits
    data = packbits.encode(bytes(360))
    assert P.encode_frame(0, 0, 72, 5, 1, data, 7) == h("02 30 00 07 00 00 48 05 01 81 00 81 00 99 00")


def test_frame_rect_packbits():
    from okko import packbits
    data = packbits.encode(h("00 00 00 7e 11 11 7e 00 00 00"))
    assert P.encode_frame(10, 2, 10, 1, 1, data, 8) == h("02 30 00 08 0a 02 0a 01 01 fe 00 00 7e ff 11 00 7e fe 00")


def test_clear():
    assert P.encode_message(P.T_CLEAR, 9, b"\x00") == h("02 7f 00 09 00")


def test_result():
    assert P.encode_result(3, P.CH_DISPLAY, 7, P.T_FRAME, P.ST_OK) == h("02 06 00 03 00 07 30 00")
    assert P.encode_result(4, P.CH_DISPLAY, 9, P.T_FRAME, P.ST_OUT_OF_BOUNDS) == h("02 06 00 04 00 09 30 04")


def test_button():
    assert P.encode_button(5, P.BTN_DOUBLE) == h("02 01 00 05 04")


def test_battery():
    assert P.encode_battery(6, 87, 3950, False) == h("02 04 00 06 57 6e 0f 00")


def test_error():
    assert P.encode_error(10, P.ERR_MTU, "MTU") == h("02 05 00 0a 02 03 4d 54 55")


def test_info():
    assert P.encode_info((0, 1, 0), 0x0031) == h("02 00 01 00 31 00 48 28")


def test_audio_header():
    b = bytearray(6)
    P.audio_header(b, 1, P.AF_FIRST, -12, 5)
    assert bytes(b) == h("01 00 01 f4 ff 05")


def test_rect_bounds():
    assert P.check_rect(0, 0, 72, 5)
    assert not P.check_rect(1, 0, 72, 5)
    assert not P.check_rect(0, 1, 72, 5)
    assert not P.check_rect(0, 0, 0, 1)
    assert not P.check_rect(0, 0, 1, 0)


def test_versions():
    assert P.ver_allowed(P.CH_DISPLAY, 2, P.T_FRAME)
    assert not P.ver_allowed(P.CH_DISPLAY, 1, P.T_FRAME)
    assert P.ver_allowed(P.CH_DISPLAY, 1, P.T_CLEAR)
    assert P.ver_allowed(P.CH_CONTROL, 1, P.T_BRIGHTNESS)
    assert not P.ver_allowed(P.CH_CONTROL, 3, P.T_BRIGHTNESS)


# --- фрагментация ---

def _payload(n):
    return bytes(i & 0xFF for i in range(n))


def test_single():
    r = P.Reassembler()
    assert r.feed(P.encode_message(0x30, 1, b"abc")) == P.COMPLETE
    assert bytes(r.payload()) == b"abc" and r.seq == 1 and r.type == 0x30 and r.ver == 2


def test_two_and_three_fragments():
    for n, chunk in ((300, 200), (500, 200)):
        r = P.Reassembler()
        frags = P.fragment(0x30, 5, _payload(n), chunk)
        assert len(frags) == (n + chunk - 1) // chunk
        for f in frags[:-1]:
            assert r.feed(f) == P.NEED_MORE
        assert r.feed(frags[-1]) == P.COMPLETE
        assert bytes(r.payload()) == _payload(n)


def test_lost_middle_fragment_gives_wrong_data_length():
    # потерянный средний фрагмент: сообщение собирается короче, ошибку длины ловит обработчик
    r = P.Reassembler()
    f = P.fragment(0x30, 5, _payload(500), 200)
    r.feed(f[0])
    assert r.feed(f[2]) == P.COMPLETE
    assert r.length == 300


def test_lost_first_fragment():
    r = P.Reassembler()
    f = P.fragment(0x30, 5, _payload(300), 200)
    assert r.feed(f[1]) == P.ST_FRAGMENT_ERROR
    assert r.seq == 5 and r.type == 0x30


def test_foreign_seq_in_middle():
    r = P.Reassembler()
    a = P.fragment(0x30, 5, _payload(500), 200)
    b = P.fragment(0x30, 6, _payload(300), 200)
    r.feed(a[0])
    assert r.feed(b[0]) == P.NEED_MORE  # старое сообщение выброшено
    assert r.feed(a[1]) == P.NEED_MORE  # снова чужой seq: начинается заново
    assert r.feed(a[2]) == P.COMPLETE
    assert r.seq == 5 and r.length == 300
    r2 = P.Reassembler()
    r2.feed(a[0])
    r2.feed(b[0])
    assert r2.feed(b[1]) == P.COMPLETE
    assert bytes(r2.payload()) == _payload(300)


def test_tail_without_start():
    r = P.Reassembler()
    assert r.feed(P.encode_message(0x30, 9, b"x", P.F_LAST)) == P.ST_FRAGMENT_ERROR


def test_overflow():
    r = P.Reassembler()
    f = P.fragment(0x30, 1, _payload(1300), 200)
    res = [r.feed(x) for x in f]
    assert res.count(P.ST_BAD_LENGTH) == 1
    assert P.ST_FRAGMENT_ERROR not in res
    assert res[-1] == P.NEED_MORE
    # после переполнения следующее сообщение принимается нормально
    assert r.feed(P.encode_message(0x7F, 2, b"\x00")) == P.COMPLETE
    assert r.feed(P.encode_message(0x30, 3, bytes(1025))) == P.ST_BAD_LENGTH
    assert r.feed(P.encode_message(0x30, 4, bytes(1024))) == P.COMPLETE


def test_short_packet():
    r = P.Reassembler()
    assert r.feed(b"\x02\x30") == P.ST_BAD_LENGTH
