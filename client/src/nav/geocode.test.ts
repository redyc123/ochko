import { NominatimClient } from './geocode';

function makeFetchFn(responseBody: unknown, ok = true, status = 200) {
  return jest.fn(async () => ({
    ok,
    status,
    json: async () => responseBody,
  }));
}

const SAMPLE_RESPONSE = [
  {
    display_name: 'Пятёрочка, ул. Ленина, Москва',
    lat: '55.7558',
    lon: '37.6173',
    type: 'supermarket',
    importance: 0.4,
  },
];

describe('NominatimClient.buildUrl', () => {
  it('формирует URL с обязательными параметрами публичного Nominatim', () => {
    const client = new NominatimClient({ userAgent: 'ochko-test/1.0 (test@example.com)' });
    const url = client.buildUrl('Пятёрочка', {});
    expect(url).toContain('format=jsonv2');
    expect(url).toContain('accept-language=ru');
    expect(url).toContain('countrycodes=ru');
    expect(url).toContain('limit=5');
    expect(url).toContain(encodeURIComponent('Пятёрочка'));
    expect(url).not.toContain('viewbox');
  });

  it('добавляет viewbox и bounded=0, когда задан', () => {
    const client = new NominatimClient({ userAgent: 'ua' });
    const url = client.buildUrl('аптека', {
      viewbox: { minLon: 37, minLat: 55, maxLon: 38, maxLat: 56 },
      limit: 3,
    });
    expect(url).toContain('viewbox=37%2C55%2C38%2C56');
    expect(url).toContain('bounded=0');
    expect(url).toContain('limit=3');
  });

  it('использует настраиваемый baseUrl', () => {
    const client = new NominatimClient({ userAgent: 'ua', baseUrl: 'https://geo.ochko.ru' });
    expect(client.buildUrl('x', {}).startsWith('https://geo.ochko.ru/search?')).toBe(true);
  });
});

describe('NominatimClient.search', () => {
  it('пустой запрос не ходит в сеть', async () => {
    const fetchFn = makeFetchFn([]);
    const client = new NominatimClient({ userAgent: 'ua', fetchFn });
    expect(await client.search('   ')).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('передаёт User-Agent и парсит ответ jsonv2', async () => {
    const fetchFn = makeFetchFn(SAMPLE_RESPONSE);
    const client = new NominatimClient({ userAgent: 'ochko/1.0 (contact@ochko.ru)', fetchFn });
    const results = await client.search('Пятёрочка на Ленина');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers['User-Agent']).toBe('ochko/1.0 (contact@ochko.ru)');

    expect(results).toEqual([
      {
        displayName: 'Пятёрочка, ул. Ленина, Москва',
        lat: 55.7558,
        lon: 37.6173,
        type: 'supermarket',
        importance: 0.4,
      },
    ]);
  });

  it('бросает ошибку при неуспешном ответе', async () => {
    const fetchFn = makeFetchFn(null, false, 429);
    const client = new NominatimClient({ userAgent: 'ua', fetchFn });
    await expect(client.search('x')).rejects.toThrow('429');
  });

  it('кэширует ответ — повторный одинаковый запрос не ходит в сеть', async () => {
    const fetchFn = makeFetchFn(SAMPLE_RESPONSE);
    const client = new NominatimClient({ userAgent: 'ua', fetchFn });
    await client.search('аптека');
    await client.search('Аптека'); // регистр не важен
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('разные запросы кэшируются отдельно', async () => {
    const fetchFn = makeFetchFn(SAMPLE_RESPONSE);
    let time = 100000;
    const client = new NominatimClient({
      userAgent: 'ua',
      fetchFn,
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    });
    await client.search('аптека');
    await client.search('банкомат');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('NominatimClient: лимит 1 запрос в секунду', () => {
  it('ждёт перед вторым запросом, если прошло меньше minIntervalMs', async () => {
    const fetchFn = makeFetchFn(SAMPLE_RESPONSE);
    let time = 0;
    const sleep = jest.fn(async (ms: number) => {
      time += ms;
    });
    const client = new NominatimClient({ userAgent: 'ua', fetchFn, now: () => time, sleep });

    await Promise.all([client.search('первый'), client.search('второй')]);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('не ждёт, если между запросами прошло достаточно времени', async () => {
    const fetchFn = makeFetchFn(SAMPLE_RESPONSE);
    let time = 0;
    const sleep = jest.fn(async (ms: number) => {
      time += ms;
    });
    const client = new NominatimClient({ userAgent: 'ua', fetchFn, now: () => time, sleep });

    await client.search('первый');
    time += 2000;
    await client.search('второй');

    expect(sleep).not.toHaveBeenCalled();
  });
});
