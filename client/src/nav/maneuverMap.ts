/**
 * Коды типов (`type`) и модификаторов (`modifier`) манёвров OSRM
 * (`routes[].legs[].steps[].maneuver`). Сверено с официальной документацией:
 * https://project-osrm.org/docs/v5.24.0/api/#step-maneuver-object — полный
 * перечень значений обоих полей, не по памяти.
 */
export const OsrmManeuverType = {
  TURN: 'turn',
  NEW_NAME: 'new name',
  DEPART: 'depart',
  ARRIVE: 'arrive',
  MERGE: 'merge',
  RAMP: 'ramp',
  ON_RAMP: 'on ramp',
  OFF_RAMP: 'off ramp',
  FORK: 'fork',
  END_OF_ROAD: 'end of road',
  USE_LANE: 'use lane',
  CONTINUE: 'continue',
  ROUNDABOUT: 'roundabout',
  ROTARY: 'rotary',
  ROUNDABOUT_TURN: 'roundabout turn',
  NOTIFICATION: 'notification',
  EXIT_ROUNDABOUT: 'exit roundabout',
  EXIT_ROTARY: 'exit rotary',
} as const;

export const OsrmManeuverModifier = {
  UTURN: 'uturn',
  SHARP_RIGHT: 'sharp right',
  RIGHT: 'right',
  SLIGHT_RIGHT: 'slight right',
  STRAIGHT: 'straight',
  SLIGHT_LEFT: 'slight left',
  LEFT: 'left',
  SHARP_LEFT: 'sharp left',
} as const;

/**
 * Коды иконок протокола О.Ч.К.О. (ТЗ §4.4). Прошивка рисует по ним стрелки 24×24.
 */
export const ManeuverIcon = {
  NONE: 0,
  STRAIGHT: 1,
  SLIGHT_RIGHT: 2,
  RIGHT: 3,
  SHARP_RIGHT: 4,
  UTURN: 5,
  SHARP_LEFT: 6,
  LEFT: 7,
  SLIGHT_LEFT: 8,
  ROUNDABOUT: 9,
  ARRIVE: 10,
  START: 11,
  STAIRS_OR_CROSSING: 12,
  KEEP_RIGHT: 13,
  KEEP_LEFT: 14,
  FERRY_OR_TRANSIT: 15,
} as const;

/** Манёвры, у которых есть осмысленный поворот — иконка берётся из modifier. */
const MODIFIER_TO_ICON: Readonly<Record<string, number>> = {
  [OsrmManeuverModifier.UTURN]: ManeuverIcon.UTURN,
  [OsrmManeuverModifier.SHARP_RIGHT]: ManeuverIcon.SHARP_RIGHT,
  [OsrmManeuverModifier.RIGHT]: ManeuverIcon.RIGHT,
  [OsrmManeuverModifier.SLIGHT_RIGHT]: ManeuverIcon.SLIGHT_RIGHT,
  [OsrmManeuverModifier.STRAIGHT]: ManeuverIcon.STRAIGHT,
  [OsrmManeuverModifier.SLIGHT_LEFT]: ManeuverIcon.SLIGHT_LEFT,
  [OsrmManeuverModifier.LEFT]: ManeuverIcon.LEFT,
  [OsrmManeuverModifier.SHARP_LEFT]: ManeuverIcon.SHARP_LEFT,
};

/** Манёвры, у которых иконка жёстко зависит от типа и modifier не несёт турн-семантики. */
const FIXED_TYPE_TO_ICON: Readonly<Record<string, number>> = {
  [OsrmManeuverType.DEPART]: ManeuverIcon.START,
  [OsrmManeuverType.ARRIVE]: ManeuverIcon.ARRIVE,
  [OsrmManeuverType.ROUNDABOUT]: ManeuverIcon.ROUNDABOUT,
  [OsrmManeuverType.ROTARY]: ManeuverIcon.ROUNDABOUT,
  [OsrmManeuverType.ROUNDABOUT_TURN]: ManeuverIcon.ROUNDABOUT,
  [OsrmManeuverType.EXIT_ROUNDABOUT]: ManeuverIcon.STRAIGHT,
  [OsrmManeuverType.EXIT_ROTARY]: ManeuverIcon.STRAIGHT,
};

const RIGHT_MODIFIERS: ReadonlySet<string> = new Set([
  OsrmManeuverModifier.SHARP_RIGHT,
  OsrmManeuverModifier.RIGHT,
  OsrmManeuverModifier.SLIGHT_RIGHT,
]);
const LEFT_MODIFIERS: ReadonlySet<string> = new Set([
  OsrmManeuverModifier.SHARP_LEFT,
  OsrmManeuverModifier.LEFT,
  OsrmManeuverModifier.SLIGHT_LEFT,
]);

/** true для типов, у которых есть номер съезда (`maneuver.exit`) — вход в кольцо. */
export function usesExitNumber(type: string): boolean {
  return (
    type === OsrmManeuverType.ROUNDABOUT ||
    type === OsrmManeuverType.ROTARY ||
    type === OsrmManeuverType.ROUNDABOUT_TURN
  );
}

export function mapOsrmManeuverToIcon(type: string, modifier?: string): number {
  if (type === OsrmManeuverType.FORK) {
    if (modifier && RIGHT_MODIFIERS.has(modifier)) return ManeuverIcon.KEEP_RIGHT;
    if (modifier && LEFT_MODIFIERS.has(modifier)) return ManeuverIcon.KEEP_LEFT;
    return ManeuverIcon.STRAIGHT;
  }

  const fixed = FIXED_TYPE_TO_ICON[type];
  if (fixed !== undefined) {
    return fixed;
  }

  // turn/new name/merge/ramp/on ramp/off ramp/end of road/use lane/continue/notification —
  // у всех этих типов поворот (если есть) описан в modifier; незнакомый тип падает в NONE.
  if (
    !Object.values(OsrmManeuverType).includes(
      type as (typeof OsrmManeuverType)[keyof typeof OsrmManeuverType],
    )
  ) {
    return ManeuverIcon.NONE;
  }
  if (!modifier) {
    return ManeuverIcon.STRAIGHT;
  }
  return MODIFIER_TO_ICON[modifier] ?? ManeuverIcon.STRAIGHT;
}
