import type { GeocodeResult } from '../nav/geocode';
import type { LlmFunction } from './llm';

/** То, что агенту нужно от навигатора — инъектируется, чтобы ядро тестировалось без zustand. */
export interface NavPort {
  /** Бросает исключение при ошибке сети. */
  search(query: string): Promise<GeocodeResult[]>;
  /** Строит маршрут до кандидата (без автостарта). */
  choose(candidate: GeocodeResult): Promise<RouteOutcome>;
  stop(): void;
  status(): NavSnapshot;
}

export type RouteOutcome =
  { ok: true; distanceMeters: number; durationSeconds: number } | { ok: false; error: string };

export interface NavSnapshot {
  status: string;
  destinationName: string | null;
  remainingDistanceMeters: number | null;
  remainingDurationSeconds: number | null;
}

export const AGENT_FUNCTIONS: LlmFunction[] = [
  {
    name: 'navigate_to',
    description:
      'Построить маршрут от текущего положения пользователя до места. ' +
      'Вызывай, когда пользователь просит отвести, проложить маршрут, дойти/доехать куда-то.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Адрес или название места на русском, как для поиска на карте',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'choose_destination',
    description:
      'Выбрать один из вариантов адреса, которые вернул navigate_to, когда их было несколько.',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'integer', description: 'Номер варианта из списка, начиная с 1' },
      },
      required: ['number'],
    },
  },
  {
    name: 'stop_navigation',
    description: 'Остановить текущую навигацию и сбросить маршрут.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_navigation_status',
    description: 'Узнать, идёт ли навигация, куда и сколько осталось.',
    parameters: { type: 'object', properties: {} },
  },
];

/** «Пятёрочка, 12, Тверская улица, Тверской район, Москва, …» → первые 3 части. */
export function shortPlaceName(displayName: string): string {
  return displayName
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
}

export function formatDurationRu(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

export function formatDistanceShortRu(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} м`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} км`;
}
