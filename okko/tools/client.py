# Тестовый клиент О.Ч.К.О. на ПК (bleak).
#   python tools/client.py info
#   python tools/client.py image picture.png
#   python tools/client.py text "Hello"
#   python tools/client.py rect               — маленький прямоугольник
#   python tools/client.py bad                — заведомо битые пакеты, печать кодов RESULT
#   python tools/client.py brightness 0..255
#   python tools/client.py record 10 out.wav  — запись N секунд в WAV
#   python tools/client.py listen             — печатать события
import argparse
import asyncio
import os
import struct
import sys
import time
import wave

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bleak import BleakClient, BleakScanner  # noqa: E402

from okko import adpcm  # noqa: E402
from okko import protocol as P  # noqa: E402
import frame_tool as FT  # noqa: E402

STATUS = {v: k for k, v in vars(P).items() if k.startswith("ST_")}
BTN = {1: "short", 2: "hold", 3: "release", 4: "double"}


class Client:
    def __init__(self, c):
        self.c = c
        self.seq = {P.CH_DISPLAY: 0, P.CH_CONTROL: 0}
        self.results = asyncio.Queue()
        self.audio = []
        self.audio_done = asyncio.Event()
        self.t_sent = {}

    def on_event(self, _s, data):
        data = bytes(data)
        t = data[1]
        if t == P.EV_RESULT:
            ch, seq, typ, st = data[4:8]
            dt = time.perf_counter() - self.t_sent.get((ch, seq), time.perf_counter())
            print("RESULT chan=%d seq=%d type=0x%02x %s (%.1f мс)" % (ch, seq, typ, STATUS.get(st, st), dt * 1000))
            self.results.put_nowait(st)
        elif t == P.EV_BUTTON:
            print("BUTTON", BTN.get(data[4], data[4]))
        elif t == P.EV_BATTERY:
            pct, mv, ch = struct.unpack_from("<BHB", data, 4)
            print("BATTERY %d%% %d мВ charging=%d" % (pct, mv, ch))
        elif t == P.EV_ERROR:
            print("ERROR", data[4], data[6:6 + data[5]].decode(errors="replace"))
        else:
            print("event", data.hex(" "))

    def on_audio(self, _s, data):
        seq, flags, pred, idx = struct.unpack_from("<HBhB", data)
        self.audio.append((seq, flags, adpcm.decode(data[6:], pred, idx)))
        if flags & P.AF_LAST:
            self.audio_done.set()

    async def send(self, chan, type_, payload, wait=True):
        uuid = P.UUID_DISPLAY if chan == P.CH_DISPLAY else P.UUID_CONTROL
        seq = self.seq[chan]
        self.seq[chan] = (seq + 1) & 0xFF
        chunk = max(20, self.c.mtu_size - 3 - P.HEADER_SIZE)
        self.t_sent[(chan, seq)] = time.perf_counter()
        for f in P.fragment(type_, seq, payload, chunk):
            await self.c.write_gatt_char(uuid, f, response=True)
        if wait:
            try:
                return await asyncio.wait_for(self.results.get(), 1.0)
            except asyncio.TimeoutError:
                print("нет RESULT за 1 с")

    async def raw(self, chan, pkt):
        uuid = P.UUID_DISPLAY if chan == P.CH_DISPLAY else P.UUID_CONTROL
        await self.c.write_gatt_char(uuid, pkt, response=True)
        try:
            await asyncio.wait_for(self.results.get(), 1.0)
        except asyncio.TimeoutError:
            print("нет RESULT за 1 с")


async def find():
    print("поиск OCHKO…")
    d = await BleakScanner.find_device_by_filter(
        lambda d, ad: P.UUID_SERVICE in (ad.service_uuids or []) or (d.name or "") == "OCHKO", timeout=15)
    if not d:
        sys.exit("не найдено")
    return d


