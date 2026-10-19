import {
  bearingDegrees,
  buildCumulativeDistances,
  haversineMeters,
  pointAtDistance,
  projectPointToSegment,
  snapToShape,
} from '@/nav/geo';
import type { LatLng } from '@/nav/types';

describe('haversineMeters', () => {
  it('1 градус широты — всегда около 111.19 км, независимо от местоположения', () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111194.9, 0);
    expect(haversineMeters({ lat: 55, lon: 37 }, { lat: 56, lon: 37 })).toBeCloseTo(111194.9, 0);
  });

  it('расстояние от точки до самой себя — 0', () => {
    const p: LatLng = { lat: 55.751, lon: 37.618 };
    expect(haversineMeters(p, p)).toBe(0);
  });
});

describe('projectPointToSegment', () => {
  const a: LatLng = { lat: 0, lon: 0 };
  const b: LatLng = { lat: 0, lon: 0.01 };

  it('точка на отрезке — расстояние 0, t пропорционально', () => {
    const mid: LatLng = { lat: 0, lon: 0.005 };
    const proj = projectPointToSegment(mid, a, b);
    expect(proj.distanceMeters).toBeCloseTo(0, 3);
    expect(proj.t).toBeCloseTo(0.5, 2);
  });

  it('t зажимается в [0,1] для точек за пределами отрезка', () => {
    const beforeA: LatLng = { lat: 0, lon: -0.01 };
    const afterB: LatLng = { lat: 0, lon: 0.02 };
    expect(projectPointToSegment(beforeA, a, b).t).toBe(0);
    expect(projectPointToSegment(afterB, a, b).t).toBe(1);
  });

  it('смещение в сторону от отрезка даёт ненулевое расстояние', () => {
    const off: LatLng = { lat: 0.001, lon: 0.005 };
    const proj = projectPointToSegment(off, a, b);
    expect(proj.distanceMeters).toBeGreaterThan(50);
    expect(proj.t).toBeCloseTo(0.5, 2);
  });
});

describe('buildCumulativeDistances / snapToShape / pointAtDistance', () => {
  const shape: LatLng[] = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.001 },
    { lat: 0, lon: 0.002 },
    { lat: 0, lon: 0.003 },
  ];
  const cumulative = buildCumulativeDistances(shape);

  it('кумулятивное расстояние монотонно растёт и совпадает с суммой отрезков', () => {
    expect(cumulative[0]).toBe(0);
    for (let i = 1; i < cumulative.length; i += 1) {
      expect(cumulative[i]).toBeGreaterThan(cumulative[i - 1] as number);
    }
    const total = cumulative[cumulative.length - 1] as number;
    expect(total).toBeCloseTo(haversineMeters(shape[0] as LatLng, shape[3] as LatLng), 1);
  });

  it('snapToShape находит ближайший сегмент и расстояние вдоль маршрута', () => {
    const onRoute = snapToShape({ lat: 0, lon: 0.0015 }, shape, cumulative);
    expect(onRoute.segmentIndex).toBe(1);
    expect(onRoute.offRouteMeters).toBeCloseTo(0, 3);
    expect(onRoute.distanceAlongRouteMeters).toBeGreaterThan(cumulative[1] as number);
    expect(onRoute.distanceAlongRouteMeters).toBeLessThan(cumulative[2] as number);
  });

  it('snapToShape для точки далеко от маршрута даёт большое offRouteMeters', () => {
    const far = snapToShape({ lat: 0.001, lon: 0.0015 }, shape, cumulative);
    expect(far.offRouteMeters).toBeGreaterThan(50);
  });

  it('pointAtDistance возвращает концы и промежуточные точки корректно', () => {
    expect(pointAtDistance(shape, cumulative, 0)).toEqual(shape[0]);
    const total = cumulative[cumulative.length - 1] as number;
    const end = pointAtDistance(shape, cumulative, total);
    expect(end.lon).toBeCloseTo((shape[3] as LatLng).lon, 6);

    const half = pointAtDistance(shape, cumulative, total / 2);
    expect(haversineMeters(shape[0] as LatLng, half)).toBeCloseTo(total / 2, 0);
  });
});

describe('bearingDegrees', () => {
  it('движение строго на восток даёт ~90°', () => {
    const bearing = bearingDegrees({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(bearing).toBeCloseTo(90, 0);
  });

  it('движение строго на север даёт ~0°', () => {
    const bearing = bearingDegrees({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(bearing).toBeCloseTo(0, 0);
  });
});
