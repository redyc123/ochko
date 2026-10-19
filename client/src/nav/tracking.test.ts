import { buildCumulativeDistances } from './geo';
import {
  RerouteDetector,
  formatDistanceRu,
  hasGpsTimedOut,
  isArrived,
  roundDistanceMeters,
  shouldSendProgress,
  trackPosition,
} from './tracking';
import type { LatLng, Route } from './types';

const shape: LatLng[] = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 0.001 },
  { lat: 0, lon: 0.002 },
  { lat: 0, lon: 0.003 },
];
const cumulative = buildCumulativeDistances(shape);
const totalDistance = cumulative[cumulative.length - 1] as number;

const route: Route = {
  shape,
  distanceMeters: totalDistance,
  durationSeconds: 300,
  profile: 'pedestrian',
  maneuvers: [
    {
      type: 1,
      instruction: 'Идите на восток',
      streetNames: ['Начало'],
      distanceMeters: 0,
      durationSeconds: 0,
      beginShapeIndex: 0,
      endShapeIndex: 1,
    },
    {
      type: 10,
      instruction: 'Поверните направо',
      streetNames: ['ул. Советская'],
      distanceMeters: 0,
      durationSeconds: 0,
      beginShapeIndex: 1,
      endShapeIndex: 2,
    },
    {
      type: 4,
      instruction: 'Вы на месте',
      streetNames: [],
      distanceMeters: 0,
      durationSeconds: 0,
      beginShapeIndex: 2,
      endShapeIndex: 3,
    },
  ],
};

describe('trackPosition', () => {
  it('в начале маршрута показывает первый поворот как upcoming', () => {
    const result = trackPosition(route, shape[0] as LatLng);
    expect(result.currentManeuverIndex).toBe(0);
    expect(result.upcomingManeuverIndex).toBe(1);
    expect(result.distanceToUpcomingManeuverMeters).toBeCloseTo(cumulative[1] as number, 0);
    expect(result.offRouteMeters).toBeCloseTo(0, 3);
  });

  it('в середине второго сегмента — текущий манёвр 1, upcoming — прибытие', () => {
    const position: LatLng = { lat: 0, lon: 0.0015 };
    const result = trackPosition(route, position);
    expect(result.currentManeuverIndex).toBe(1);
    expect(result.upcomingManeuverIndex).toBe(2);
    expect(result.distanceToUpcomingManeuverMeters).toBeGreaterThan(0);
  });

  it('у цели — upcoming совпадает с текущим (последним) манёвром, расстояние ~0', () => {
    const result = trackPosition(route, shape[3] as LatLng);
    expect(result.currentManeuverIndex).toBe(2);
    expect(result.upcomingManeuverIndex).toBe(2);
    expect(result.distanceToUpcomingManeuverMeters).toBeCloseTo(0, 1);
    expect(result.remainingDistanceMeters).toBeCloseTo(0, 1);
  });

  it('сход с маршрута — большое offRouteMeters', () => {
    const farAway: LatLng = { lat: 0.01, lon: 0.0015 };
    const result = trackPosition(route, farAway);
    expect(result.offRouteMeters).toBeGreaterThan(30);
  });

  it('remainingDistanceMeters монотонно убывает при движении вперёд', () => {
    const r1 = trackPosition(route, { lat: 0, lon: 0 });
    const r2 = trackPosition(route, { lat: 0, lon: 0.0015 });
    const r3 = trackPosition(route, { lat: 0, lon: 0.003 });
    expect(r1.remainingDistanceMeters).toBeGreaterThan(r2.remainingDistanceMeters);
    expect(r2.remainingDistanceMeters).toBeGreaterThan(r3.remainingDistanceMeters);
  });
});

describe('roundDistanceMeters', () => {
  it.each([
    [0, 0],
    [-5, 0],
    [3, 5],
    [8, 10],
    [97, 95],
    [140, 140],
    [144, 140],
    [146, 150],
    [999, 1000],
    [1200, 1200],
    [1240, 1200],
    [1260, 1300],
  ])('round(%i) === %i', (input, expected) => {
    expect(roundDistanceMeters(input)).toBe(expected);
  });
});

