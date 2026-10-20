import { encodePolyline6 } from '@/nav/polyline';
import { OsrmRouter, RouteError, buildOsrmUrl, parseOsrmResponse } from '@/nav/router';
import { ManeuverIcon } from '@/nav/maneuverMap';

describe('buildOsrmUrl', () => {
  it('формирует URL ровно по формату OSRM /route/v1 — координаты lon,lat (не lat,lon!)', () => {
    const url = buildOsrmUrl(
      'https://routing.openstreetmap.de',
      { lat: 55.75, lon: 37.6 },
      { lat: 55.76, lon: 37.62 },
      'pedestrian',
    );
    expect(url).toBe(
      'https://routing.openstreetmap.de/routed-foot/route/v1/foot/37.6,55.75;37.62,55.76?steps=true&geometries=polyline6&overview=false',
    );
  });

  it('профиль велосипед/авто транслируется в bike/car (и в префикс, и в сегмент пути)', () => {
    const bike = buildOsrmUrl('https://x', { lat: 0, lon: 0 }, { lat: 1, lon: 1 }, 'bicycle');
    expect(bike).toContain('/routed-bike/route/v1/bike/');
    const car = buildOsrmUrl('https://x', { lat: 0, lon: 0 }, { lat: 1, lon: 1 }, 'auto');
    expect(car).toContain('/routed-car/route/v1/car/');
  });

  it('запрашивает polyline6 (не дефолтный polyline5) — иначе decodePolyline6 даст мусор', () => {
    const url = buildOsrmUrl('https://x', { lat: 0, lon: 0 }, { lat: 1, lon: 1 }, 'pedestrian');
    expect(url).toContain('geometries=polyline6');
    expect(url).toContain('steps=true');
  });
});

describe('parseOsrmResponse', () => {
  const shapePoints = [
    { lat: 55.751244, lon: 37.618423 },
    { lat: 55.752, lon: 37.619 },
    { lat: 55.753, lon: 37.62 },
  ];

  const raw = {
    code: 'Ok',
    routes: [
      {
        distance: 150,
        duration: 90,
        legs: [
          {
            steps: [
              {
                distance: 100,
                duration: 60,
                name: 'ул. Ленина',
                geometry: encodePolyline6(shapePoints.slice(0, 2)),
                maneuver: { type: 'depart' },
              },
              {
                distance: 50,
                duration: 30,
                name: '',
                geometry: encodePolyline6(shapePoints.slice(1, 3)),
                maneuver: { type: 'roundabout', exit: 2 },
              },
            ],
          },
        ],
      },
    ],
  };

  it('расстояние/время уже в метрах/секундах — без конвертации, и shape склеен с де-дупом стыка', () => {
    const route = parseOsrmResponse(raw, 'pedestrian');
    expect(route.distanceMeters).toBe(150);
    expect(route.durationSeconds).toBe(90);
    expect(route.profile).toBe('pedestrian');
    expect(route.shape.length).toBe(3); // 2 + 2 точки минус 1 общая на стыке
    expect(route.shape[0]?.lat).toBeCloseTo(shapePoints[0]!.lat, 5);
    expect(route.shape[2]?.lat).toBeCloseTo(shapePoints[2]!.lat, 5);
  });

  it('переводит название улицы, манёвр в иконку, номер съезда — только у кольца', () => {
    const route = parseOsrmResponse(raw, 'pedestrian');
    expect(route.maneuvers[0]).toMatchObject({
      type: ManeuverIcon.START,
      streetNames: ['ул. Ленина'],
      distanceMeters: 100,
      beginShapeIndex: 0,
      endShapeIndex: 1,
    });
    expect(route.maneuvers[1]).toMatchObject({
      type: ManeuverIcon.ROUNDABOUT,
      streetNames: [],
      distanceMeters: 50,
      roundaboutExitCount: 2,
      beginShapeIndex: 1,
      endShapeIndex: 2,
    });
  });

  it('бросает RouteError, если code !== "Ok"', () => {
    expect(() =>
      parseOsrmResponse({ code: 'NoRoute', message: 'маршрут не найден' }, 'pedestrian'),
    ).toThrow(RouteError);
    expect(() =>
      parseOsrmResponse({ code: 'NoRoute', message: 'маршрут не найден' }, 'pedestrian'),
    ).toThrow('маршрут не найден');
  });

  it('бросает RouteError, если нет ни одного leg (защитная проверка)', () => {
    expect(() =>
      parseOsrmResponse(
        { code: 'Ok', routes: [{ distance: 0, duration: 0, legs: [] }] },
        'pedestrian',
      ),
    ).toThrow(RouteError);
  });
});

