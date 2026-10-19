import { decodePolyline6, encodePolyline6 } from '@/nav/polyline';

describe('decodePolyline6', () => {
  it('декодирует известную строку polyline6 (пример из документации Valhalla)', () => {
    const points = decodePolyline6('e~epoA|jfpOiDaK');
    expect(points.length).toBe(2);
    expect(points[0]?.lat).toBeCloseTo(42.225139, 5);
    expect(points[0]?.lon).toBeCloseTo(-8.670911, 5);
    expect(points[1]?.lat).toBeCloseTo(42.225224, 5);
    expect(points[1]?.lon).toBeCloseTo(-8.670718, 5);
  });

  it('пустая строка даёт пустой массив', () => {
    expect(decodePolyline6('')).toEqual([]);
  });
});

describe('encodePolyline6 / decodePolyline6 round-trip', () => {
  it('encode->decode восстанавливает координаты с точностью 1e-6', () => {
    const points = [
      { lat: 55.751244, lon: 37.618423 },
      { lat: 55.75234, lon: 37.619501 },
      { lat: 55.753001, lon: 37.617 },
    ];
    const decoded = decodePolyline6(encodePolyline6(points));
    expect(decoded.length).toBe(points.length);
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(points[i]!.lat, 6);
      expect(p.lon).toBeCloseTo(points[i]!.lon, 6);
    });
  });

  it('работает с одной точкой и с отрицательными координатами', () => {
    const points = [{ lat: -33.865143, lon: -63.123456 }];
    expect(decodePolyline6(encodePolyline6(points))).toEqual(points);
  });
});
