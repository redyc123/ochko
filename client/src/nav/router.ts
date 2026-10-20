import { mapOsrmManeuverToIcon, usesExitNumber } from './maneuverMap';
import { decodePolyline6 } from './polyline';
import type { LatLng, Route, RouteManeuver, RouteProfile } from './types';

export interface Router {
  route(from: LatLng, to: LatLng, profile: RouteProfile): Promise<Route>;
}

export class RouteError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface OsrmRouterOptions {
  /** Базовый URL — вынесен в настройки (ТЗ §1.3). Публичный FOSSGIS-инстанс по умолчанию. */
  baseUrl?: string;
  /** Осмысленный User-Agent — требуется правилами публичного routing.openstreetmap.de. */
  userAgent?: string;
  fetchFn?: FetchFn;
  maxRetries?: number;
  /** Базовая задержка экспоненциального повтора, мс. */
  retryBaseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Пауза между запросами, мс — политика сервиса требует не больше 1 req/s. */
  minIntervalMs?: number;
  now?: () => number;
}

type OsrmProfile = 'foot' | 'bike' | 'car';

function profileToOsrm(profile: RouteProfile): OsrmProfile {
  switch (profile) {
    case 'pedestrian':
      return 'foot';
    case 'bicycle':
      return 'bike';
    case 'auto':
      return 'car';
  }
}

/**
 * URL для OSRM /route/v1 (routing.openstreetmap.de хостит car/bike/foot как
 * отдельные `/routed-{profile}/` сервисы). Координаты в пути — ВНИМАНИЕ,
 * порядок `lon,lat`, не `lat,lon` (классическая ловушка OSRM).
 */
export function buildOsrmUrl(
  baseUrl: string,
  from: LatLng,
  to: LatLng,
  profile: RouteProfile,
): string {
  const osrmProfile = profileToOsrm(profile);
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const params = new URLSearchParams({ steps: 'true', geometries: 'polyline6', overview: 'false' });
  return `${baseUrl}/routed-${osrmProfile}/route/v1/${osrmProfile}/${coords}?${params.toString()}`;
}

interface OsrmManeuverRaw {
  type: string;
  modifier?: string;
  exit?: number;
}

interface OsrmStepRaw {
  distance: number;
  duration: number;
  name: string;
  geometry: string;
  maneuver: OsrmManeuverRaw;
}

interface OsrmLegRaw {
  steps: OsrmStepRaw[];
}

interface OsrmRouteRaw {
  distance: number;
  duration: number;
  legs: OsrmLegRaw[];
}

interface OsrmResponseRaw {
  code: string;
  message?: string;
  routes?: OsrmRouteRaw[];
}

/**
 * Склеивает shape маршрута из geometry отдельных шагов (а не из общего
 * `route.geometry`) — так begin/endShapeIndex каждого манёвра вычисляются по
 * построению, без согласования с чужой индексацией. Общая точка на стыке
 * двух шагов (конец предыдущего == начало следующего — так всегда у OSRM)
 * де-дуплицируется, чтобы endShapeIndex_i === beginShapeIndex_{i+1}, как и
 * ожидает tracking.ts.
 */
export function parseOsrmResponse(data: OsrmResponseRaw, profile: RouteProfile): Route {
  if (data.code !== 'Ok') {
    throw new RouteError(data.message ?? data.code);
  }
  const route = data.routes?.[0];
  const leg = route?.legs[0];
  if (!route || !leg) {
    throw new RouteError('OSRM вернул маршрут без ни одного leg');
  }

  const shape: LatLng[] = [];
  const maneuvers: RouteManeuver[] = [];

  for (const step of leg.steps) {
    const points = decodePolyline6(step.geometry);
    const beginShapeIndex = shape.length === 0 ? 0 : shape.length - 1;
    const pointsToAppend = shape.length === 0 ? points : points.slice(1);
    shape.push(...pointsToAppend);
    const endShapeIndex = shape.length === 0 ? 0 : shape.length - 1;

    const maneuver: RouteManeuver = {
      type: mapOsrmManeuverToIcon(step.maneuver.type, step.maneuver.modifier),
      streetNames: step.name ? [step.name] : [],
      distanceMeters: step.distance,
      durationSeconds: step.duration,
      beginShapeIndex,
      endShapeIndex,
    };
    if (usesExitNumber(step.maneuver.type) && step.maneuver.exit !== undefined) {
      maneuver.roundaboutExitCount = step.maneuver.exit;
    }
    maneuvers.push(maneuver);
  }

  return {
    shape,
    maneuvers,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    profile,
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Router поверх OSRM /route (routing.openstreetmap.de, публичный FOSSGIS-
 * инстанс — см. docs/LIMITATIONS.md). Каждый fetch-запрос (включая повторы)
 * разнесён минимум на minIntervalMs — политика сервиса требует не больше
 * 1 запроса в секунду, и это должно соблюдаться даже во время ретраев, а не
 * только между вызовами route(). Сетевые ошибки и временные отказы (429/5xx)
 * повторяются с экспоненциальной задержкой; после исчерпания попыток бросает
 * RouteError с понятным сообщением («Нет сети»/«Ошибка маршрута» решает
 * вызывающая сторона по NAV_STATE).
 */
export class OsrmRouter implements Router {
  private readonly baseUrl: string;
  private readonly userAgent: string | undefined;
  private readonly fetchFn: FetchFn | undefined;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly now: () => number;

  private lastRequestAtMs: number | null = null;

  constructor(options: OsrmRouterOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://routing.openstreetmap.de';
    this.userAgent = options.userAgent;
    // См. geocode.ts: fetchFn подхватывается лениво в route(), а не тут.
    this.fetchFn = options.fetchFn;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.sleep = options.sleep ?? delay;
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.now = options.now ?? Date.now;
  }

  async route(from: LatLng, to: LatLng, profile: RouteProfile): Promise<Route> {
    const url = buildOsrmUrl(this.baseUrl, from, to, profile);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        await this.pace();
        const fetchFn = this.fetchFn ?? (globalThis.fetch as FetchFn);
        const response = await fetchFn(
          url,
          this.userAgent ? { headers: { 'User-Agent': this.userAgent } } : undefined,
        );
        if (!response.ok) {
          if (this.isRetryable(response.status) && attempt < this.maxRetries) {
            await this.sleep(this.retryBaseDelayMs * 2 ** attempt);
            continue;
          }
          throw new RouteError(`OSRM ответил ${response.status}`);
        }
        const data = (await response.json()) as OsrmResponseRaw;
        return parseOsrmResponse(data, profile);
      } catch (err) {
        lastError = err;
        if (err instanceof RouteError) {
          throw err;
        }
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryBaseDelayMs * 2 ** attempt);
          continue;
        }
      }
    }
    throw new RouteError('Не удалось построить маршрут: нет сети', lastError);
  }

  /** Не даёт двум запросам (включая повторы) идти чаще, чем раз в minIntervalMs. */
  private async pace(): Promise<void> {
    if (this.lastRequestAtMs !== null) {
      const elapsed = this.now() - this.lastRequestAtMs;
      if (elapsed < this.minIntervalMs) {
        await this.sleep(this.minIntervalMs - elapsed);
      }
    }
    this.lastRequestAtMs = this.now();
  }

  private isRetryable(status: number): boolean {
    return status === 429 || status >= 500;
  }
}
