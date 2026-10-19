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
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface ValhallaRouterOptions {
  /** Базовый URL — вынесен в настройки (ТЗ §1.3), напр. публичный демо-сервер. */
  baseUrl?: string;
  fetchFn?: FetchFn;
  maxRetries?: number;
  /** Базовая задержка экспоненциального повтора, мс. */
  retryBaseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function profileToCosting(profile: RouteProfile): string {
  switch (profile) {
    case 'pedestrian':
      return 'pedestrian';
    case 'bicycle':
      return 'bicycle';
    case 'auto':
      return 'auto';
  }
}

export function buildValhallaRequestBody(from: LatLng, to: LatLng, profile: RouteProfile): object {
  return {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing: profileToCosting(profile),
    directions_options: { language: 'ru-RU', units: 'kilometers' },
  };
}

interface ValhallaManeuverRaw {
  type: number;
  instruction?: string;
  street_names?: string[];
  length: number; // в единицах directions_options.units — у нас всегда km
  time: number;
  begin_shape_index: number;
  end_shape_index: number;
  roundabout_exit_count?: number;
}

interface ValhallaLegRaw {
  shape: string;
  maneuvers: ValhallaManeuverRaw[];
}

interface ValhallaResponseRaw {
  trip: {
    legs: ValhallaLegRaw[];
    summary: { length: number; time: number };
  };
}

function parseManeuver(raw: ValhallaManeuverRaw): RouteManeuver {
  const maneuver: RouteManeuver = {
    type: raw.type,
    instruction: raw.instruction ?? '',
    streetNames: raw.street_names ?? [],
    distanceMeters: raw.length * 1000,
    durationSeconds: raw.time,
    beginShapeIndex: raw.begin_shape_index,
    endShapeIndex: raw.end_shape_index,
  };
  if (raw.roundabout_exit_count !== undefined) {
    maneuver.roundaboutExitCount = raw.roundabout_exit_count;
  }
  return maneuver;
}

export function parseValhallaResponse(data: ValhallaResponseRaw, profile: RouteProfile): Route {
  const leg = data.trip.legs[0];
  if (!leg) {
    throw new RouteError('Valhalla вернула маршрут без ни одного leg');
  }
  return {
    shape: decodePolyline6(leg.shape),
    maneuvers: leg.maneuvers.map(parseManeuver),
    distanceMeters: data.trip.summary.length * 1000,
    durationSeconds: data.trip.summary.time,
    profile,
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Router поверх Valhalla /route (ТЗ §1.3). Сетевые ошибки и временные отказы
 * (429/5xx) повторяются с экспоненциальной задержкой; после исчерпания
 * попыток бросает RouteError с понятным сообщением для показа на очках
 * («Нет сети»/«Ошибка маршрута» решает вызывающая сторона по NAV_STATE).
 */
export class ValhallaRouter implements Router {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn | undefined;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ValhallaRouterOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://valhalla1.openstreetmap.de';
    // См. geocode.ts: fetchFn подхватывается лениво в route(), а не тут.
    this.fetchFn = options.fetchFn;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.sleep = options.sleep ?? delay;
  }

  async route(from: LatLng, to: LatLng, profile: RouteProfile): Promise<Route> {
    const body = buildValhallaRequestBody(from, to, profile);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const fetchFn = this.fetchFn ?? (globalThis.fetch as FetchFn);
        const response = await fetchFn(`${this.baseUrl}/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          if (this.isRetryable(response.status) && attempt < this.maxRetries) {
            await this.sleep(this.retryBaseDelayMs * 2 ** attempt);
            continue;
          }
          throw new RouteError(`Valhalla ответила ${response.status}`);
        }
        const data = (await response.json()) as ValhallaResponseRaw;
        return parseValhallaResponse(data, profile);
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

  private isRetryable(status: number): boolean {
    return status === 429 || status >= 500;
  }
}
