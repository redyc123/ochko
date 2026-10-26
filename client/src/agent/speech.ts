import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

/**
 * Распознавание речи с микрофона телефона — временная замена микрофону очков
 * (Этап 3 ещё не готов). iOS — SFSpeechRecognizer, Android — SpeechRecognizer,
 * web — Web Speech API (работает в Chrome).
 */
export interface ListenHandle {
  /** Финальный текст фразы ('' — ничего не распознано). */
  result: Promise<string>;
  /** Закончить запись досрочно и распознать сказанное. */
  stop(): void;
  /** Отменить без результата. */
  abort(): void;
}

export class SpeechError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechError';
  }
}

export function isSpeechAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export async function listenOnce(onPartial?: (text: string) => void): Promise<ListenHandle> {
  const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!permission.granted) {
    throw new SpeechError('Нет доступа к микрофону или распознаванию речи.');
  }

  let transcript = '';
  const subscriptions: { remove(): void }[] = [];
  const cleanup = () => subscriptions.forEach((s) => s.remove());

  const result = new Promise<string>((resolve, reject) => {
    subscriptions.push(
      ExpoSpeechRecognitionModule.addListener('result', (event) => {
        transcript = event.results[0]?.transcript ?? transcript;
        if (!event.isFinal) onPartial?.(transcript);
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        cleanup();
        resolve(transcript.trim());
      }),
      ExpoSpeechRecognitionModule.addListener('error', (event) => {
        // «no-speech»/«aborted» — не ошибка, просто пустая фраза
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        cleanup();
        reject(new SpeechError(`Распознавание: ${event.message || event.error}`));
      }),
    );
  });

  ExpoSpeechRecognitionModule.start({
    lang: 'ru-RU',
    interimResults: true,
    continuous: false,
    addsPunctuation: true,
  });

  return {
    result,
    stop: () => ExpoSpeechRecognitionModule.stop(),
    abort: () => ExpoSpeechRecognitionModule.abort(),
  };
}
