"""Распознавание речи (STT) на сервере.

Пока обработка реального аудио с очков относится к Этапу 3 и не подключена.
Здесь — интерфейс `SpeechToText` + абстрактный провайдер, чтобы /stt уже был
на месте: клиент шлёт аудио, сервер распознаёт. Конкретные провайдеры
(Yandex SpeechKit / Whisper API / офлайн Vosk) подключаются по настройкам.

Порт интерфейса `SpeechToText.transcribe` из `docs/PLAN.md` (Этап 3).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Transcription:
    text: str
    confidence: float | None = None


class SpeechToText:
    """Базовый класс провайдера распознавания речи."""

    async def transcribe(self, pcm: bytes, sample_rate: int) -> Transcription:
        raise NotImplementedError


class UnconfiguredSpeechToText(SpeechToText):
    """Заглушка по умолчанию: ключи не заданы, распознавание недоступно."""

    def __init__(self, message: str = "STT не настроен: добавьте ключ провайдера распознавания.") -> None:
        self.message = message

    async def transcribe(self, pcm: bytes, sample_rate: int) -> Transcription:
        raise STTError(self.message)


class STTError(Exception):
    pass