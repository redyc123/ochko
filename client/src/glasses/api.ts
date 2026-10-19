import { encodeControlMessage, type ControlMessage } from '../ble/protocol/control';
import {
  encodeDisplayMessage,
  type DisplayMessage,
  type NotifyAppCode,
} from '../ble/protocol/display';
import type { GlassesEvent } from '../ble/protocol/events';

/**
 * То, что умеет либо реальное BLE-соединение (ble/connection.ts), либо
 * эмулятор очков (emulator/). GlassesApi от конкретной реализации не зависит —
 * и в эмулятор, и в очки уходят ровно одни и те же закодированные байты.
 */
export interface GlassesTransport {
  writeDisplay(bytes: Uint8Array): Promise<void>;
  writeControl(bytes: Uint8Array): Promise<void>;
  onGlassesEvent(listener: (event: GlassesEvent) => void): () => void;
}

/** 0..255 по кругу, свой счётчик на каждое направление записи (ТЗ §4.2). */
class SeqCounter {
  private value = -1;
  next(): number {
    this.value = (this.value + 1) % 256;
    return this.value;
  }
}

/**
 * Высокоуровневый API очков: showManeuver(), showText(), onButton() и т.д.
 * Кодирует сообщения протокола и отправляет через GlassesTransport —
 * реальное соединение или эмулятор, без разницы для вызывающего кода.
 */
export class GlassesApi {
  private readonly displaySeq = new SeqCounter();
  private readonly controlSeq = new SeqCounter();

  constructor(private readonly transport: GlassesTransport) {}

  private sendDisplay(message: DisplayMessage): Promise<void> {
    return this.transport.writeDisplay(encodeDisplayMessage(message, this.displaySeq.next()));
  }

  private sendControl(message: ControlMessage): Promise<void> {
    return this.transport.writeControl(encodeControlMessage(message, this.controlSeq.next()));
  }

  // --- Навигация (ТЗ §4.4) ---------------------------------------------------

  showManeuver(params: {
    icon: number;
    exitNo: number;
    distM: number | null;
    totalM: number;
    etaMin: number;
    street: string;
  }): Promise<void> {
    return this.sendDisplay({
      type: 'NAV_MANEUVER',
      icon: params.icon,
      exitNo: params.exitNo,
      distM: params.distM,
      totalM: params.totalM,
      etaMin: params.etaMin,
      street: params.street,
    });
  }

  showProgress(distM: number, totalM: number, etaMin: number): Promise<void> {
    return this.sendDisplay({ type: 'NAV_PROGRESS', distM, totalM, etaMin });
  }

  showNavState(state: number): Promise<void> {
    return this.sendDisplay({ type: 'NAV_STATE', state });
  }

  // --- Уведомления и агент (ТЗ §4.3) -----------------------------------------

  showNotify(params: {
    app: NotifyAppCode;
    prio: number;
    ttlS: number;
    title: string;
    body: string;
  }): Promise<void> {
    return this.sendDisplay({
      type: 'NOTIFY',
      app: params.app,
      prio: params.prio,
      ttlS: params.ttlS,
      title: params.title,
      body: params.body,
    });
  }

  showAgentState(state: number): Promise<void> {
    return this.sendDisplay({ type: 'AGENT_STATE', state });
  }

  showText(ttlS: number, text: string): Promise<void> {
    return this.sendDisplay({ type: 'AGENT_TEXT', ttlS, text });
  }

  showConfirm(id: number, timeoutS: number, text: string): Promise<void> {
    return this.sendDisplay({ type: 'CONFIRM', id, timeoutS, text });
  }

  clear(layer: number): Promise<void> {
    return this.sendDisplay({ type: 'CLEAR', layer });
  }

  // --- Control (ТЗ §4.7) ------------------------------------------------------

  setTime(unix: number, tzMin: number): Promise<void> {
    return this.sendControl({ type: 'SET_TIME', unix, tzMin });
  }

  setBrightness(level: number): Promise<void> {
    return this.sendControl({ type: 'BRIGHTNESS', level });
  }

  setAudioCtrl(cmd: number): Promise<void> {
    return this.sendControl({ type: 'AUDIO_CTRL', cmd });
  }

  setConnParams(mode: number): Promise<void> {
    return this.sendControl({ type: 'CONN_PARAMS', mode });
  }

  // --- События от очков (ТЗ §4.6) ---------------------------------------------

  onButton(listener: (kind: number) => void): () => void {
    return this.transport.onGlassesEvent((e) => {
      if (e.type === 'BUTTON') listener(e.kind);
    });
  }

  onWakeword(listener: () => void): () => void {
    return this.transport.onGlassesEvent((e) => {
      if (e.type === 'WAKEWORD') listener();
    });
  }

  onConfirmResult(listener: (id: number, result: boolean) => void): () => void {
    return this.transport.onGlassesEvent((e) => {
      if (e.type === 'CONFIRM_RESULT') listener(e.id, e.result);
    });
  }

  onBattery(listener: (percent: number, mv: number, charging: boolean) => void): () => void {
    return this.transport.onGlassesEvent((e) => {
      if (e.type === 'BATTERY') listener(e.percent, e.mv, e.charging);
    });
  }

  onGlassesError(listener: (code: number, text: string) => void): () => void {
    return this.transport.onGlassesEvent((e) => {
      if (e.type === 'ERROR') listener(e.code, e.text);
    });
  }
}
