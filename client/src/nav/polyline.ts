import type { LatLng } from './types';

/**
 * Декодер/кодер encoded polyline с точностью 1e6 ("polyline6") — так наш
 * роутер (сейчас — OSRM, см. src/nav/router.ts) просит кодировать geometry
 * шагов маршрута (`geometries=polyline6`). Алгоритм — как в официальной
 * документации Valhalla: https://valhalla.github.io/valhalla/api/decoding/
 * (это тот же алгоритм, что у Google Encoded Polyline и у OSRM, но с 6
 * знаками после запятой вместо 5 — координаты умножаются/делятся на 1e6,
 * а не на 1e5).
 */
const POLYLINE6_FACTOR = 1e6;

export function decodePolyline6(encoded: string): LatLng[] {
  let index = 0;
  let lat = 0;
  let lon = 0;
  const coordinates: LatLng[] = [];

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const latChange = result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const lonChange = result & 1 ? ~(result >> 1) : result >> 1;

    lat += latChange;
    lon += lonChange;
    coordinates.push({ lat: lat / POLYLINE6_FACTOR, lon: lon / POLYLINE6_FACTOR });
  }

  return coordinates;
}

function encodeSignedNumber(num: number): string {
  let sgnNum = num << 1;
  if (num < 0) {
    sgnNum = ~sgnNum;
  }
  let value = sgnNum;
  let out = '';
  while (value >= 0x20) {
    out += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
    value >>= 5;
  }
  out += String.fromCharCode(value + 63);
  return out;
}

/** Инверсия decodePolyline6 — используется в тестах на round-trip и в эмуляторе/симуляторе. */
export function encodePolyline6(points: readonly LatLng[]): string {
  let prevLat = 0;
  let prevLon = 0;
  let out = '';
  for (const p of points) {
    const lat = Math.round(p.lat * POLYLINE6_FACTOR);
    const lon = Math.round(p.lon * POLYLINE6_FACTOR);
    out += encodeSignedNumber(lat - prevLat);
    out += encodeSignedNumber(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}
