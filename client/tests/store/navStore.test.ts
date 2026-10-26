import { NavState } from '@/ble/protocol/display';
import { ManeuverIcon } from '@/nav/maneuverMap';
import { encodePolyline6 } from '@/nav/polyline';
import type { LatLng } from '@/nav/types';
import { useDeviceStore } from '@/store/deviceStore';
import { useNavStore } from '@/store/navStore';

const ORIGIN: LatLng = { lat: 0, lon: 0 };

function nominatimResult(lat: number, lon: number, name = 'Пятёрочка') {
  return { display_name: name, lat: String(lat), lon: String(lon), type: 'shop', importance: 0.5 };
}

interface OsrmManeuverSpec {
  type: string;
  modifier?: string;
  exit?: number;
}

/**
 * Строит сырой ответ OSRM /route/v1 из цельного shape и списка манёвров,
 * разрезая shape на пересекающиеся по границе куски (ровно так, как это
 * делают настоящие per-step geometry у OSRM) — чтобы де-дуп в
 * parseOsrmResponse склеил их обратно в тот же shape, что мы передали сюда.
 */
function osrmRouteFor(shape: LatLng[], maneuvers: OsrmManeuverSpec[]) {
  const n = maneuvers.length;
  const step = shape.length > 1 ? Math.floor((shape.length - 1) / n) || 1 : 0;
  const boundaries: number[] = [0];
  for (let i = 1; i < n; i += 1) {
    boundaries.push(i * step);
  }
  boundaries.push(shape.length - 1);

  const steps = maneuvers.map((m, i) => {
    const from = boundaries[i]!;
    const to = boundaries[i + 1]!;
    const slice = shape.length > 0 ? shape.slice(from, to + 1) : [];
    return {
      distance: 50,
      duration: 30,
      name: `ул. №${i}`,
      geometry: encodePolyline6(slice.length > 0 ? slice : [shape[shape.length - 1]!]),
      maneuver: { type: m.type, modifier: m.modifier, exit: m.exit },
    };
  });

  return {
    code: 'Ok',
    routes: [{ distance: 100 * n, duration: 60 * n, legs: [{ steps }] }],
  };
}

function mockFetch(handlers: { nominatim?: unknown; osrm?: unknown }) {
  return jest.fn(async (url: string) => {
    if (url.includes('/route/v1/')) {
      return { ok: true, status: 200, json: async () => handlers.osrm };
    }
    return { ok: true, status: 200, json: async () => handlers.nominatim ?? [] };
  });
}

beforeEach(() => {
  useNavStore.setState({
    settings: useNavStore.getState().settings,
    profile: 'pedestrian',
    status: 'idle',
    query: '',
    candidates: [],
    destination: null,
    route: null,
    errorMessage: null,
    currentPosition: null,
    lastFixAtMs: null,
    gpsOk: true,
    simulationEnabled: false,
    simulator: null,
  });
  useDeviceStore.setState({ mode: 'emulator' });
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn();
});

describe('navigateTo: геокодинг', () => {
  it('ровно один результат — сразу строит маршрут (без автостарта)', async () => {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.002)],
      osrm: osrmRouteFor(shape, [{ type: 'depart' }, { type: 'arrive' }]),
    });

    await useNavStore.getState().navigateTo('Пятёрочка на Ленина');

    const state = useNavStore.getState();
    expect(state.status).toBe('ready');
    expect(state.route?.shape.length).toBe(2);
  });

  it('несколько результатов — status=choosing со списком кандидатов', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.001, 'Вариант 1'), nominatimResult(0, 0.002, 'Вариант 2')],
    });

    await useNavStore.getState().navigateTo('аптека');

    const state = useNavStore.getState();
    expect(state.status).toBe('choosing');
    expect(state.candidates).toHaveLength(2);
  });

  it('ничего не найдено — status=error', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({ nominatim: [] });
    await useNavStore.getState().navigateTo('несуществующий адрес');
    expect(useNavStore.getState().status).toBe('error');
    expect(useNavStore.getState().errorMessage).toMatch(/не найдено/i);
  });

  it('без текущей позиции — ошибка «нет GPS», даже если геокодинг успешен', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.001)],
    });
    await useNavStore.getState().navigateTo('Пятёрочка');
    expect(useNavStore.getState().status).toBe('error');
    expect(useNavStore.getState().errorMessage).toMatch(/GPS/);
  });

  it('chooseDestination строит маршрут по выбранному варианту', async () => {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      osrm: osrmRouteFor(shape, [{ type: 'depart' }, { type: 'arrive' }]),
    });

    await useNavStore
      .getState()
      .chooseDestination({ displayName: 'x', lat: 0, lon: 0.002, type: 'shop', importance: 0.5 });

    expect(useNavStore.getState().status).toBe('ready');
    expect(useNavStore.getState().route).not.toBeNull();
  });
});