describe('OsrmRouter.route', () => {
  const okBody = {
    code: 'Ok',
    routes: [
      {
        distance: 100,
        duration: 60,
        legs: [
          {
            steps: [
              {
                distance: 100,
                duration: 60,
                name: '',
                geometry: encodePolyline6([
                  { lat: 0, lon: 0 },
                  { lat: 0, lon: 0.001 },
                ]),
                maneuver: { type: 'depart' },
              },
            ],
          },
        ],
      },
    ],
  };

  it('успешный запрос возвращает Route', async () => {
    const fetchFn = jest.fn(async () => ({ ok: true, status: 200, json: async () => okBody }));
    const router = new OsrmRouter({ fetchFn, sleep: async () => {}, minIntervalMs: 0 });
    const route = await router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian');
    expect(route.distanceMeters).toBe(100);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('повторяет запрос при 429 и успевает получить результат', async () => {
    let calls = 0;
    const fetchFn = jest.fn(async () => {
      calls += 1;
      if (calls < 3) return { ok: false, status: 429, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => okBody };
    });
    const sleep = jest.fn(async () => {});
    const router = new OsrmRouter({ fetchFn, sleep, maxRetries: 3, minIntervalMs: 0 });
    const route = await router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian');
    expect(route.distanceMeters).toBe(100);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('не повторяет запрос при постоянной ошибке 400 (бросает сразу)', async () => {
    const fetchFn = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({}) }));
    const sleep = jest.fn(async () => {});
    const router = new OsrmRouter({ fetchFn, sleep, maxRetries: 3, minIntervalMs: 0 });
    await expect(
      router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian'),
    ).rejects.toThrow(RouteError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('OSRM-уровневая ошибка (code !== "Ok" при HTTP 200) бросает сразу, без повторов', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 'InvalidOptions', message: 'плохой запрос' }),
    }));
    const sleep = jest.fn(async () => {});
    const router = new OsrmRouter({ fetchFn, sleep, maxRetries: 3, minIntervalMs: 0 });
    await expect(
      router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian'),
    ).rejects.toThrow('плохой запрос');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('после исчерпания попыток при 500 бросает RouteError', async () => {
    const fetchFn = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const sleep = jest.fn(async () => {});
    const router = new OsrmRouter({ fetchFn, sleep, maxRetries: 2, minIntervalMs: 0 });
    await expect(
      router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian'),
    ).rejects.toThrow(RouteError);
    expect(fetchFn).toHaveBeenCalledTimes(3); // 1 + 2 повтора
  });

  it('сетевая ошибка (fetch бросает) тоже повторяется и в итоге даёт RouteError', async () => {
    const fetchFn = jest.fn(async () => {
      throw new Error('network down');
    });
    const sleep = jest.fn(async () => {});
    const router = new OsrmRouter({ fetchFn, sleep, maxRetries: 1, minIntervalMs: 0 });
    await expect(
      router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian'),
    ).rejects.toThrow(RouteError);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('задержка между повторами растёт экспоненциально', async () => {
    const fetchFn = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const sleep = jest.fn(async () => {});
    const router = new OsrmRouter({
      fetchFn,
      sleep,
      maxRetries: 2,
      retryBaseDelayMs: 500,
      minIntervalMs: 0,
    });
    await expect(
      router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian'),
    ).rejects.toThrow();
    expect(sleep).toHaveBeenNthCalledWith(1, 500);
    expect(sleep).toHaveBeenNthCalledWith(2, 1000);
  });
});

describe('OsrmRouter: лимит 1 запрос в секунду', () => {
  it('ждёт перед вторым запросом, если прошло меньше minIntervalMs', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1, duration: 1, legs: [{ steps: [] }] }],
      }),
    }));
    let time = 0;
    const sleep = jest.fn(async (ms: number) => {
      time += ms;
    });
    const router = new OsrmRouter({ fetchFn, sleep, now: () => time });

    await router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian').catch(() => {});
    await router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian').catch(() => {});

    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('не ждёт, если между запросами прошло достаточно времени', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1, duration: 1, legs: [{ steps: [] }] }],
      }),
    }));
    let time = 0;
    const sleep = jest.fn(async (ms: number) => {
      time += ms;
    });
    const router = new OsrmRouter({ fetchFn, sleep, now: () => time });

    await router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian').catch(() => {});
    time += 2000;
    await router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian').catch(() => {});

    expect(sleep).not.toHaveBeenCalled();
  });
});
