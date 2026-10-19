export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
  type: string;
  importance: number;
}

export interface SearchOptions {
  viewbox?: BoundingBox;
  limit?: number;
}

type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface NominatimClientOptions {
  /** Базовый URL — вынесен в настройки, чтобы потом подставить свой сервер (ТЗ §1.2). */
  baseUrl?: string;
  /** Осмысленный User-Agent с названием приложения и контактом — обязателен для публичного Nominatim. */
  userAgent: string;
  fetchFn?: FetchFn;
  /** Переопределяется в тестах, чтобы не ждать реальные секунды. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  cacheTtlMs?: number;
}

function buildCacheKey(query: string, options: SearchOptions): string {
  const vb = options.viewbox
    ? `${options.viewbox.minLon},${options.viewbox.minLat},${options.viewbox.maxLon},${options.viewbox.maxLat}`
    : '';
  return `${query.trim().toLowerCase()}|${vb}|${options.limit ?? ''}`;
}

/**
 * Клиент публичного Nominatim: не больше 1 запроса в секунду (глобальная
 * очередь), обязательный User-Agent, кэширование ответов, никакого
 * автодополнения по мере набора — вызывающая сторона сама решает, когда
 * вызвать search() (по кнопке «Найти» или по окончании фразы), этот класс
 * лишь не даёт двум параллельным вызовам обогнать лимит в 1 req/s.
 */
export class NominatimClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchFn: FetchFn | undefined;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly cacheTtlMs: number;

  private lastRequestAtMs: number | null = null;
  private queueTail: Promise<void> = Promise.resolve();
  private readonly cache = new Map<string, { at: number; results: GeocodeResult[] }>();

  constructor(options: NominatimClientOptions) {
    this.baseUrl = options.baseUrl ?? 'https://nominatim.openstreetmap.org';
    this.userAgent = options.userAgent;
    // fetchFn подхватывается лениво в performSearch, а не здесь: это даёт
    // подменять global.fetch после создания клиента (удобно в тестах) и
    // переживать более позднюю инициализацию полифилла fetch в приложении.
    this.fetchFn = options.fetchFn;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60 * 1000;
  }

  buildUrl(query: string, options: SearchOptions): string {
    const params = new URLSearchParams({
      format: 'jsonv2',
      'accept-language': 'ru',
      countrycodes: 'ru',
      limit: String(options.limit ?? 5),
      q: query,
    });
    if (options.viewbox) {
      const { minLon, minLat, maxLon, maxLat } = options.viewbox;
      params.set('viewbox', `${minLon},${minLat},${maxLon},${maxLat}`);
      params.set('bounded', '0');
    }
    return `${this.baseUrl}/search?${params.toString()}`;
  }

  async search(query: string, options: SearchOptions = {}): Promise<GeocodeResult[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return [];
    }

    const cacheKey = buildCacheKey(trimmed, options);
    const cached = this.cache.get(cacheKey);
    if (cached && this.now() - cached.at < this.cacheTtlMs) {
      return cached.results;
    }

    const results = await this.scheduleRequest(() => this.performSearch(trimmed, options));
    this.cache.set(cacheKey, { at: this.now(), results });
    return results;
  }

  /** Сериализует запросы через глобальную очередь и не даёт двум идти чаще, чем раз в minIntervalMs. */
  private scheduleRequest<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queueTail.then(async () => {
      if (this.lastRequestAtMs !== null) {
        const elapsed = this.now() - this.lastRequestAtMs;
        if (elapsed < this.minIntervalMs) {
          await this.sleep(this.minIntervalMs - elapsed);
        }
      }
      this.lastRequestAtMs = this.now();
    });
    const result = run.then(task);
    this.queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async performSearch(query: string, options: SearchOptions): Promise<GeocodeResult[]> {
    const url = this.buildUrl(query, options);
    const fetchFn = this.fetchFn ?? (globalThis.fetch as FetchFn);
    const response = await fetchFn(url, { headers: { 'User-Agent': this.userAgent } });
    if (!response.ok) {
      throw new Error(`Nominatim ответил ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }
    return data.map((raw) => parseNominatimEntry(raw));
  }
}

function parseNominatimEntry(raw: unknown): GeocodeResult {
  const r = raw as Record<string, unknown>;
  return {
    displayName: String(r.display_name ?? ''),
    lat: Number(r.lat),
    lon: Number(r.lon),
    type: String(r.type ?? ''),
    importance: Number(r.importance ?? 0),
  };
}