describe('startNavigation / stopNavigation', () => {
  it('startNavigation переводит в navigating и шлёт NAV_STATE GUIDING на экран', async () => {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.002)],
      osrm: osrmRouteFor(shape, [{ type: 'depart' }, { type: 'arrive' }]),
    });
    await useNavStore.getState().navigateTo('цель');

    useNavStore.getState().startNavigation(0);

    expect(useNavStore.getState().status).toBe('navigating');
    expect(useDeviceStore.getState().emulator.getScreenState().nav.state).toBe(NavState.GUIDING);
  });

  it('stopNavigation сбрасывает маршрут и очищает слой навигации на экране', async () => {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.002)],
      osrm: osrmRouteFor(shape, [{ type: 'depart' }, { type: 'arrive' }]),
    });
    await useNavStore.getState().navigateTo('цель');
    useNavStore.getState().startNavigation(0);

    useNavStore.getState().stopNavigation();

    expect(useNavStore.getState().status).toBe('idle');
    expect(useNavStore.getState().route).toBeNull();
    expect(useDeviceStore.getState().emulator.getScreenState().nav.state).toBe(NavState.OFF);
  });
});

describe('updatePosition: манёвры, прогресс, прибытие', () => {
  async function setUpNavigating() {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape: LatLng[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.001 },
      { lat: 0, lon: 0.002 },
    ];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.002)],
      osrm: osrmRouteFor(shape, [{ type: 'depart' }, { type: 'turn', modifier: 'right' }]),
    });
    await useNavStore.getState().navigateTo('цель');
    useNavStore.getState().startNavigation(0);
    return shape;
  }

  it('при смене манёвра отправляет showManeuver с правильной иконкой', async () => {
    await setUpNavigating();
    useNavStore.getState().updatePosition({ lat: 0, lon: 0 }, 1000);

    // На старте (сегмент манёвра 0 — depart) «upcoming» — это следующий
    // манёвр (turn/right): streetNames и иконка относятся к улице ПОСЛЕ поворота.
    const maneuver = useDeviceStore.getState().emulator.getScreenState().nav.maneuver;
    expect(maneuver).not.toBeNull();
    expect(maneuver?.icon).toBe(ManeuverIcon.RIGHT);
  });

  it('прогресс отправляется и обновляется при движении (не чаще 1 раза в секунду, порог 5м)', async () => {
    await setUpNavigating();
    useNavStore.getState().updatePosition({ lat: 0, lon: 0 }, 1000);
    const firstProgress = useDeviceStore.getState().emulator.getScreenState().nav.progress;
    expect(firstProgress).not.toBeNull();

    useNavStore.getState().updatePosition({ lat: 0, lon: 0.0003 }, 2500);
    const secondProgress = useDeviceStore.getState().emulator.getScreenState().nav.progress;
    expect(secondProgress?.distM).not.toBe(firstProgress?.distM);
  });

  it('приближение к цели (< 15 м) переводит в arrived и шлёт NAV_STATE ARRIVED', async () => {
    await setUpNavigating();
    useNavStore.getState().updatePosition({ lat: 0, lon: 0.002 }, 1000);

    expect(useNavStore.getState().status).toBe('arrived');
    expect(useDeviceStore.getState().emulator.getScreenState().nav.state).toBe(NavState.ARRIVED);
  });

  it('устойчивый сход с маршрута (>30м дольше 10с) запускает перестроение', async () => {
    const originalShape = await setUpNavigating();
    const farPoint: LatLng = { lat: 0.001, lon: 0.0005 }; // далеко в стороне от прямой

    useNavStore.getState().updatePosition(farPoint, 0);
    expect(useNavStore.getState().status).toBe('navigating');

    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      osrm: osrmRouteFor(originalShape, [{ type: 'depart' }, { type: 'turn', modifier: 'right' }]),
    });
    useNavStore.getState().updatePosition(farPoint, 10_001);

    expect(useNavStore.getState().status).toBe('rerouting');
    // OsrmRouter в сторе не получает фейковый sleep/now, поэтому честно ждёт
    // свою паузу между запросами (minIntervalMs=1000 по умолчанию) — ждём с запасом.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(useNavStore.getState().status).toBe('navigating');
  });
});

