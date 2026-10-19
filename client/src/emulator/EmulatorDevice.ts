import { ByteWriter } from '../ble/protocol/bytes';
import { decodeControlMessage, type ControlMessage } from '../ble/protocol/control';
import { decodeDisplayMessage } from '../ble/protocol/display';
import {
  decodeEvent,
  encodeEvent,
  type ButtonKindCode,
  type GlassesEvent,
} from '../ble/protocol/events';
import { PacketReassembler } from '../ble/protocol/fragment';
import { PROTOCOL_VERSION, encodeHeader } from '../ble/protocol/header';
import type { GlassesInfo } from '../ble/protocol/info';
import type { GlassesTransport } from '../glasses/api';
import {
  applyDisplayMessage,
  createInitialScreenState,
  type EmulatorScreenState,
} from './screenState';

export const EMULATOR_INFO: GlassesInfo = {
  protoVer: PROTOCOL_VERSION,
  fwMajor: 0,
  fwMinor: 0,
  fwPatch: 0,
  caps: { audio: true, wakeword: true, navIcons: true, cyrillic: true },
};

export interface EmulatorControlState {
  brightness: number;
  audioRecording: boolean;
  connFast: boolean;
  lastSetTimeUnix: number | null;
}

function createInitialControlState(): EmulatorControlState {
  return { brightness: 255, audioRecording: false, connFast: false, lastSetTimeUnix: null };
}

function applyControlMessage(
  state: EmulatorControlState,
  message: ControlMessage,
): EmulatorControlState {
  switch (message.type) {
    case 'SET_TIME':
      return { ...state, lastSetTimeUnix: message.unix };
    case 'BRIGHTNESS':
      return { ...state, brightness: message.level };
    case 'AUDIO_CTRL':
      return { ...state, audioRecording: message.cmd === 1 };
    case 'CONN_PARAMS':
      return { ...state, connFast: message.mode === 1 };
  }
}

/**
 * Виртуальные очки: тот же GlassesTransport, что и реальное BLE-соединение,
 * но вместо антенны — декодер протокола и экран 72×40 прямо в приложении
 * (ТЗ §2, «Эмулятор очков»). Декодирует ровно те же байты, что уходили бы в
 * реальные очки, поэтому заодно проверяет кодеки протокола на каждый вызов.
 */
export class EmulatorDevice implements GlassesTransport {
  readonly info = EMULATOR_INFO;

  private screenState: EmulatorScreenState = createInitialScreenState();
  private controlState: EmulatorControlState = createInitialControlState();
  private readonly displayReassembler = new PacketReassembler();
  private readonly controlReassembler = new PacketReassembler();
  private readonly screenListeners = new Set<(s: EmulatorScreenState) => void>();
  private readonly controlListeners = new Set<(s: EmulatorControlState) => void>();
  private readonly eventListeners = new Set<(e: GlassesEvent) => void>();
  private eventSeq = -1;

  getScreenState(): EmulatorScreenState {
    return this.screenState;
  }

  getControlState(): EmulatorControlState {
    return this.controlState;
  }

  onScreenChange(listener: (s: EmulatorScreenState) => void): () => void {
    this.screenListeners.add(listener);
    return () => this.screenListeners.delete(listener);
  }

  onControlChange(listener: (s: EmulatorControlState) => void): () => void {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  onGlassesEvent(listener: (e: GlassesEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async writeDisplay(bytes: Uint8Array): Promise<void> {
    const reassembled = this.displayReassembler.push(bytes);
    if (!reassembled) return;
    const packet = joinHeaderAndPayload(reassembled.header, reassembled.payload);
    const { message } = decodeDisplayMessage(packet);
    this.screenState = applyDisplayMessage(this.screenState, message);
    this.screenListeners.forEach((l) => l(this.screenState));
  }

  async writeControl(bytes: Uint8Array): Promise<void> {
    const reassembled = this.controlReassembler.push(bytes);
    if (!reassembled) return;
    const packet = joinHeaderAndPayload(reassembled.header, reassembled.payload);
    const { message } = decodeControlMessage(packet);
    this.controlState = applyControlMessage(this.controlState, message);
    this.controlListeners.forEach((l) => l(this.controlState));
  }

  /** Кнопка D1 на экране эмулятора — та же кодировка, что реальные очки отправили бы в events. */
  pressButton(kind: ButtonKindCode): void {
    this.emitRoundTrippedEvent({ type: 'BUTTON', kind });
  }

  triggerWakeword(): void {
    this.emitRoundTrippedEvent({ type: 'WAKEWORD' });
  }

  sendConfirmResult(id: number, result: boolean): void {
    this.emitRoundTrippedEvent({ type: 'CONFIRM_RESULT', id, result });
  }

  setBattery(percent: number, mv: number, charging: boolean): void {
    this.emitRoundTrippedEvent({ type: 'BATTERY', percent, mv, charging });
  }

  /** Кодирует событие в байты и тут же декодирует — проверка протокола на каждый вызов. */
  private emitRoundTrippedEvent(event: GlassesEvent): void {
    this.eventSeq = (this.eventSeq + 1) % 256;
    const bytes = encodeEvent(event, this.eventSeq);
    const decoded = decodeEvent(bytes).event;
    this.eventListeners.forEach((l) => l(decoded));
  }
}

function joinHeaderAndPayload(
  header: { ver: number; type: number; flags: number; seq: number },
  payload: Uint8Array,
): Uint8Array {
  return new ByteWriter().bytes(encodeHeader(header)).bytes(payload).toUint8Array();
}
