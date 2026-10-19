import { NavState } from '../ble/protocol/display';
import { ManeuverIcon } from '../nav/maneuverMap';
import { encodePolyline6 } from '../nav/polyline';
import type { LatLng } from '../nav/types';
import { useDeviceStore } from './deviceStore';
import { useNavStore } from './navStore';

const ORIGIN: LatLng = { lat: 0, lon: 0 };

function nominatimResult(lat: number, lon: number, name = 'Пятёрочка') {
  return { display_name: name, lat: String(lat), lon: String(lon), type: 'shop', importance: 0.5 };
}

function valhallaRouteFor(shape: LatLng[], maneuverTypes: number[]) {
  const step = shape.length > 1 ? Math.floor((shape.length - 1) / maneuverTypes.length) || 1 : 0;
  const maneuvers = maneuverTypes.map((type, i) => ({
    type,
    instruction: '',
    street_names: [`ул. №${i}`],
    length: 0.05,
    time: 30,
    begin_shape_index: i * step,
    end_shape_index: i === maneuverTypes.length - 1 ? shape.length - 1 : (i + 1) * step,
  }));
  return {
    trip: {
      legs: [{ shape: encodePolyline6(shape), maneuvers }],
      summary: { length: 0.1 * maneuverTypes.length, time: 60 * maneuverTypes.length },
    },
  };
}

function mockFetch(handlers: { nominatim?: unknown; valhalla?: unknown }) {
  return jest.fn(async (url: string) => {
    if (url.includes('nominatim') || url.includes('/search?')) {
      return { ok: true, status: 200, json: async () => handlers.nominatim ?? [] };
    }
    return { ok: true, status: 200, json: async () => handlers.valhalla };
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
      valhalla: valhallaRouteFor(shape, [1, 4]),
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
      valhalla: valhallaRouteFor(shape, [1, 4]),
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
      valhalla: valhallaRouteFor(shape, [1, 4]),
    });
    await useNavStore.getState().navigateTo('цель');

    useNavStore.getState().startNavigation();

    expect(useNavStore.getState().status).toBe('navigating');
    expect(useDeviceStore.getState().emulator.getScreenState().nav.state).toBe(NavState.GUIDING);
  });

  it('stopNavigation сбрасывает маршрут и очищает слой навигации на экране', async () => {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.002)],
      valhalla: valhallaRouteFor(shape, [1, 4]),
    });
    await useNavStore.getState().navigateTo('цель');
    useNavStore.getState().startNavigation();

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
      valhalla: valhallaRouteFor(shape, [1, 10]), // CONTINUE, RIGHT
    });
    await useNavStore.getState().navigateTo('цель');
    useNavStore.getState().startNavigation();
    return shape;
  }

  it('при смене манёвра отправляет showManeuver с правильной иконкой', async () => {
    await setUpNavigating();
    useNavStore.getState().updatePosition({ lat: 0, lon: 0 }, 1000);

    // На старте (сегмент манёвра 0 — CONTINUE) «upcoming» — это следующий
    // манёвр (RIGHT): streetNames и иконка относятся к улице ПОСЛЕ поворота.
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
      valhalla: valhallaRouteFor(originalShape, [1, 10]),
    });
    useNavStore.getState().updatePosition(farPoint, 10_001);

    expect(useNavStore.getState().status).toBe('rerouting');
    await new Promise((resolve) => setTimeout(resolve, 20)); // дождаться асинхронного пересчёта маршрута
    expect(useNavStore.getState().status).toBe('navigating');
  });
});

describe('checkGpsTimeout', () => {
  it('переводит gpsOk в false и шлёт NAV_STATE NO_GPS после 10 с без фиксов', async () => {
    useNavStore.getState().updatePosition(ORIGIN, 0);
    const shape = [ORIGIN, { lat: 0, lon: 0.002 }];
    (globalThis as unknown as { fetch: jest.Mock }).fetch = mockFetch({
      nominatim: [nominatimResult(0, 0.002)],
      valhalla: valhallaRouteFor(shape, [1, 4]),
    });
    await useNavStore.getState().navigateTo('цель');
    useNavStore.getState().startNavigation();
    useNavStore.getState().updatePosition(ORIGIN, 0);

    useNavStore.getState().checkGpsTimeout(10_001);

    expect(useNavStore.getState().gpsOk).toBe(false);
    expect(useDeviceStore.getState().emulator.getScreenState().nav.state).toBe(NavState.NO_GPS);
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
      valhalla: valhallaRouteFor(shape, [1, 4]),
    });
    await useNavStore.getState().navigateTo('далёкая цель');
    useNavStore.getState().startNavigation();

    useNavStore.getState().enableSimulation(true, 10);
    expect(useNavStore.getState().simulator).not.toBeNull();

    useNavStore.getState().simulator!.start(0);
    useNavStore.getState().tickSimulation(5000);

    expect(useNavStore.getState().currentPosition).not.toEqual(ORIGIN);
  });
});
