import { bytesToHex, hexToBytes } from '../../src/ble/protocol/bytes';
import { NavState } from '../../src/ble/protocol/display';
import { encodeFrame, packBitsEncode } from '../../src/ble/protocol/frame';
import { GlassesApi } from '../../src/glasses/api';
import { Bitmap } from '../../src/glasses/bitmap';
import { FrameCompositor } from '../../src/glasses/frameCompositor';
import { renderScreen } from '../../src/glasses/screenRender';
import { createInitialScreenState, selectActiveContent } from '../../src/emulator/screenState';
import { ManeuverIcon } from '../../src/nav/maneuverMap';

/** Кадр в ASCII — удобно смотреть глазами при отладке: console.log(asciiArt(b)). */
function asciiArt(b: Bitmap): string {
  const rows: string[] = [];
  for (let y = 0; y < 40; y += 1) {
    let row = '';
    for (let x = 0; x < 72; x += 1) row += b.getPixel(x, y) ? '#' : '.';
    rows.push(row);
  }
  return rows.join('\n');
}

describe('FRAME (okko/docs/PROTOCOL.md §8, байт в байт)', () => {
  it('весь экран чёрный, PackBits, seq 7', () => {
    const frame = encodeFrame({ x: 0, page: 0, w: 72, hPages: 5 }, new Uint8Array(360), 7);
    expect(bytesToHex(frame)).toBe(bytesToHex(hexToBytes('02300007000048050181008100990' + '0')));
  });

  it('x=10, page=2, w=10, 1 страница, PackBits, seq 8', () => {
    const data = hexToBytes('0000007e11117e000000');
    const frame = encodeFrame({ x: 10, page: 2, w: 10, hPages: 1 }, data, 8);
    expect(bytesToHex(frame)).toBe(
      bytesToHex(hexToBytes('023000080a020a0101fe00007eff11007efe00')),
    );
  });

  it('PackBits не раздувает данные без повторов больше чем на байт на 128', () => {
    const data = Uint8Array.from({ length: 300 }, (_, i) => i % 2);
    expect(packBitsEncode(data).length).toBeLessThanOrEqual(300 + 3);
  });
});

function setup(now = new Date(2026, 9, 25, 9, 5)) {
  const frames: Uint8Array[] = [];
  const compositor = new FrameCompositor(
    async (bytes) => {
      frames.push(bytes);
    },
    () => now,
  );
  const api = new GlassesApi({
    writeDisplay: (bytes) => compositor.handleDisplayPacket(bytes),
    writeControl: async () => undefined,
    onGlassesEvent: () => () => undefined,
  });
  return { frames, compositor, api };
}

describe('FrameCompositor', () => {
  afterEach(() => jest.useRealTimers());

  it('без маршрута показывает часы', () => {
    const state = createInitialScreenState();
    const now = new Date(2026, 9, 25, 9, 5);
    const clock = renderScreen(selectActiveContent(state), state.nav, now);
    const expected = new Bitmap();
    expected.centeredText('09:05', 4, 2);
    expected.centeredText('ВС 25.10', 26);
    expect(asciiArt(clock)).toBe(asciiArt(expected));
  });

  it('при подключении сразу шлёт кадр FRAME v2 на весь экран', async () => {
    jest.useFakeTimers();
    const { frames, compositor } = setup();
    compositor.start();
    await Promise.resolve();
    compositor.stop();
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0]!.subarray(0, 2))).toEqual([0x02, 0x30]);
    expect(Array.from(frames[0]!.subarray(4, 8))).toEqual([0, 0, 72, 5]);
  });

  it('с маршрутом рисует манёвр вместо часов, после остановки — снова часы', async () => {
    const { frames, compositor, api } = setup();
    await compositor.refresh();
    // Без байта seq: он растёт с каждым кадром
    const image = (f: Uint8Array | undefined) => bytesToHex(f!.subarray(4));
    const clockFrame = image(frames.at(-1));

    await api.showNavState(NavState.GUIDING);
    await api.showManeuver({
      icon: ManeuverIcon.RIGHT,
      exitNo: 0,
      distM: 120,
      totalM: 900,
      etaMin: 3,
      street: 'Тверская',
    });
    const navFrame = frames.at(-1)!;
    expect(image(navFrame)).not.toBe(clockFrame);

    await api.showNavState(NavState.OFF);
    await api.clear(2);
    expect(image(frames.at(-1))).toBe(clockFrame);
  });

  it('не шлёт одинаковый кадр повторно', async () => {
    const { frames, compositor } = setup();
    await compositor.refresh();
    await compositor.refresh();
    expect(frames).toHaveLength(1);
  });

  it('NAV_PROGRESS обновляет расстояние на экране манёвра', async () => {
    const { frames, api } = setup();
    await api.showManeuver({
      icon: ManeuverIcon.LEFT,
      exitNo: 0,
      distM: 300,
      totalM: 900,
      etaMin: 3,
      street: '',
    });
    const before = frames.length;
    await api.showProgress(150, 750, 0);
    expect(frames.length).toBe(before + 1);
  });
});

