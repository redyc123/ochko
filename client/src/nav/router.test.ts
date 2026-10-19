import { encodePolyline6 } from './polyline';
import {
  RouteError,
  ValhallaRouter,
  buildValhallaRequestBody,
  parseValhallaResponse,
} from './router';

describe('buildValhallaRequestBody', () => {
  it('формирует тело запроса ровно по ТЗ §1.3', () => {
    const body = buildValhallaRequestBody(
      { lat: 55.75, lon: 37.6 },
      { lat: 55.76, lon: 37.62 },
      'pedestrian',
    );
    expect(body).toEqual({
      locations: [
        { lat: 55.75, lon: 37.6 },
        { lat: 55.76, lon: 37.62 },
      ],
      costing: 'pedestrian',
      directions_options: { language: 'ru-RU', units: 'kilometers' },
    });
  });

  it('профиль велосипед/авто транслируется в costing Valhalla', () => {
    expect(
      (
        buildValhallaRequestBody({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, 'bicycle') as {
          costing: string;
        }
      ).costing,
    ).toBe('bicycle');
    expect(
      (
        buildValhallaRequestBody({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, 'auto') as {
          costing: string;
        }
      ).costing,
    ).toBe('auto');
  });
});

describe('parseValhallaResponse', () => {
  const shapePoints = [
    { lat: 55.751244, lon: 37.618423 },
    { lat: 55.752, lon: 37.619 },
    { lat: 55.753, lon: 37.62 },
  ];

  const raw = {
    trip: {
      legs: [
        {
          shape: encodePolyline6(shapePoints),
          maneuvers: [
            {
              type: 1,
              instruction: 'Идите на восток',
              street_names: ['ул. Ленина'],
              length: 0.1,
              time: 60,
              begin_shape_index: 0,
              end_shape_index: 1,
            },
            {
              type: 26,
              instruction: 'Въезжайте на кольцо',
              street_names: [],
              length: 0.05,
              time: 30,
              begin_shape_index: 1,
              end_shape_index: 2,
              roundabout_exit_count: 2,
            },
          ],
        },
      ],
      summary: { length: 0.15, time: 90 },
    },
  };

  it('переводит км в метры и декодирует shape', () => {
    const route = parseValhallaResponse(raw, 'pedestrian');
    expect(route.distanceMeters).toBeCloseTo(150, 0);
    expect(route.durationSeconds).toBe(90);
    expect(route.profile).toBe('pedestrian');
    expect(route.shape.length).toBe(3);
    expect(route.shape[0]?.lat).toBeCloseTo(shapePoints[0]!.lat, 5);
  });

  it('переносит название улицы, номер съезда и переводит длину манёвра в метры', () => {
    const route = parseValhallaResponse(raw, 'pedestrian');
    expect(route.maneuvers[0]).toMatchObject({
      type: 1,
      streetNames: ['ул. Ленина'],
      distanceMeters: 100,
    });
    expect(route.maneuvers[1]).toMatchObject({
      type: 26,
      roundaboutExitCount: 2,
      distanceMeters: 50,
    });
  });

  it('бросает RouteError, если нет ни одного leg', () => {
    expect(() =>
      parseValhallaResponse({ trip: { legs: [], summary: { length: 0, time: 0 } } }, 'pedestrian'),
    ).toThrow(RouteError);
  });
});

describe('ValhallaRouter.route', () => {
  const okBody = {
    trip: {
      legs: [
        {
          shape: encodePolyline6([
            { lat: 0, lon: 0 },
            { lat: 0, lon: 0.001 },
          ]),
          maneuvers: [],
        },
      ],
      summary: { length: 0.1, time: 60 },
    },
  };

  it('успешный запрос возвращает Route', async () => {
    const fetchFn = jest.fn(async () => ({ ok: true, status: 200, json: async () => okBody }));
    const router = new ValhallaRouter({ fetchFn, sleep: async () => {} });
    const route = await router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian');
    expect(route.distanceMeters).toBeCloseTo(100, 0);
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
    const router = new ValhallaRouter({ fetchFn, sleep, maxRetries: 3 });
    const route = await router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian');
    expect(route.distanceMeters).toBeCloseTo(100, 0);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('не повторяет запрос при постоянной ошибке 400 (бросает сразу)', async () => {
    const fetchFn = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({}) }));
    const sleep = jest.fn(async () => {});
    const router = new ValhallaRouter({ fetchFn, sleep, maxRetries: 3 });
    await expect(
      router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian'),
    ).rejects.toThrow(RouteError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('после исчерпания попыток при 500 бросает RouteError', async () => {
    const fetchFn = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const sleep = jest.fn(async () => {});
    const router = new ValhallaRouter({ fetchFn, sleep, maxRetries: 2 });
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
    const router = new ValhallaRouter({ fetchFn, sleep, maxRetries: 1 });
    await expect(
      router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian'),
    ).rejects.toThrow(RouteError);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('задержка между повторами растёт экспоненциально', async () => {
    const fetchFn = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const sleep = jest.fn(async () => {});
    const router = new ValhallaRouter({ fetchFn, sleep, maxRetries: 2, retryBaseDelayMs: 500 });
    await expect(
      router.route({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, 'pedestrian'),
    ).rejects.toThrow();
    expect(sleep).toHaveBeenNthCalledWith(1, 500);
    expect(sleep).toHaveBeenNthCalledWith(2, 1000);
  });
});
