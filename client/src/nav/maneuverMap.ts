/**
 * Коды типов манёвров Valhalla (поле `type` в `trip.legs[].maneuvers[]`).
 * Сверено с документацией:
 * https://github.com/valhalla/valhalla-docs/blob/master/turn-by-turn/api-reference.md
 * (раздел Maneuver Type), значения 0..36, не по памяти.
 */
export const ValhallaManeuverType = {
  NONE: 0,
  START: 1,
  START_RIGHT: 2,
  START_LEFT: 3,
  DESTINATION: 4,
  DESTINATION_RIGHT: 5,
  DESTINATION_LEFT: 6,
  BECOMES: 7,
  CONTINUE: 8,
  SLIGHT_RIGHT: 9,
  RIGHT: 10,
  SHARP_RIGHT: 11,
  UTURN_RIGHT: 12,
  UTURN_LEFT: 13,
  SHARP_LEFT: 14,
  LEFT: 15,
  SLIGHT_LEFT: 16,
  RAMP_STRAIGHT: 17,
  RAMP_RIGHT: 18,
  RAMP_LEFT: 19,
  EXIT_RIGHT: 20,
  EXIT_LEFT: 21,
  STAY_STRAIGHT: 22,
  STAY_RIGHT: 23,
  STAY_LEFT: 24,
  MERGE: 25,
  ROUNDABOUT_ENTER: 26,
  ROUNDABOUT_EXIT: 27,
  FERRY_ENTER: 28,
  FERRY_EXIT: 29,
  TRANSIT: 30,
  TRANSIT_TRANSFER: 31,
  TRANSIT_REMAIN_ON: 32,
  TRANSIT_CONNECTION_START: 33,
  TRANSIT_CONNECTION_TRANSFER: 34,
  TRANSIT_CONNECTION_DESTINATION: 35,
  POST_TRANSIT_CONNECTION_DESTINATION: 36,
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

/**
 * Таблица Valhalla type -> наша иконка. Неизвестные/будущие типы Valhalla
 * падают в ManeuverIcon.NONE — вызывающая сторона должна в этом случае
 * положить текст инструкции в поле street (ТЗ §4.4).
 */
const VALHALLA_TO_ICON: Readonly<Record<number, number>> = {
  [ValhallaManeuverType.NONE]: ManeuverIcon.NONE,
  [ValhallaManeuverType.START]: ManeuverIcon.START,
  [ValhallaManeuverType.START_RIGHT]: ManeuverIcon.START,
  [ValhallaManeuverType.START_LEFT]: ManeuverIcon.START,
  [ValhallaManeuverType.DESTINATION]: ManeuverIcon.ARRIVE,
  [ValhallaManeuverType.DESTINATION_RIGHT]: ManeuverIcon.ARRIVE,
  [ValhallaManeuverType.DESTINATION_LEFT]: ManeuverIcon.ARRIVE,
  [ValhallaManeuverType.BECOMES]: ManeuverIcon.STRAIGHT,
  [ValhallaManeuverType.CONTINUE]: ManeuverIcon.STRAIGHT,
  [ValhallaManeuverType.SLIGHT_RIGHT]: ManeuverIcon.SLIGHT_RIGHT,
  [ValhallaManeuverType.RIGHT]: ManeuverIcon.RIGHT,
  [ValhallaManeuverType.SHARP_RIGHT]: ManeuverIcon.SHARP_RIGHT,
  [ValhallaManeuverType.UTURN_RIGHT]: ManeuverIcon.UTURN,
  [ValhallaManeuverType.UTURN_LEFT]: ManeuverIcon.UTURN,
  [ValhallaManeuverType.SHARP_LEFT]: ManeuverIcon.SHARP_LEFT,
  [ValhallaManeuverType.LEFT]: ManeuverIcon.LEFT,
  [ValhallaManeuverType.SLIGHT_LEFT]: ManeuverIcon.SLIGHT_LEFT,
  [ValhallaManeuverType.RAMP_STRAIGHT]: ManeuverIcon.STRAIGHT,
  [ValhallaManeuverType.RAMP_RIGHT]: ManeuverIcon.SLIGHT_RIGHT,
  [ValhallaManeuverType.RAMP_LEFT]: ManeuverIcon.SLIGHT_LEFT,
  [ValhallaManeuverType.EXIT_RIGHT]: ManeuverIcon.RIGHT,
  [ValhallaManeuverType.EXIT_LEFT]: ManeuverIcon.LEFT,
  [ValhallaManeuverType.STAY_STRAIGHT]: ManeuverIcon.STRAIGHT,
  [ValhallaManeuverType.STAY_RIGHT]: ManeuverIcon.KEEP_RIGHT,
  [ValhallaManeuverType.STAY_LEFT]: ManeuverIcon.KEEP_LEFT,
  [ValhallaManeuverType.MERGE]: ManeuverIcon.STRAIGHT,
  [ValhallaManeuverType.ROUNDABOUT_ENTER]: ManeuverIcon.ROUNDABOUT,
  [ValhallaManeuverType.ROUNDABOUT_EXIT]: ManeuverIcon.STRAIGHT,
  [ValhallaManeuverType.FERRY_ENTER]: ManeuverIcon.FERRY_OR_TRANSIT,
  [ValhallaManeuverType.FERRY_EXIT]: ManeuverIcon.FERRY_OR_TRANSIT,
  [ValhallaManeuverType.TRANSIT]: ManeuverIcon.FERRY_OR_TRANSIT,
  [ValhallaManeuverType.TRANSIT_TRANSFER]: ManeuverIcon.FERRY_OR_TRANSIT,
  [ValhallaManeuverType.TRANSIT_REMAIN_ON]: ManeuverIcon.FERRY_OR_TRANSIT,
  [ValhallaManeuverType.TRANSIT_CONNECTION_START]: ManeuverIcon.FERRY_OR_TRANSIT,
  [ValhallaManeuverType.TRANSIT_CONNECTION_TRANSFER]: ManeuverIcon.FERRY_OR_TRANSIT,
  [ValhallaManeuverType.TRANSIT_CONNECTION_DESTINATION]: ManeuverIcon.FERRY_OR_TRANSIT,
  [ValhallaManeuverType.POST_TRANSIT_CONNECTION_DESTINATION]: ManeuverIcon.ARRIVE,
};

/** true для типов, после которых известен номер съезда (roundabout exit count). */
export function usesExitNumber(valhallaType: number): boolean {
  return valhallaType === ValhallaManeuverType.ROUNDABOUT_ENTER;
}

export function mapValhallaManeuverToIcon(valhallaType: number): number {
  return VALHALLA_TO_ICON[valhallaType] ?? ManeuverIcon.NONE;
}