describe('checkGpsTimeout', () => {
  it('переводит gpsOk в false и шлёт NAV_STATE NO_GPS после 10 с без фиксов', async () => {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.002)],
      osrm: osrmRouteFor(shape, [{ type: 'depart' }, { type: 'arrive' }]),
    });
    await useNavStore.getState().navigateTo('цель');
    useNavStore.getState().startNavigation(0);
    useNavStore.getState().updatePosition(ORIGIN, 0);

    useNavStore.getState().checkGpsTimeout(10_001);

    expect(useNavStore.getState().gpsOk).toBe(false);
    expect(useDeviceStore.getState().emulator.getScreenState().nav.state).toBe(NavState.NO_GPS);
  });

  it('startNavigation сбрасывает отсчёт устаревания — старый фикс до старта не триггерит NO_GPS сразу', async () => {
    useNavStore.getState().updatePosition(ORIGIN, 0); // фикс есть, но он «старый» на момент старта
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.002)],
      osrm: osrmRouteFor(shape, [{ type: 'depart' }, { type: 'arrive' }]),
    });
    await useNavStore.getState().navigateTo('цель');

    // Старт навигации случился спустя 20с после последнего фикса (например,
    // пользователь долго выбирал вариант маршрута) — TTFF на реальном GPS
    // после этого тоже может занять время, поэтому отсчёт идёт заново.
    useNavStore.getState().startNavigation(20_000);

    useNavStore.getState().checkGpsTimeout(20_500);
    expect(useNavStore.getState().gpsOk).toBe(true);

    // Но если фикса всё ещё нет спустя >10с от самого старта — таймаут сработает.
    useNavStore.getState().checkGpsTimeout(30_001);
    expect(useNavStore.getState().gpsOk).toBe(false);
  });
});

describe('enableSimulation / tickSimulation', () => {
  it('включает симулятор и двигает позицию при тике', async () => {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape: LatLng[] = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.1 },
    ];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.1)],
      osrm: osrmRouteFor(shape, [{ type: 'depart' }, { type: 'arrive' }]),
    });
    await useNavStore.getState().navigateTo('далёкая цель');
    useNavStore.getState().startNavigation(0);

    useNavStore.getState().enableSimulation(true, 10);
    expect(useNavStore.getState().simulator).not.toBeNull();

    useNavStore.getState().simulator!.start(0);
    useNavStore.getState().tickSimulation(5000);

    expect(useNavStore.getState().currentPosition).not.toEqual(ORIGIN);
  });
});

describe('кнопка очков', () => {
  async function buildReadyRoute() {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.002)],
      osrm: osrmRouteFor(shape, [{ type: 'depart' }, { type: 'arrive' }]),
    });
    await useNavStore.getState().navigateTo('Пятёрочка');
  }

  it('после построения маршрута на очках подсказка нажать кнопку', async () => {
    await buildReadyRoute();
    expect(useDeviceStore.getState().emulator.getScreenState().nav.state).toBe(NavState.READY);
  });

  it('короткое нажатие запускает маршрут, удержание сбрасывает', async () => {
    await buildReadyRoute();
    const emulator = useDeviceStore.getState().emulator;
    emulator.pressButton(1);
    expect(useNavStore.getState().status).toBe('navigating');
    emulator.pressButton(2);
    expect(useNavStore.getState().status).toBe('idle');
    expect(useNavStore.getState().route).toBeNull();
  });

  it('короткое нажатие без маршрута ничего не делает', () => {
    useDeviceStore.getState().emulator.pressButton(1);
    expect(useNavStore.getState().status).toBe('idle');
  });
});
