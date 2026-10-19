import {
  ManeuverIcon,
  ValhallaManeuverType,
  mapValhallaManeuverToIcon,
  usesExitNumber,
} from './maneuverMap';

describe('mapValhallaManeuverToIcon', () => {
  it('базовые повороты', () => {
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.CONTINUE)).toBe(ManeuverIcon.STRAIGHT);
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.RIGHT)).toBe(ManeuverIcon.RIGHT);
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.LEFT)).toBe(ManeuverIcon.LEFT);
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.SLIGHT_RIGHT)).toBe(
      ManeuverIcon.SLIGHT_RIGHT,
    );
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.SLIGHT_LEFT)).toBe(
      ManeuverIcon.SLIGHT_LEFT,
    );
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.SHARP_RIGHT)).toBe(
      ManeuverIcon.SHARP_RIGHT,
    );
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.SHARP_LEFT)).toBe(
      ManeuverIcon.SHARP_LEFT,
    );
  });

  it('разворот — и левый, и правый вариант дают одну иконку', () => {
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.UTURN_RIGHT)).toBe(ManeuverIcon.UTURN);
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.UTURN_LEFT)).toBe(ManeuverIcon.UTURN);
  });

  it('старт и прибытие', () => {
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.START)).toBe(ManeuverIcon.START);
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.START_LEFT)).toBe(ManeuverIcon.START);
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.DESTINATION)).toBe(ManeuverIcon.ARRIVE);
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.DESTINATION_RIGHT)).toBe(
      ManeuverIcon.ARRIVE,
    );
  });

  it('кольцо: вход даёт иконку кольца, выход — «прямо»', () => {
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.ROUNDABOUT_ENTER)).toBe(
      ManeuverIcon.ROUNDABOUT,
    );
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.ROUNDABOUT_EXIT)).toBe(
      ManeuverIcon.STRAIGHT,
    );
  });

  it('держаться правее/левее на развилке', () => {
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.STAY_RIGHT)).toBe(
      ManeuverIcon.KEEP_RIGHT,
    );
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.STAY_LEFT)).toBe(ManeuverIcon.KEEP_LEFT);
  });

  it('паром и общественный транспорт', () => {
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.FERRY_ENTER)).toBe(
      ManeuverIcon.FERRY_OR_TRANSIT,
    );
    expect(mapValhallaManeuverToIcon(ValhallaManeuverType.TRANSIT)).toBe(
      ManeuverIcon.FERRY_OR_TRANSIT,
    );
  });

  it('неизвестный/будущий тип Valhalla падает в NONE', () => {
    expect(mapValhallaManeuverToIcon(999)).toBe(ManeuverIcon.NONE);
  });

  it('usesExitNumber — только вход в кольцо', () => {
    expect(usesExitNumber(ValhallaManeuverType.ROUNDABOUT_ENTER)).toBe(true);
    expect(usesExitNumber(ValhallaManeuverType.ROUNDABOUT_EXIT)).toBe(false);
    expect(usesExitNumber(ValhallaManeuverType.RIGHT)).toBe(false);
  });
});