async def main(a):
    dev = await find()
    async with BleakClient(dev) as c:
        try:
            await c.pair()
        except Exception as e:
            print("pair:", e, "(код сопряжения на OLED)")
        cl = Client(c)
        info = await c.read_gatt_char(P.UUID_INFO)
        pv, ma, mi, pa, caps, w, h = struct.unpack("<BBBBHBB", info)
        print("info: proto %d fw %d.%d.%d caps 0x%04x %dx%d, MTU %d" % (pv, ma, mi, pa, caps, w, h, c.mtu_size))
        await c.start_notify(P.UUID_EVENTS, cl.on_event)
        await c.start_notify(P.UUID_AUDIO, cl.on_audio)

        if a.cmd == "image":
            from PIL import Image
            await cl.send(P.CH_DISPLAY, P.T_FRAME, FT.frame_payload(FT.image_to_vlsb(Image.open(a.args[0]))))
        elif a.cmd == "text":
            await cl.send(P.CH_DISPLAY, P.T_FRAME, FT.frame_payload(FT.text_to_vlsb(" ".join(a.args).replace("\\n", "\n"))))
        elif a.cmd == "rect":
            await cl.send(P.CH_DISPLAY, P.T_FRAME, bytes.fromhex("0a020a0101fe00007eff11007efe00"))
            await cl.send(P.CH_DISPLAY, P.T_FRAME, bytes((30, 1, 12, 3, 0)) + bytes([0xFF]) * 36)
        elif a.cmd == "clear":
            await cl.send(P.CH_DISPLAY, P.T_CLEAR, b"\x00")
        elif a.cmd == "brightness":
            await cl.send(P.CH_CONTROL, P.T_BRIGHTNESS, bytes((int(a.args[0]),)))
        elif a.cmd == "time":
            off = -time.timezone // 60
            await cl.send(P.CH_CONTROL, P.T_SET_TIME, struct.pack("<Ih", int(time.time()), off))
        elif a.cmd == "bad":
            print("ожидается OUT_OF_BOUNDS:")
            await cl.send(P.CH_DISPLAY, P.T_FRAME, bytes((70, 0, 10, 1, 0)) + bytes(10))
            print("ожидается BAD_LENGTH:")
            await cl.send(P.CH_DISPLAY, P.T_FRAME, bytes((0, 0, 10, 1, 0)) + bytes(9))
            print("ожидается DECODE_ERROR:")
            await cl.send(P.CH_DISPLAY, P.T_FRAME, bytes((0, 0, 10, 1, 1)) + b"\xfe\x00")
            await cl.send(P.CH_DISPLAY, P.T_FRAME, bytes((0, 0, 10, 1, 9)) + bytes(10))
            print("ожидается UNKNOWN_TYPE:")
            await cl.send(P.CH_DISPLAY, 0x50, b"")
            print("ожидается BAD_VERSION:")
            await cl.raw(P.CH_DISPLAY, bytes((1, P.T_FRAME, 0, 200)) + bytes((0, 0, 1, 1, 0, 0)))
            print("ожидается FRAGMENT_ERROR:")
            await cl.raw(P.CH_DISPLAY, bytes((2, P.T_FRAME, P.F_LAST, 201, 0)))
        elif a.cmd == "record":
            secs = float(a.args[0]) if a.args else 5
            out = a.args[1] if len(a.args) > 1 else "out.wav"
            await cl.send(P.CH_CONTROL, P.T_AUDIO_CTRL, b"\x01")
            await asyncio.sleep(secs)
            await cl.send(P.CH_CONTROL, P.T_AUDIO_CTRL, b"\x00")
            try:
                await asyncio.wait_for(cl.audio_done.wait(), 2)
            except asyncio.TimeoutError:
                print("нет последнего кадра")
            frames = cl.audio
            if frames:
                seqs = [f[0] for f in frames]
                expect = ((seqs[-1] - seqs[0]) & 0xFFFF) + 1
                lost = expect - len(frames)
                print("кадров %d, потеряно %d (%.2f %%)" % (len(frames), lost, 100.0 * lost / expect))
                with wave.open(out, "wb") as w:
                    w.setnchannels(1)
                    w.setsampwidth(2)
                    w.setframerate(16000)
                    w.writeframes(b"".join(struct.pack("<%dh" % len(s), *s) for _, _, s in frames))
                print("записано", out)
        if a.cmd == "listen" or a.cmd in ("image", "text", "rect") and a.listen:
            print("Ctrl+C для выхода")
            while True:
                await asyncio.sleep(1)
        await asyncio.sleep(0.3)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["info", "image", "text", "rect", "clear", "brightness", "time", "bad", "record", "listen"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--listen", action="store_true", help="после команды печатать события")
    try:
        asyncio.run(main(ap.parse_args()))
    except KeyboardInterrupt:
        pass