describe('FrameCompositor: уведомления', () => {
  afterEach(() => jest.useRealTimers());

  function setupClock() {
    jest.useFakeTimers();
    let nowMs = new Date(2026, 9, 25, 9, 5).getTime();
    const frames: Uint8Array[] = [];
    const compositor = new FrameCompositor(
      async (bytes) => {
        frames.push(bytes);
      },
      () => new Date(nowMs),
    );
    const api = new GlassesApi({
      writeDisplay: (bytes) => compositor.handleDisplayPacket(bytes),
      writeControl: async () => undefined,
      onGlassesEvent: () => () => undefined,
    });
    const image = (f: Uint8Array | undefined) => bytesToHex(f!.subarray(4));
    const advance = async (ms: number) => {
      nowMs += ms;
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
      await Promise.resolve();
    };
    return { frames, compositor, api, image, advance };
  }

  const notify = { app: 0 as const, prio: 0, ttlS: 5, title: 'Мама', body: 'Позвони' };

  it('на часах показывает уведомление 5 секунд, потом снова часы', async () => {
    const { frames, compositor, api, image, advance } = setupClock();
    await compositor.refresh();
    const clock = image(frames.at(-1));

    await api.showNotify(notify);
    expect(image(frames.at(-1))).not.toBe(clock);

    await advance(4_000);
    expect(image(frames.at(-1))).not.toBe(clock);
    await advance(1_000);
    expect(image(frames.at(-1))).toBe(clock);
  });

  it('во время маршрута уведомление не показывается и не всплывает после', async () => {
    const { frames, api, image, advance } = setupClock();
    await api.showNavState(NavState.GUIDING);
    await api.showManeuver({
      icon: ManeuverIcon.RIGHT,
      exitNo: 0,
      distM: 120,
      totalM: 900,
      etaMin: 3,
      street: '',
    });
    const nav = image(frames.at(-1));
    const count = frames.length;

    await api.showNotify(notify);
    expect(frames.length).toBe(count);

    await api.showNavState(NavState.OFF);
    await api.clear(2);
    await advance(1_000);
    const afterStop = image(frames.at(-1));
    expect(afterStop).not.toBe(nav);
    // после остановки — часы, а не пропущенное уведомление
    const expected = new Bitmap();
    expected.centeredText('09:05', 4, 2);
    expected.centeredText('ВС 25.10', 26);
    expect(afterStop).toBe(
      bytesToHex(encodeFrame({ x: 0, page: 0, w: 72, hPages: 5 }, expected.data, 0).subarray(4)),
    );
  });

  it('с подсказкой «нажми кнопку» уведомление тоже не показывается', async () => {
    const { frames, api } = setupClock();
    await api.showNavState(NavState.READY);
    const count = frames.length;
    await api.showNotify(notify);
    expect(frames.length).toBe(count);
  });
});
