import type { LatLng } from '@/nav/types';

/** Камера карты (react-native-maps Region). */
export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Императивный интерфейс карты, который отдаёт RouteMap через ref. */
export interface MapApi {
  animateToRegion(region: MapRegion, durationMs?: number): void;
}

export const DEFAULT_CENTER: LatLng = { lat: 55.7558, lon: 37.6173 };
export const FOCUS_DELTA = 0.01;

/** Регион с центром в точке; дельта одна и та же для обоих направлений. */
export function centerRegion(point: LatLng, delta = FOCUS_DELTA): MapRegion {
  return {
    latitude: point.lat,
    longitude: point.lon,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
}

/**
 * Регион, в который помещаются все переданные точки с небольшим запасом.
 * Полезно, чтобы при сворачивании шторки показать весь маршрут целиком.
 */
export function fitRegion(
  points: LatLng[],
  opts: { padding?: number; minDelta?: number } = {},
): MapRegion {
  const { padding = 1.55, minDelta = 0.008 } = opts;
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length === 0) return centerRegion(DEFAULT_CENTER);

  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * padding, minDelta),
    longitudeDelta: Math.max((maxLon - minLon) * padding, minDelta),
  };
}

/**
 * Сдвигает центр региона чуть севернее (выше на экране) и слегка расширяет его,
 * чтобы маршрут не прятался за нижней шторкой. Используется в развёрнутом виде
 * шторки, когда видимая зона карты — это только область над ней.
 */
export function shiftUp(region: MapRegion, fraction = 0.16): MapRegion {
  return {
    latitude: region.latitude + region.latitudeDelta * fraction,
    longitude: region.longitude,
    latitudeDelta: region.latitudeDelta * (1 + fraction),
    longitudeDelta: region.longitudeDelta,
  };
}
