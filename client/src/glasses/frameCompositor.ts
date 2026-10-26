import { ByteWriter } from '../ble/protocol/bytes';
import { decodeDisplayMessage } from '../ble/protocol/display';
import { PacketReassembler } from '../ble/protocol/fragment';
import { SCREEN_PAGES, SCREEN_WIDTH, encodeFrame } from '../ble/protocol/frame';
import { encodeHeader } from '../ble/protocol/header';
import {
  applyDisplayMessage,
  createInitialScreenState,
  selectActiveContent,
  type ActiveContent,
  type EmulatorScreenState,
} from '../emulator/screenState';
import { renderScreen } from './screenRender';

/** Как часто перерисовывать часы: кадр уходит, только если картинка изменилась. */
export const CLOCK_TICK_MS = 5_000;

/**
 * Прошивка v2 понимает только FRAME (okko/docs/PROTOCOL.md §3), а GlassesApi
 * по-прежнему шлёт смысловые пакеты v1. Компоновщик принимает эти пакеты,
 * ведёт то же состояние экрана, что и эмулятор, сам рисует кадр 72×40 и
 * отправляет его в очки. Пока показывать нечего — на экране часы.
 */
export class FrameCompositor {
  private state: EmulatorScreenState = createInitialScreenState();
  private readonly reassembler = new PacketReassembler();
  private seq = -1;
  private lastSent: Uint8Array | null = null;
  private sending = false;
  private pending = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  /** До какого момента (Date.getTime) на экране уведомление; 0 — его нет. */
  private notifyUntil = 0;

  constructor(
    private readonly writeFrame: (bytes: Uint8Array) => Promise<void>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Принимает закодированный пакет display v1 (возможно, фрагмент). */
  handleDisplayPacket(bytes: Uint8Array): Promise<void> {
    const reassembled = this.reassembler.push(bytes);
    if (!reassembled) return Promise.resolve();
    const packet = new ByteWriter()
      .bytes(encodeHeader(reassembled.header))
      .bytes(reassembled.payload)
      .toUint8Array();
    const { message } = decodeDisplayMessage(packet);
    if (message.type === 'NOTIFY') {
      // Уведомления только поверх часов: при маршруте, подсказке или агенте — молча пропускаем
      if (this.baseContent().kind !== 'idle') return Promise.resolve();
      this.showNotifyFor(message.ttlS * 1000);
    }
    this.state = applyDisplayMessage(this.state, message);
    if (message.type === 'NAV_MANEUVER') {
      // Расстояние из прошлого NAV_PROGRESS относится к предыдущему манёвру
      this.state = { ...this.state, nav: { ...this.state.nav, progress: null } };
    }
    return this.refresh();
  }

  /** Перерисовывает экран; кадр уходит, только если он отличается от отправленного. */
  async refresh(): Promise<void> {
    if (this.sending) {
      this.pending = true;
      return;
    }
    this.sending = true;
    try {
      do {
        this.pending = false;
        const frame = renderScreen(this.activeContent(), this.state.nav, this.now()).data;
        if (this.lastSent && sameBytes(this.lastSent, frame)) continue;
        this.seq = (this.seq + 1) % 256;
        await this.writeFrame(
          encodeFrame({ x: 0, page: 0, w: SCREEN_WIDTH, hPages: SCREEN_PAGES }, frame, this.seq),
        );
        this.lastSent = frame;
      } while (this.pending);
    } finally {
      this.sending = false;
    }
  }

  /** Что на экране без учёта уведомления. */
  private baseContent(): ActiveContent {
    return selectActiveContent({ ...this.state, notify: null });
  }

  private activeContent(): ActiveContent {
    const base = this.baseContent();
    if (base.kind === 'idle' && this.state.notify && this.now().getTime() < this.notifyUntil) {
      return { kind: 'notify', notify: this.state.notify };
    }
    return base;
  }

  private showNotifyFor(ms: number): void {
    this.notifyUntil = this.now().getTime() + ms;
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.state = { ...this.state, notify: null };
      this.refresh().catch(() => undefined);
    }, ms);
  }

  /** Новое соединение: экран очков неизвестен, следующий кадр уйдёт обязательно. */
  start(): void {
    this.lastSent = null;
    this.stop();
    this.timer = setInterval(() => {
      this.refresh().catch(() => undefined);
    }, CLOCK_TICK_MS);
    this.refresh().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
    this.notifyUntil = 0;
    this.state = { ...this.state, notify: null };
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
