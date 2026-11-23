import { NavState } from '@/ble/protocol/display';
import { ManeuverIcon } from '@/nav/maneuverMap';
import type { LatLng, Route, RouteProfile } from '@/nav/types';
import { useDeviceStore } from '@/store/deviceStore';
import { useNavStore } from '@/store/navStore';

const ORIGIN: LatLng = { lat: 0, lon: 0 };

function geocodeResult(lat: number, lon: number, name = 'Пятёрочка') {
  return { displayName: name, lat, lon, type: 'shop', importance: 0.5 };
}

interface ServerManeuverSpec {
  type: number;
}

/**
 * Строит ответ сервера /route из цельного shape и списка манёвров, разрезая
 * shape на пересекающиеся по границе куски (как per-step geometry у OSRM),
 * чтобы клиентский trackPosition корректно вычислял upcoming-манёвр.
 */
function serverRouteFor(shape: LatLng[], maneuvers: ServerManeuverSpec[]): Route {
  const n = maneuvers.length;
  const step = shape.length > 1 ? Math.floor((shape.length - 1) / n) || 1 : 0;
  const boundaries: number[] = [0];
  for (let i = 1; i < n; i += 1) boundaries.push(i * step);
  boundaries.push(shape.length - 1);

  const maneuverList = maneuvers.map((m, i) => ({
    type: m.type,
    streetNames: [`ул. №${i}`],
    distanceMeters: 50,
    durationSeconds: 30,
    beginShapeIndex: boundaries[i]!,
    endShapeIndex: boundaries[i + 1]!,
  }));

  return {
    shape,
    maneuvers: maneuverList,
    distanceMeters: 100 * n,
    durationSeconds: 60 * n,
    profile: 'pedestrian' as RouteProfile,
  };
}

function mockFetch(handlers: { geocode?: unknown; route?: unknown }) {
  return jest.fn(async (url: string) => {
    if (url.includes('/route')) {
      return { ok: true, status: 200, json: async () => ({ route: handlers.route }) };
    }
    return { ok: true, status: 200, json: async () => handlers.geocode ?? { results: [] } };
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
    destinationName: null,
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
      geocode: { results: [geocodeResult(0, 0.002)] },
      route: serverRouteFor(shape, [{ type: ManeuverIcon.START }, { type: ManeuverIcon.ARRIVE }]),
    });

    await useNavStore.getState().navigateTo('Пятёрочка на Ленина');

    const state = useNavStore.getState();
    expect(state.status).toBe('ready');
    expect(state.destinationName).toBe('Пятёрочка');
    expect(state.route?.shape.length).toBe(2);
  });

  it('несколько результатов — status=choosing со списком кандидатов', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      geocode: { results: [geocodeResult(0, 0.001, 'Вариант 1'), geocodeResult(0, 0.002, 'Вариант 2')] },
    });

    await useNavStore.getState().navigateTo('аптека');

    const state = useNavStore.getState();
    expect(state.status).toBe('choosing');
    expect(state.candidates).toHaveLength(2);
  });

  it('ничего не найдено — status=error', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({ geocode: { results: [] } });
    await useNavStore.getState().navigateTo('несуществующий адрес');
    expect(useNavStore.getState().status).toBe('error');
    expect(useNavStore.getState().errorMessage).toMatch(/не найдено/i);
  });

  it('без текущей позиции — ошибка «нет GPS», даже если геокодинг успешен', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      geocode: { results: [geocodeResult(0, 0.001)] },
    });
    await useNavStore.getState().navigateTo('Пятёрочка');
    expect(useNavStore.getState().status).toBe('error');
    expect(useNavStore.getState().errorMessage).toMatch(/GPS/);
  });

  it('chooseDestination строит маршрут по выбранному варианту', async () => {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      route: serverRouteFor(shape, [{ type: ManeuverIcon.START }, { type: ManeuverIcon.ARRIVE }]),
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
      geocode: { results: [geocodeResult(0, 0.002)] },
      route: serverRouteFor(shape, [{ type: ManeuverIcon.START }, { type: ManeuverIcon.ARRIVE }]),
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
      geocode: { results: [geocodeResult(0, 0.002)] },
      route: serverRouteFor(shape, [{ type: ManeuverIcon.START }, { type: ManeuverIcon.ARRIVE }]),
    });
    await useNavStore.getState().navigateTo('цель');
    useNavStore.getState().startNavigation(0);

    useNavStore.getState().stopNavigation();

    expect(useNavStore.getState().status).toBe('idle');
    expect(useNavStore.getState().route).toBeNull();
    expect(useNavStore.getState().destinationName).toBeNull();
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
      geocode: { results: [geocodeResult(0, 0.002)] },
      route: serverRouteFor(shape, [
        { type: ManeuverIcon.START },
        { type: ManeuverIcon.RIGHT },
      ]),
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
      route: serverRouteFor(originalShape, [
        { type: ManeuverIcon.START },
        { type: ManeuverIcon.RIGHT },
      ]),
    });
    useNavStore.getState().updatePosition(farPoint, 10_001);

    expect(useNavStore.getState().status).toBe('rerouting');
    // Маршрут строится через серверный прокси (мок), паузы между запросами
    // нет (в отличие от прежнего OsrmRouter с minIntervalMs=1000), поэтому
    // дождаться возврата в 'navigating' можно одной завершённой цепочкой.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useNavStore.getState().status).toBe('navigating');
  });
});

describe('checkGpsTimeout', () => {
  it('переводит gpsOk в false и шлёт NAV_STATE NO_GPS после 10 с без фиксов', async () => {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      geocode: { results: [geocodeResult(0, 0.002)] },
      route: serverRouteFor(shape, [{ type: ManeuverIcon.START }, { type: ManeuverIcon.ARRIVE }]),
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
      geocode: { results: [geocodeResult(0, 0.002)] },
      route: serverRouteFor(shape, [{ type: ManeuverIcon.START }, { type: ManeuverIcon.ARRIVE }]),
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
      geocode: { results: [geocodeResult(0, 0.1)] },
      route: serverRouteFor(shape, [{ type: ManeuverIcon.START }, { type: ManeuverIcon.ARRIVE }]),
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
      geocode: { results: [geocodeResult(0, 0.002)] },
      route: serverRouteFor(shape, [{ type: ManeuverIcon.START }, { type: ManeuverIcon.ARRIVE }]),
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

describe('applyServerRoute (из /agent action)', () => {
  it('ставит маршрут в ready, не запуская навигацию', () => {
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    const route = serverRouteFor(shape, [
      { type: ManeuverIcon.START },
      { type: ManeuverIcon.ARRIVE },
    ]);

    useNavStore.getState().applyServerRoute({ lat: 0, lon: 0.002, displayName: 'Театр' }, route);

    expect(useNavStore.getState().status).toBe('ready');
    expect(useNavStore.getState().destinationName).toBe('Театр');
    expect(useNavStore.getState().route).not.toBeNull();
    expect(useDeviceStore.getState().emulator.getScreenState().nav.state).toBe(NavState.READY);
  });
});