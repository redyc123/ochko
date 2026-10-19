import { bearingDegrees, buildCumulativeDistances, pointAtDistance } from './geo';
import type { LatLng, Route } from './types';

/** Предустановленные множители ускорения для симуляции поездки (ТЗ §1.7). */
export const SIMULATION_SPEED_MULTIPLIERS = [1, 2, 5, 10] as const;

export const DEFAULT_SIMULATION_SPEED_KMH = 5;

export interface SimulatedFix {
  position: LatLng;
  bearingDegrees: number;
  distanceAlongRouteMeters: number;
  speedMps: number;
  atMs: number;
  finished: boolean;
}

export interface RouteSimulatorOptions {
  baseSpeedKmh?: number;
  speedMultiplier?: number;
}

/**
 * Симулятор GPS вдоль маршрута (ТЗ §1.7): подменяет источник координат, вся
 * остальная логика ведения (tracking.ts) работает с его позициями как с
 * настоящими. tick() — pull-модель: вызывающая сторона (экран навигации) сама
 * решает, как часто опрашивать (таймер/requestAnimationFrame), здесь нет
 * побочных эффектов и реальных таймеров — только явно переданное время.
 */
export class RouteSimulator {
  private readonly cumulative: number[];
  private readonly totalDistanceMeters: number;
  private baseSpeedKmh: number;
  private speedMultiplier: number;

  private running = false;
  private lastTickAtMs: number | null = null;
  private distanceAlongRouteMeters = 0;

  constructor(
    private readonly route: Route,
    options: RouteSimulatorOptions = {},
  ) {
    this.cumulative = buildCumulativeDistances(route.shape);
    this.totalDistanceMeters = this.cumulative[this.cumulative.length - 1] ?? 0;
    this.baseSpeedKmh = options.baseSpeedKmh ?? DEFAULT_SIMULATION_SPEED_KMH;
    this.speedMultiplier = options.speedMultiplier ?? 1;
  }

  get isFinished(): boolean {
    return this.distanceAlongRouteMeters >= this.totalDistanceMeters;
  }

  get speedMps(): number {
    return ((this.baseSpeedKmh * 1000) / 3600) * this.speedMultiplier;
  }

  setSpeedMultiplier(multiplier: number): void {
    if (multiplier <= 0) {
      throw new RangeError('setSpeedMultiplier: множитель должен быть положительным');
    }
    this.speedMultiplier = multiplier;
  }

  start(nowMs: number): void {
    this.running = true;
    this.lastTickAtMs = nowMs;
  }

  pause(nowMs: number): void {
    this.advance(nowMs);
    this.running = false;
  }

  resume(nowMs: number): void {
    this.running = true;
    this.lastTickAtMs = nowMs;
  }

  reset(): void {
    this.running = false;
    this.lastTickAtMs = null;
    this.distanceAlongRouteMeters = 0;
  }

  private advance(nowMs: number): void {
    if (this.running && this.lastTickAtMs !== null) {
      const elapsedS = Math.max(0, (nowMs - this.lastTickAtMs) / 1000);
      this.distanceAlongRouteMeters = Math.min(
        this.totalDistanceMeters,
        this.distanceAlongRouteMeters + elapsedS * this.speedMps,
      );
    }
    this.lastTickAtMs = nowMs;
  }

  /** Продвигает симуляцию до nowMs и возвращает текущий GPS-фикс. */
  tick(nowMs: number): SimulatedFix {
    this.advance(nowMs);

    const position = pointAtDistance(
      this.route.shape,
      this.cumulative,
      this.distanceAlongRouteMeters,
    );
    const lookAheadDistance = Math.min(this.totalDistanceMeters, this.distanceAlongRouteMeters + 1);
    const aheadPoint = pointAtDistance(this.route.shape, this.cumulative, lookAheadDistance);
    const bearing =
      this.distanceAlongRouteMeters >= this.totalDistanceMeters
        ? 0
        : bearingDegrees(position, aheadPoint);

    return {
      position,
      bearingDegrees: bearing,
      distanceAlongRouteMeters: this.distanceAlongRouteMeters,
      speedMps: this.running ? this.speedMps : 0,
      atMs: nowMs,
      finished: this.isFinished,
    };
  }
}
