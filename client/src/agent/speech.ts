import type { ExpoSpeechRecognitionModule as SpeechModule } from 'expo-speech-recognition';

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

/**
 * Модуль грузится лениво: в dev-клиенте, собранном до добавления
 * expo-speech-recognition, нативной части нет, и статический import ронял бы
 * всё приложение. Без неё просто недоступен голосовой ввод.
 */
let cachedModule: typeof SpeechModule | null | undefined;

function speechModule(): typeof SpeechModule | null {
  if (cachedModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cachedModule = (
        require('expo-speech-recognition') as { ExpoSpeechRecognitionModule: typeof SpeechModule }
      ).ExpoSpeechRecognitionModule;
    } catch {
      cachedModule = null;
    }
  }
  return cachedModule;
}

export function isSpeechAvailable(): boolean {
  try {
    return speechModule()?.isRecognitionAvailable() ?? false;
  } catch {
    return false;
  }
}

export async function listenOnce(onPartial?: (text: string) => void): Promise<ListenHandle> {
  const ExpoSpeechRecognitionModule = speechModule();
  if (!ExpoSpeechRecognitionModule) {
    throw new SpeechError(
      'Распознавание речи не собрано в это приложение — пересоберите dev-клиент.',
    );
  }
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
