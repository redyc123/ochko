"""Разбор ответа на уточнение «какой из адресов?» без LLM.

Порт `client/src/agent/parseChoice.ts`. Быстрые ответы: «второй», «номер 3»,
«давай последний», «отмена». Если фраза похожа на что-то другое — None, решает
модель.
"""

from __future__ import annotations

import re

# \b в JS не понимает кириллицу — границы слов задаются явными пробелами.
def _word(body: str) -> re.Pattern:
    return re.compile(rf"(?<= )({body})(?= )", re.UNICODE)


ADJ = r"(?:ый|ой|ий|ая|ья|ое|ье|ую|ью|ого|его|ьего)"
_ORDINALS: list[tuple[re.Pattern, int]] = [
    (_word(rf"перв{ADJ}|один|одну"), 1),
    (_word(rf"втор{ADJ}|два|две"), 2),
    (_word(rf"трет{ADJ}|три"), 3),
    (_word(rf"четв[её]рт{ADJ}|четыре"), 4),
    (_word(rf"пят{ADJ}|пять"), 5),
]

_LAST_RE = _word(rf"последн{ADJ}")
_CANCEL_RE = _word(r"отмен\S*|не надо|никак\S*|стоп")
_DIGIT_RE = re.compile(r"(?<= )(\d{1,2})(?= )")
_MAX_WORDS = 4

# {"kind": "index", "index": int} | {"kind": "cancel"} | None
Choice = dict | None


def parse_choice(text: str, count: int) -> Choice:
    normalized = (
        re.sub(r"[.,!?;:«»\"]", " ", text.lower()).replace("\n", " ").strip()
    )
    normalized = re.sub(r"\s+", " ", normalized)
    if not normalized or len(normalized.split(" ")) > _MAX_WORDS:
        return None

    t = f" {normalized} "

    if _CANCEL_RE.search(t):
        return {"kind": "cancel"}
    if _LAST_RE.search(t):
        return {"kind": "index", "index": count - 1} if count > 0 else None

    digit = _DIGIT_RE.search(t)
    if digit:
        n = int(digit.group(1))
        return {"kind": "index", "index": n - 1} if 1 <= n <= count else None

    for re_, n in _ORDINALS:
        if re_.search(t):
            return {"kind": "index", "index": n - 1} if n <= count else None
    return None