describe('formatDistanceRu', () => {
  it('до 1 км — в метрах', () => {
    expect(formatDistanceRu(140)).toBe('140 м');
  });

  it('от 1 км — в километрах с запятой', () => {
    expect(formatDistanceRu(1200)).toBe('1,2 км');
  });

  it('округлённое целое число км — без десятых', () => {
    expect(formatDistanceRu(2000)).toBe('2 км');
  });
});

describe('shouldSendProgress', () => {
  it('первый замер всегда отправляется', () => {
    expect(shouldSendProgress(null, { distanceM: 500, atMs: 0 })).toBe(true);
  });

  it('не чаще раза в секунду', () => {
    const prev = { distanceM: 500, atMs: 1000 };
    expect(shouldSendProgress(prev, { distanceM: 400, atMs: 1500 })).toBe(false);
  });

  it('при неизменном расстоянии не отправляется', () => {
    const prev = { distanceM: 500, atMs: 1000 };
    expect(shouldSendProgress(prev, { distanceM: 500, atMs: 3000 })).toBe(false);
  });

  it('до 500 м порог фиксированный — 5 м', () => {
    const prev = { distanceM: 300, atMs: 1000 };
    expect(shouldSendProgress(prev, { distanceM: 296, atMs: 2000 })).toBe(false);
    expect(shouldSendProgress(prev, { distanceM: 295, atMs: 2000 })).toBe(true);
  });

  it('свыше 500 м порог — 10% от расстояния', () => {
    const prev = { distanceM: 1000, atMs: 1000 };
    expect(shouldSendProgress(prev, { distanceM: 950, atMs: 2000 })).toBe(false);
    expect(shouldSendProgress(prev, { distanceM: 849, atMs: 2000 })).toBe(true);
  });
});

describe('isArrived / hasGpsTimedOut', () => {
  it('isArrived использует порог 15 м по умолчанию', () => {
    expect(isArrived(15)).toBe(true);
    expect(isArrived(16)).toBe(false);
  });

  it('hasGpsTimedOut срабатывает строго после 10 с', () => {
    expect(hasGpsTimedOut(0, 10_000)).toBe(false);
    expect(hasGpsTimedOut(0, 10_001)).toBe(true);
  });
});

describe('RerouteDetector', () => {
  it('не триггерит перестроение, пока отклонение в пределах порога', () => {
    const detector = new RerouteDetector();
    expect(detector.update(10, 0)).toBe(false);
    expect(detector.update(29, 50_000)).toBe(false);
  });

  it('триггерит перестроение после 10 с устойчивого отклонения > 30 м', () => {
    const detector = new RerouteDetector();
    expect(detector.update(50, 0)).toBe(false);
    expect(detector.update(50, 5_000)).toBe(false);
    expect(detector.update(50, 10_001)).toBe(true);
  });

  it('не триггерит перестроение чаще, чем раз в 15 с (кулдаун)', () => {
    const detector = new RerouteDetector();
    expect(detector.update(50, 0)).toBe(false);
    expect(detector.update(50, 10_001)).toBe(true); // первое перестроение

    expect(detector.update(50, 10_002)).toBe(false); // таймер отклонения стартует заново
    expect(detector.update(50, 20_003)).toBe(false); // 10с отклонения набралось, но кулдаун 15с не прошёл (10002мс)
    expect(detector.update(50, 24_999)).toBe(false); // кулдаун ещё не прошёл (14998мс с прошлого)
    expect(detector.update(50, 25_002)).toBe(true); // кулдаун прошёл (15001мс) — второе перестроение
  });

  it('возврат на маршрут сбрасывает таймер отклонения', () => {
    const detector = new RerouteDetector();
    expect(detector.update(50, 0)).toBe(false);
    expect(detector.update(5, 5_000)).toBe(false); // вернулись на маршрут
    expect(detector.update(50, 10_001)).toBe(false); // таймер должен начаться заново, не с нуля
  });
});
