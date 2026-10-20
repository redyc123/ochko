import { buildCumulativeDistances, snapToShape } from './geo';
import type { LatLng, Route } from './types';

export interface TrackingResult {
  snappedPoint: LatLng;
  offRouteMeters: number;
  distanceAlongRouteMeters: number;
  remainingDistanceMeters: number;
  /** Индекс манёвра, в пределах которого сейчас находится пользователь. */
  currentManeuverIndex: number;
  /** Манёвр, который показываем на очках — следующий поворот (или текущий, если это последний пункт — прибытие). */
  upcomingManeuverIndex: number;
  distanceToUpcomingManeuverMeters: number;
}

/**
 * Привязывает текущую позицию к маршруту и определяет, какой манёвр показывать.
 * route.maneuvers[i] описывает отрезок ПОСЛЕ манёвра i (инструкция относится к
 * началу отрезка), поэтому «следующий поворот» для пользователя — это
 * maneuvers[currentSegment + 1], а street в пакете NAV_MANEUVER — это улица
 * ПОСЛЕ манёвра, т.е. streetNames манёвра currentSegment + 1 (ТЗ §4.4).
 */
export function trackPosition(route: Route, position: LatLng): TrackingResult {
  const cumulative = buildCumulativeDistances(route.shape);
  const snap = snapToShape(position, route.shape, cumulative);

  // beginShapeIndex/endShapeIndex соседних манёвров делят одну и ту же
  // граничную точку (endShapeIndex_i === beginShapeIndex_{i+1}) — так строит
  // их Router (см. parseOsrmResponse в src/nav/router.ts), поэтому ищем
  // с конца: последний манёвр, чей begin ещё не позже найденного сегмента.
  // Это естественно схлопывает и вырожденные (нулевой длины) манёвры прибытия.
  let currentManeuverIndex = 0;
  for (let i = route.maneuvers.length - 1; i >= 0; i -= 1) {
    const m = route.maneuvers[i] as Route['maneuvers'][number];
    if (snap.segmentIndex >= m.beginShapeIndex) {
      currentManeuverIndex = i;
      break;
    }
  }

  const isLast = currentManeuverIndex >= route.maneuvers.length - 1;
  const upcomingManeuverIndex = isLast ? currentManeuverIndex : currentManeuverIndex + 1;
  const upcoming = route.maneuvers[upcomingManeuverIndex] as Route['maneuvers'][number];
  const upcomingBeginDistance = cumulative[upcoming.beginShapeIndex] ?? route.distanceMeters;

  const distanceToUpcomingManeuverMeters = isLast
    ? Math.max(0, route.distanceMeters - snap.distanceAlongRouteMeters)
    : Math.max(0, upcomingBeginDistance - snap.distanceAlongRouteMeters);

  return {
    snappedPoint: snap.point,
    offRouteMeters: snap.offRouteMeters,
    distanceAlongRouteMeters: snap.distanceAlongRouteMeters,
    remainingDistanceMeters: Math.max(0, route.distanceMeters - snap.distanceAlongRouteMeters),
    currentManeuverIndex,
    upcomingManeuverIndex,
    distanceToUpcomingManeuverMeters,
  };
}

/**
 * Человеко-понятное округление расстояния (ТЗ §1.5): < 100 м — шаг 5 м,
 * < 1 км — шаг 10 м, дальше — шаг 100 м (это даёт ровно одну значащую цифру
 * после запятой при показе в км, например 1200 м → «1,2 км»).
 */
export function roundDistanceMeters(meters: number): number {
  if (meters < 0) return 0;
  if (meters < 100) return Math.round(meters / 5) * 5;
  if (meters < 1000) return Math.round(meters / 10) * 10;
  return Math.round(meters / 100) * 100;
}

/** Текстовое отображение расстояния для интерфейса приложения (не для байтов очков). */
export function formatDistanceRu(meters: number): string {
  const rounded = roundDistanceMeters(meters);
  if (rounded < 1000) {
    return `${rounded} м`;
  }
  const km = rounded / 1000;
  return `${km.toLocaleString('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: km % 1 === 0 ? 0 : 1 })} км`;
}

export interface ProgressSample {
  distanceM: number;
  atMs: number;
}

/**
 * Решает, нужно ли отправлять NAV_PROGRESS прямо сейчас (ТЗ §1.5): расстояние
 * изменилось на ≥5 м (или ≥10% при расстоянии > 500 м), но не чаще 1 раза в
 * секунду; при неизменном расстоянии — не слать.
 */
export function shouldSendProgress(prev: ProgressSample | null, current: ProgressSample): boolean {
  if (prev === null) return true;
  if (current.atMs - prev.atMs < 1000) return false;
  const delta = Math.abs(current.distanceM - prev.distanceM);
  if (delta === 0) return false;
  const threshold = prev.distanceM > 500 ? Math.max(5, prev.distanceM * 0.1) : 5;
  return delta >= threshold;
}

export function isArrived(remainingDistanceMeters: number, thresholdMeters = 15): boolean {
  return remainingDistanceMeters <= thresholdMeters;
}

export function hasGpsTimedOut(lastFixAtMs: number, nowMs: number, timeoutMs = 10_000): boolean {
  return nowMs - lastFixAtMs > timeoutMs;
}

export interface RerouteDetectorOptions {
  offRouteThresholdMeters?: number;
  offRouteDurationMs?: number;
  minRerouteIntervalMs?: number;
}

/**
 * Состояние схода с маршрута (ТЗ §1.4): отклонение > 30 м дольше 10 с →
 * перестроение, не чаще одного раза в 15 с. Время передаётся явно, чтобы
 * логика была детерминированной и тестируемой без реальных таймеров.
 */
export class RerouteDetector {
  private readonly offRouteThresholdMeters: number;
  private readonly offRouteDurationMs: number;
  private readonly minRerouteIntervalMs: number;

  private offRouteSinceMs: number | null = null;
  private lastRerouteAtMs: number | null = null;

  constructor(options: RerouteDetectorOptions = {}) {
    this.offRouteThresholdMeters = options.offRouteThresholdMeters ?? 30;
    this.offRouteDurationMs = options.offRouteDurationMs ?? 10_000;
    this.minRerouteIntervalMs = options.minRerouteIntervalMs ?? 15_000;
  }

  /** Вызывать на каждый GPS-фикс. Возвращает true, когда нужно перестроить маршрут. */
  update(offRouteMeters: number, nowMs: number): boolean {
    if (offRouteMeters <= this.offRouteThresholdMeters) {
      this.offRouteSinceMs = null;
      return false;
    }
    if (this.offRouteSinceMs === null) {
      this.offRouteSinceMs = nowMs;
    }
    const offRouteFor = nowMs - this.offRouteSinceMs;
    if (offRouteFor < this.offRouteDurationMs) {
      return false;
    }
    if (this.lastRerouteAtMs !== null && nowMs - this.lastRerouteAtMs < this.minRerouteIntervalMs) {
      return false;
    }
    this.lastRerouteAtMs = nowMs;
    this.offRouteSinceMs = null;
    return true;
  }

  reset(): void {
    this.offRouteSinceMs = null;
  }
}
