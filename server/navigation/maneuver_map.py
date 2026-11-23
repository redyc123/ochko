"""Маппинг манёвров OSRM -> коды иконок протокола О.Ч.К.О.

Порт `client/src/nav/maneuverMap.ts`. Перечень значений `type`/`modifier`
сверил с официальной документацией OSRM:
https://project-osrm.org/docs/v5.24.0/api/#step-maneuver-object
"""

# Иконки протокола (ТЗ §4.4).
class ManeuverIcon:
    NONE = 0
    STRAIGHT = 1
    SLIGHT_RIGHT = 2
    RIGHT = 3
    SHARP_RIGHT = 4
    UTURN = 5
    SHARP_LEFT = 6
    LEFT = 7
    SLIGHT_LEFT = 8
    ROUNDABOUT = 9
    ARRIVE = 10
    START = 11
    STAIRS_OR_CROSSING = 12
    KEEP_RIGHT = 13
    KEEP_LEFT = 14
    FERRY_OR_TRANSIT = 15


# Типы и модификаторы манёвров OSRM.
OsrmManeuverType = {
    "TURN": "turn",
    "NEW_NAME": "new name",
    "DEPART": "depart",
    "ARRIVE": "arrive",
    "MERGE": "merge",
    "RAMP": "ramp",
    "ON_RAMP": "on ramp",
    "OFF_RAMP": "off ramp",
    "FORK": "fork",
    "END_OF_ROAD": "end of road",
    "USE_LANE": "use lane",
    "CONTINUE": "continue",
    "ROUNDABOUT": "roundabout",
    "ROTARY": "rotary",
    "ROUNDABOUT_TURN": "roundabout turn",
    "NOTIFICATION": "notification",
    "EXIT_ROUNDABOUT": "exit roundabout",
    "EXIT_ROTARY": "exit rotary",
}

OsrmManeuverModifier = {
    "UTURN": "uturn",
    "SHARP_RIGHT": "sharp right",
    "RIGHT": "right",
    "SLIGHT_RIGHT": "slight right",
    "STRAIGHT": "straight",
    "SLIGHT_LEFT": "slight left",
    "LEFT": "left",
    "SHARP_LEFT": "sharp left",
}

_MODIFIER_TO_ICON = {
    OsrmManeuverModifier["UTURN"]: ManeuverIcon.UTURN,
    OsrmManeuverModifier["SHARP_RIGHT"]: ManeuverIcon.SHARP_RIGHT,
    OsrmManeuverModifier["RIGHT"]: ManeuverIcon.RIGHT,
    OsrmManeuverModifier["SLIGHT_RIGHT"]: ManeuverIcon.SLIGHT_RIGHT,
    OsrmManeuverModifier["STRAIGHT"]: ManeuverIcon.STRAIGHT,
    OsrmManeuverModifier["SLIGHT_LEFT"]: ManeuverIcon.SLIGHT_LEFT,
    OsrmManeuverModifier["LEFT"]: ManeuverIcon.LEFT,
    OsrmManeuverModifier["SHARP_LEFT"]: ManeuverIcon.SHARP_LEFT,
}

_FIXED_TYPE_TO_ICON = {
    OsrmManeuverType["DEPART"]: ManeuverIcon.START,
    OsrmManeuverType["ARRIVE"]: ManeuverIcon.ARRIVE,
    OsrmManeuverType["ROUNDABOUT"]: ManeuverIcon.ROUNDABOUT,
    OsrmManeuverType["ROTARY"]: ManeuverIcon.ROUNDABOUT,
    OsrmManeuverType["ROUNDABOUT_TURN"]: ManeuverIcon.ROUNDABOUT,
    OsrmManeuverType["EXIT_ROUNDABOUT"]: ManeuverIcon.STRAIGHT,
    OsrmManeuverType["EXIT_ROTARY"]: ManeuverIcon.STRAIGHT,
}

_RIGHT_MODIFIERS = frozenset(
    {
        OsrmManeuverModifier["SHARP_RIGHT"],
        OsrmManeuverModifier["RIGHT"],
        OsrmManeuverModifier["SLIGHT_RIGHT"],
    }
)
_LEFT_MODIFIERS = frozenset(
    {
        OsrmManeuverModifier["SHARP_LEFT"],
        OsrmManeuverModifier["LEFT"],
        OsrmManeuverModifier["SLIGHT_LEFT"],
    }
)

_ALL_TYPES = frozenset(OsrmManeuverType.values())


def uses_exit_number(type_: str) -> bool:
    """true для типов, у которых есть номер съезда - вход в кольцо."""
    return type_ in (
        OsrmManeuverType["ROUNDABOUT"],
        OsrmManeuverType["ROTARY"],
        OsrmManeuverType["ROUNDABOUT_TURN"],
    )


def map_osrm_maneuver_to_icon(type_: str, modifier: str | None = None) -> int:
    if type_ == OsrmManeuverType["FORK"]:
        if modifier and modifier in _RIGHT_MODIFIERS:
            return ManeuverIcon.KEEP_RIGHT
        if modifier and modifier in _LEFT_MODIFIERS:
            return ManeuverIcon.KEEP_LEFT
        return ManeuverIcon.STRAIGHT

    fixed = _FIXED_TYPE_TO_ICON.get(type_)
    if fixed is not None:
        return fixed

    # Незнакомый тип -> NONE.
    if type_ not in _ALL_TYPES:
        return ManeuverIcon.NONE
    if not modifier:
        return ManeuverIcon.STRAIGHT
    return _MODIFIER_TO_ICON.get(modifier, ManeuverIcon.STRAIGHT)