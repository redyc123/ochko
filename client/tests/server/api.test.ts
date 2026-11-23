import { agentTurn, buildRoute, geocode, reverseGeocode, ServerError } from '@/server/api';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const BASE = 'http://example.test';

describe('server/api — прокси клиента к серверу', () => {
  beforeEach(() => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });

  it('geocode шлёт POST /geocode и возвращает результаты', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () =>
      jsonResponse({
        results: [
          {
            displayName: 'Тверская, 1, Москва',
            lat: 55.75,
            lon: 37.6,
            type: 'road',
            importance: 0.6,
          },
        ],
      }),
    );

    const results = await geocode(BASE, {
      query: 'Тверская 1',
      position: { lat: 55, lon: 37 },
      limit: 5,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.displayName).toContain('Тверская');

    const [url, init] = (globalThis as unknown as { fetch: jest.Mock }).fetch.mock.calls[0]!;
    expect(url).toBe(`${BASE}/geocode`);
    expect(init?.method).toBe('POST');
  });

  it('geocode бросает ServerError при ошибке сервера (502)', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () =>
      jsonResponse({ error: 'внешний сервис недоступен' }, 502),
    );
    await expect(geocode(BASE, { query: 'x' })).rejects.toThrow(ServerError);
  });

  it('reverseGeocode шлёт нажатые координаты и возвращает адрес', async () => {
    const result = {
      displayName: 'Республики, 1, Тюмень',
      lat: 57.1531,
      lon: 65.5341,
      type: 'house',
      importance: 0.5,
    };
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () =>
      jsonResponse({ result }),
    );

    await expect(reverseGeocode(BASE, { lat: 57.153, lon: 65.534 })).resolves.toEqual(result);
    const [url, init] = (globalThis as unknown as { fetch: jest.Mock }).fetch.mock.calls[0]!;
    expect(url).toBe(`${BASE}/reverse-geocode`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ lat: 57.153, lon: 65.534 });
  });

  it('reverseGeocode принимает отсутствие адреса и сообщает об ошибке API', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () =>
      jsonResponse({ result: null }),
    );
    await expect(reverseGeocode(BASE, { lat: 0, lon: 0 })).resolves.toBeNull();

    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () =>
      jsonResponse({ error: 'Nominatim недоступен' }, 502),
    );
    await expect(reverseGeocode(BASE, { lat: 0, lon: 0 })).rejects.toMatchObject({
      name: 'ServerError',
      status: 502,
    });
  });

  it('buildRoute шлёт POST /route и возвращает маршрут', async () => {
    const route = {
      shape: [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
      ],
      maneuvers: [],
      distanceMeters: 100,
      durationSeconds: 60,
      profile: 'pedestrian',
    };
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () =>
      jsonResponse({ route }),
    );

    const result = await buildRoute(BASE, {
      from: { lat: 0, lon: 0 },
      to: { lat: 0, lon: 1 },
      profile: 'pedestrian',
    });
    expect(result.shape).toHaveLength(2);
    const [url, init] = (globalThis as unknown as { fetch: jest.Mock }).fetch.mock.calls[0]!;
    expect(url).toBe(`${BASE}/route`);
    expect(init?.body).toContain('"profile":"pedestrian"');
  });

  it('agentTurn выполняет сессионный диалог и возвращает session_id + reply с actions', async () => {
    const reply = {
      display: 'Маршрут построен',
      full: 'Маршрут построен: 1,2 км.',
      candidates: [],
      actions: [
        {
          type: 'start_route',
          destination: { lat: 55.75, lon: 37.6 },
          route: {
            shape: [],
            maneuvers: [],
            distanceMeters: 1200,
            durationSeconds: 900,
            profile: 'pedestrian',
          },
        },
      ],
    };
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () =>
      jsonResponse({ session_id: 'abc123', reply }),
    );

    const result = await agentTurn(BASE, {
      session_id: null,
      user_text: 'Отведи на Тверскую',
      context: { position: { lat: 55, lon: 37 }, nav_status: { status: 'idle', gpsOk: true } },
    });
    expect(result.session_id).toBe('abc123');
    expect(result.reply.actions[0]).toMatchObject({ type: 'start_route' });
  });

  it('agentTurn передаёт session_id для продолжения диалога', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () =>
      jsonResponse({
        session_id: 'abc123',
        reply: { display: '', full: '', candidates: [], actions: [] },
      }),
    );

    // Первый вызов — нет session_id.
    await agentTurn(BASE, {
      session_id: null,
      user_text: 'привет',
      context: { position: null, nav_status: { status: 'idle', gpsOk: true } },
    });
    const [url1, init1] = (globalThis as unknown as { fetch: jest.Mock }).fetch.mock.calls[0]!;
    expect(url1).toBe(`${BASE}/agent`);
    expect(init1?.body).toContain('"session_id":null');

    // Второй — с session_id от первого.
    await agentTurn(BASE, {
      session_id: 'abc123',
      user_text: 'дальше',
      context: { position: null, nav_status: { status: 'idle', gpsOk: true } },
    });
    const init2 = (globalThis as unknown as { fetch: jest.Mock }).fetch.mock.calls[1]![1];
    expect(init2?.body).toContain('"session_id":"abc123"');
  });

  it('agentTurn бросает ServerError при 503 (LLM не инициализирован)', async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () =>
      jsonResponse({ error: 'LLM не инициализирован' }, 503),
    );
    await expect(
      agentTurn(BASE, {
        session_id: null,
        user_text: 'x',
        context: { position: null, nav_status: { status: 'idle', gpsOk: true } },
      }),
    ).rejects.toThrow(ServerError);
  });
});
