import type { LatLng } from './types';

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Расстояние между двумя точками по формуле гаверсинусов, метры. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Локальная тангенциальная проекция lat/lon в метры относительно опорной точки.
 * Точна для расстояний в пределах города (десятки км) — чего достаточно для
 * пешеходной/велосипедной навигации в этом приложении.
 */
function toLocalMeters(p: LatLng, origin: LatLng): { x: number; y: number } {
  const metersPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const metersPerDegLon = metersPerDegLat * Math.cos(toRad(origin.lat));
  return {
    x: (p.lon - origin.lon) * metersPerDegLon,
    y: (p.lat - origin.lat) * metersPerDegLat,
  };
}

function fromLocalMeters(xy: { x: number; y: number }, origin: LatLng): LatLng {
  const metersPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const metersPerDegLon = metersPerDegLat * Math.cos(toRad(origin.lat));
  return {
    lat: origin.lat + xy.y / metersPerDegLat,
    lon: origin.lon + xy.x / metersPerDegLon,
  };
}

export interface SegmentProjection {
  point: LatLng;
  /** 0..1 — доля пути от a до b */
  t: number;
  distanceMeters: number;
}

/** Ближайшая точка на отрезке [a,b] к точке p. */
export function projectPointToSegment(p: LatLng, a: LatLng, b: LatLng): SegmentProjection {
  const origin = a;
  const pxy = toLocalMeters(p, origin);
  const axy = { x: 0, y: 0 };
  const bxy = toLocalMeters(b, origin);

  const abx = bxy.x - axy.x;
  const aby = bxy.y - axy.y;
  const lenSq = abx * abx + aby * aby;

  let t = lenSq === 0 ? 0 : ((pxy.x - axy.x) * abx + (pxy.y - axy.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projXy = { x: axy.x + t * abx, y: axy.y + t * aby };
  const point = fromLocalMeters(projXy, origin);
  const distanceMeters = Math.hypot(pxy.x - projXy.x, pxy.y - projXy.y);
  return { point, t, distanceMeters };
}

/** Кумулятивное расстояние (в метрах) от начала маршрута к каждой точке shape. */
export function buildCumulativeDistances(shape: readonly LatLng[]): number[] {
  const result: number[] = [0];
  for (let i = 1; i < shape.length; i += 1) {
    const prevPoint = shape[i - 1] as LatLng;
    const curPoint = shape[i] as LatLng;
    const prev = result[i - 1] as number;
    result.push(prev + haversineMeters(prevPoint, curPoint));
  }
  return result;
}

export interface ShapeSnapResult {
  segmentIndex: number;
  point: LatLng;
  offRouteMeters: number;
  distanceAlongRouteMeters: number;
}

/**
 * Привязывает точку к ближайшему отрезку полилинии маршрута. Перебирает все
 * отрезки — для пешеходных/городских маршрутов (сотни точек) это дешевле, чем
 * усложнять код оконным поиском, и даёт корректный результат даже если GPS
 * «перепрыгнул» далеко вперёд/назад по маршруту.
 */
export function snapToShape(
  p: LatLng,
  shape: readonly LatLng[],
  cumulative: readonly number[],
): ShapeSnapResult {
  if (shape.length === 0) {
    throw new RangeError('snapToShape: пустой shape');
  }
  if (shape.length === 1) {
    const only = shape[0] as LatLng;
    return {
      segmentIndex: 0,
      point: only,
      offRouteMeters: haversineMeters(p, only),
      distanceAlongRouteMeters: 0,
    };
  }

  let best: ShapeSnapResult | null = null;
  for (let i = 0; i < shape.length - 1; i += 1) {
    const a = shape[i] as LatLng;
    const b = shape[i + 1] as LatLng;
    const proj = projectPointToSegment(p, a, b);
    if (best === null || proj.distanceMeters < best.offRouteMeters) {
      const segStart = cumulative[i] as number;
      const segLen = (cumulative[i + 1] as number) - segStart;
      best = {
        segmentIndex: i,
        point: proj.point,
        offRouteMeters: proj.distanceMeters,
        distanceAlongRouteMeters: segStart + proj.t * segLen,
      };
    }
  }
  return best as ShapeSnapResult;
}

/** Точка на расстоянии distanceMeters от начала маршрута вдоль shape (для симулятора). */
export function pointAtDistance(
  shape: readonly LatLng[],
  cumulative: readonly number[],
  distanceMeters: number,
): LatLng {
  const total = cumulative[cumulative.length - 1] as number;
  const clamped = Math.max(0, Math.min(total, distanceMeters));
  for (let i = 0; i < shape.length - 1; i += 1) {
    const segStart = cumulative[i] as number;
    const segEnd = cumulative[i + 1] as number;
    if (clamped <= segEnd || i === shape.length - 2) {
      const segLen = segEnd - segStart;
      const t = segLen === 0 ? 0 : (clamped - segStart) / segLen;
      const a = shape[i] as LatLng;
      const b = shape[i + 1] as LatLng;
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
      };
    }
  }
  return shape[shape.length - 1] as LatLng;
}

export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
