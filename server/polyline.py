"""Encoded polyline (polyline6) decoder/encoder.

Порт `client/src/nav/polyline.ts`. Алгоритм — как в официальной документации
Valhalla (https://valhalla.github.io/valhalla/api/decoding/): то же правило, что
у Google Encoded Polyline и OSRM, но с 6 знаками после запятой (координаты
умножаются/делятся на 1e6, а не 1e5).
"""

POLYLINE6_FACTOR = 1_000_000


def decode_polyline6(encoded: str) -> list[tuple[float, float]]:
    """Возвращает список `(lat, lon)` из encoded polyline."""
    index = 0
    lat = 0
    lon = 0
    coordinates: list[tuple[float, float]] = []
    n = len(encoded)

    while index < n:
        # lat change
        shift = 0
        result = 0
        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        lat_change = ~(result >> 1) if result & 1 else result >> 1

        # lon change
        shift = 0
        result = 0
        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        lon_change = ~(result >> 1) if result & 1 else result >> 1

        lat += lat_change
        lon += lon_change
        coordinates.append((lat / POLYLINE6_FACTOR, lon / POLYLINE6_FACTOR))

    return coordinates


def _encode_signed_number(num: int) -> str:
    sgn_num = num << 1
    if num < 0:
        sgn_num = ~sgn_num
    value = sgn_num
    out = []
    while value >= 0x20:
        out.append(chr((0x20 | (value & 0x1F)) + 63))
        value >>= 5
    out.append(chr(value + 63))
    return "".join(out)


def encode_polyline6(points: list[tuple[float, float]]) -> str:
    """Инверсия decode_polyline6 — используется в тестах на round-trip."""
    prev_lat = 0
    prev_lon = 0
    out = []
    for lat_f, lon_f in points:
        lat = round(lat_f * POLYLINE6_FACTOR)
        lon = round(lon_f * POLYLINE6_FACTOR)
        out.append(_encode_signed_number(lat - prev_lat))
        out.append(_encode_signed_number(lon - prev_lon))
        prev_lat = lat
        prev_lon = lon
    return "".join(out)