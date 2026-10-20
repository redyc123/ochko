import { ManeuverIcon, mapOsrmManeuverToIcon, usesExitNumber } from '@/nav/maneuverMap';

describe('mapOsrmManeuverToIcon', () => {
  it('базовые повороты (type=turn + modifier)', () => {
    expect(mapOsrmManeuverToIcon('turn', 'straight')).toBe(ManeuverIcon.STRAIGHT);
    expect(mapOsrmManeuverToIcon('turn', 'right')).toBe(ManeuverIcon.RIGHT);
    expect(mapOsrmManeuverToIcon('turn', 'left')).toBe(ManeuverIcon.LEFT);
    expect(mapOsrmManeuverToIcon('turn', 'slight right')).toBe(ManeuverIcon.SLIGHT_RIGHT);
    expect(mapOsrmManeuverToIcon('turn', 'slight left')).toBe(ManeuverIcon.SLIGHT_LEFT);
    expect(mapOsrmManeuverToIcon('turn', 'sharp right')).toBe(ManeuverIcon.SHARP_RIGHT);
    expect(mapOsrmManeuverToIcon('turn', 'sharp left')).toBe(ManeuverIcon.SHARP_LEFT);
  });

  it('разворот — одна иконка', () => {
    expect(mapOsrmManeuverToIcon('turn', 'uturn')).toBe(ManeuverIcon.UTURN);
    expect(mapOsrmManeuverToIcon('end of road', 'uturn')).toBe(ManeuverIcon.UTURN);
  });

  it('старт и прибытие — не зависят от modifier', () => {
    expect(mapOsrmManeuverToIcon('depart')).toBe(ManeuverIcon.START);
    expect(mapOsrmManeuverToIcon('depart', 'left')).toBe(ManeuverIcon.START);
    expect(mapOsrmManeuverToIcon('arrive')).toBe(ManeuverIcon.ARRIVE);
    expect(mapOsrmManeuverToIcon('arrive', 'right')).toBe(ManeuverIcon.ARRIVE);
  });

  it('кольцо: вход (roundabout/rotary/roundabout turn) даёт иконку кольца, выход — «прямо»', () => {
    expect(mapOsrmManeuverToIcon('roundabout')).toBe(ManeuverIcon.ROUNDABOUT);
    expect(mapOsrmManeuverToIcon('rotary')).toBe(ManeuverIcon.ROUNDABOUT);
    expect(mapOsrmManeuverToIcon('roundabout turn')).toBe(ManeuverIcon.ROUNDABOUT);
    expect(mapOsrmManeuverToIcon('exit roundabout')).toBe(ManeuverIcon.STRAIGHT);
    expect(mapOsrmManeuverToIcon('exit rotary')).toBe(ManeuverIcon.STRAIGHT);
  });

  it('развилка (fork) — держаться правее/левее по modifier, а не обычный поворот', () => {
    expect(mapOsrmManeuverToIcon('fork', 'slight right')).toBe(ManeuverIcon.KEEP_RIGHT);
    expect(mapOsrmManeuverToIcon('fork', 'right')).toBe(ManeuverIcon.KEEP_RIGHT);
    expect(mapOsrmManeuverToIcon('fork', 'slight left')).toBe(ManeuverIcon.KEEP_LEFT);
    expect(mapOsrmManeuverToIcon('fork', 'left')).toBe(ManeuverIcon.KEEP_LEFT);
    expect(mapOsrmManeuverToIcon('fork')).toBe(ManeuverIcon.STRAIGHT);
  });

  it('new name/continue/use lane без modifier — «прямо», но с modifier — настоящий поворот', () => {
    expect(mapOsrmManeuverToIcon('new name')).toBe(ManeuverIcon.STRAIGHT);
    expect(mapOsrmManeuverToIcon('continue')).toBe(ManeuverIcon.STRAIGHT);
    expect(mapOsrmManeuverToIcon('use lane')).toBe(ManeuverIcon.STRAIGHT);
    expect(mapOsrmManeuverToIcon('new name', 'left')).toBe(ManeuverIcon.LEFT);
    expect(mapOsrmManeuverToIcon('use lane', 'slight right')).toBe(ManeuverIcon.SLIGHT_RIGHT);
  });

  it('merge/ramp/on ramp/off ramp/end of road/notification — через modifier', () => {
    expect(mapOsrmManeuverToIcon('merge', 'right')).toBe(ManeuverIcon.RIGHT);
    expect(mapOsrmManeuverToIcon('ramp', 'left')).toBe(ManeuverIcon.LEFT);
    expect(mapOsrmManeuverToIcon('on ramp', 'slight right')).toBe(ManeuverIcon.SLIGHT_RIGHT);
    expect(mapOsrmManeuverToIcon('off ramp', 'slight left')).toBe(ManeuverIcon.SLIGHT_LEFT);
    expect(mapOsrmManeuverToIcon('end of road', 'right')).toBe(ManeuverIcon.RIGHT);
    expect(mapOsrmManeuverToIcon('notification')).toBe(ManeuverIcon.STRAIGHT);
  });

  it('неизвестный/будущий тип OSRM падает в NONE', () => {
    expect(mapOsrmManeuverToIcon('teleport')).toBe(ManeuverIcon.NONE);
  });

  it('неизвестный modifier у известного типа падает в STRAIGHT, не в NONE', () => {
    expect(mapOsrmManeuverToIcon('turn', 'warp speed')).toBe(ManeuverIcon.STRAIGHT);
  });

  it('usesExitNumber — только вход в кольцо (roundabout/rotary/roundabout turn)', () => {
    expect(usesExitNumber('roundabout')).toBe(true);
    expect(usesExitNumber('rotary')).toBe(true);
    expect(usesExitNumber('roundabout turn')).toBe(true);
    expect(usesExitNumber('exit roundabout')).toBe(false);
    expect(usesExitNumber('turn')).toBe(false);
  });
});
