import { RouteSimulator } from './simulate';
import type { LatLng, Route } from './types';

const longShape: LatLng[] = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 0.1 },
];

const longRoute: Route = {
  shape: longShape,
  maneuvers: [],
  distanceMeters: 11119.5,
  durationSeconds: 8000,
  profile: 'pedestrian',
};

describe('RouteSimulator', () => {
  it('движется со скоростью 5 км/ч по умолчанию', () => {
    const sim = new RouteSimulator(longRoute);
    sim.start(0);
    const fix = sim.tick(3600 * 1000); // 1 час
    expect(fix.distanceAlongRouteMeters).toBeCloseTo(5000, 0);
    expect(fix.finished).toBe(false);
  });

  it('множитель скорости ускоряет движение пропорционально', () => {
    const sim = new RouteSimulator(longRoute, { speedMultiplier: 10 });
    sim.start(0);
    const fix = sim.tick(10_000); // 10 с на x10 (50 км/ч)
    expect(fix.distanceAlongRouteMeters).toBeCloseTo(138.89, 1);
  });

  it('setSpeedMultiplier меняет скорость на лету', () => {
    const sim = new RouteSimulator(longRoute);
    sim.start(0);
    sim.tick(1000); // 1 с на x1 (~1.389 м/с)
    sim.setSpeedMultiplier(5);
    const fix = sim.tick(2000); // ещё 1 с, теперь на x5 (~6.944 м/с)
    expect(fix.distanceAlongRouteMeters).toBeCloseTo(1.3889 + 6.9444, 2);
  });

  it('setSpeedMultiplier(0) и отрицательные значения запрещены', () => {
    const sim = new RouteSimulator(longRoute);
    expect(() => sim.setSpeedMultiplier(0)).toThrow(RangeError);
    expect(() => sim.setSpeedMultiplier(-1)).toThrow(RangeError);
  });

  it('pause останавливает движение, resume продолжает с того же места', () => {
    const sim = new RouteSimulator(longRoute, { speedMultiplier: 10 });
    sim.start(0);
    sim.tick(5000);
    const distanceBeforePause = sim.tick(5000).distanceAlongRouteMeters;
    sim.pause(5000);
    const whilePaused = sim.tick(60_000); // время идёт, но симулятор на паузе
    expect(whilePaused.distanceAlongRouteMeters).toBeCloseTo(distanceBeforePause, 3);
    expect(whilePaused.speedMps).toBe(0);
    sim.resume(60_000);
    const afterResume = sim.tick(61_000); // ещё 1с движения
    expect(afterResume.distanceAlongRouteMeters).toBeGreaterThan(distanceBeforePause);
  });

  it('движение на восток даёт азимут около 90°', () => {
    const sim = new RouteSimulator(longRoute);
    sim.start(0);
    const fix = sim.tick(1000);
    expect(fix.bearingDegrees).toBeCloseTo(90, 0);
  });

  it('завершает симуляцию по достижении конца маршрута, не выходя за его пределы', () => {
    const shortRoute: Route = {
      shape: [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 0.001 },
      ],
      maneuvers: [],
      distanceMeters: 111.2,
      durationSeconds: 80,
      profile: 'pedestrian',
    };
    const sim = new RouteSimulator(shortRoute, { speedMultiplier: 50 });
    sim.start(0);
    const fix = sim.tick(60_000);
    expect(fix.finished).toBe(true);
    expect(fix.position.lon).toBeCloseTo(0.001, 6);
    expect(fix.bearingDegrees).toBe(0);

    const afterFinish = sim.tick(120_000);
    expect(afterFinish.distanceAlongRouteMeters).toBeCloseTo(fix.distanceAlongRouteMeters, 3);
  });

  it('reset возвращает симулятор в начало маршрута', () => {
    const sim = new RouteSimulator(longRoute);
    sim.start(0);
    sim.tick(10_000);
    sim.reset();
    expect(sim.isFinished).toBe(false);
    sim.start(100_000);
    const fix = sim.tick(101_000);
    expect(fix.distanceAlongRouteMeters).toBeCloseTo(1.3889, 3);
  });
});
