import { decodeControlMessage } from '@/ble/protocol/control';
import { NotifyApp, decodeDisplayMessage } from '@/ble/protocol/display';
import type { GlassesEvent } from '@/ble/protocol/events';
import { GlassesApi, type GlassesTransport } from '@/glasses/api';

function makeFakeTransport() {
  const display: Uint8Array[] = [];
  const control: Uint8Array[] = [];
  const eventListeners = new Set<(e: GlassesEvent) => void>();
  const transport: GlassesTransport = {
    writeDisplay: jest.fn(async (bytes: Uint8Array) => {
      display.push(bytes);
    }),
    writeControl: jest.fn(async (bytes: Uint8Array) => {
      control.push(bytes);
    }),
    onGlassesEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
  const emit = (e: GlassesEvent) => eventListeners.forEach((l) => l(e));
  return { transport, display, control, emit };
}

describe('GlassesApi: отправка display-сообщений', () => {
  it('showManeuver кодирует NAV_MANEUVER и уходит через writeDisplay', async () => {
    const { transport, display } = makeFakeTransport();
    const api = new GlassesApi(transport);
    await api.showManeuver({
      icon: 7,
      exitNo: 0,
      distM: 150,
      totalM: 1200,
      etaMin: 18,
      street: 'ул. Ленина',
    });

    expect(display).toHaveLength(1);
    const { message } = decodeDisplayMessage(display[0]!);
    expect(message).toEqual({
      type: 'NAV_MANEUVER',
      icon: 7,
      exitNo: 0,
      distM: 150,
      totalM: 1200,
      etaMin: 18,
      street: 'ул. Ленина',
    });
  });

  it('showProgress кодирует NAV_PROGRESS', async () => {
    const { transport, display } = makeFakeTransport();
    const api = new GlassesApi(transport);
    await api.showProgress(140, 1190, 18);
    expect(decodeDisplayMessage(display[0]!).message).toEqual({
      type: 'NAV_PROGRESS',
      distM: 140,
      totalM: 1190,
      etaMin: 18,
    });
  });

  it('showNavState, showText, showConfirm, clear, showNotify, showAgentState — каждое кодируется в свой тип', async () => {
    const { transport, display } = makeFakeTransport();
    const api = new GlassesApi(transport);

    await api.showNavState(2);
    await api.showText(10, 'Готово');
    await api.showConfirm(1, 5, 'Позвонить Маме?');
    await api.clear(0);
    await api.showNotify({ app: NotifyApp.SMS, prio: 1, ttlS: 0, title: 'SMS', body: 'код 1234' });
    await api.showAgentState(2);

    expect(decodeDisplayMessage(display[0]!).message).toEqual({ type: 'NAV_STATE', state: 2 });
    expect(decodeDisplayMessage(display[1]!).message).toEqual({
      type: 'AGENT_TEXT',
      ttlS: 10,
      text: 'Готово',
    });
    expect(decodeDisplayMessage(display[2]!).message).toEqual({
      type: 'CONFIRM',
      id: 1,
      timeoutS: 5,
      text: 'Позвонить Маме?',
    });
    expect(decodeDisplayMessage(display[3]!).message).toEqual({ type: 'CLEAR', layer: 0 });
    expect(decodeDisplayMessage(display[4]!).message).toEqual({
      type: 'NOTIFY',
      app: NotifyApp.SMS,
      prio: 1,
      ttlS: 0,
      title: 'SMS',
      body: 'код 1234',
    });
    expect(decodeDisplayMessage(display[5]!).message).toEqual({ type: 'AGENT_STATE', state: 2 });
  });

  it('seq инкрементируется на каждое сообщение, по кругу через 256', async () => {
    const { transport, display } = makeFakeTransport();
    const api = new GlassesApi(transport);
    for (let i = 0; i < 258; i += 1) {
      await api.showNavState(1);
    }
    expect(decodeDisplayMessage(display[0]!).seq).toBe(0);
    expect(decodeDisplayMessage(display[255]!).seq).toBe(255);
    expect(decodeDisplayMessage(display[256]!).seq).toBe(0);
    expect(decodeDisplayMessage(display[257]!).seq).toBe(1);
  });

  it('display и control — независимые счётчики seq', async () => {
    const { transport, display, control } = makeFakeTransport();
    const api = new GlassesApi(transport);
    await api.showNavState(1);
    await api.showNavState(1);
    await api.setBrightness(100);

    expect(decodeDisplayMessage(display[0]!).seq).toBe(0);
    expect(decodeDisplayMessage(display[1]!).seq).toBe(1);
    expect(decodeControlMessage(control[0]!).seq).toBe(0);
  });
});

describe('GlassesApi: control-сообщения', () => {
  it('setTime/setBrightness/setAudioCtrl/setConnParams кодируются корректно', async () => {
    const { transport, control } = makeFakeTransport();
    const api = new GlassesApi(transport);

    await api.setTime(1792000000, 300);
    await api.setBrightness(180);
    await api.setAudioCtrl(1);
    await api.setConnParams(1);

    expect(decodeControlMessage(control[0]!).message).toEqual({
      type: 'SET_TIME',
      unix: 1792000000,
      tzMin: 300,
    });
    expect(decodeControlMessage(control[1]!).message).toEqual({ type: 'BRIGHTNESS', level: 180 });
    expect(decodeControlMessage(control[2]!).message).toEqual({ type: 'AUDIO_CTRL', cmd: 1 });
    expect(decodeControlMessage(control[3]!).message).toEqual({ type: 'CONN_PARAMS', mode: 1 });
  });
});

describe('GlassesApi: события от очков', () => {
  it('onButton получает только BUTTON-события', () => {
    const { transport, emit } = makeFakeTransport();
    const api = new GlassesApi(transport);
    const received: number[] = [];
    api.onButton((kind) => received.push(kind));

    emit({ type: 'BUTTON', kind: 1 });
    emit({ type: 'WAKEWORD' });
    emit({ type: 'BUTTON', kind: 2 });

    expect(received).toEqual([1, 2]);
  });

  it('onWakeword, onConfirmResult, onBattery, onGlassesError фильтруют по типу', () => {
    const { transport, emit } = makeFakeTransport();
    const api = new GlassesApi(transport);

    const wakeword = jest.fn();
    const confirm = jest.fn();
    const battery = jest.fn();
    const error = jest.fn();
    api.onWakeword(wakeword);
    api.onConfirmResult(confirm);
    api.onBattery(battery);
    api.onGlassesError(error);

    emit({ type: 'WAKEWORD' });
    emit({ type: 'CONFIRM_RESULT', id: 1, result: true });
    emit({ type: 'BATTERY', percent: 80, mv: 4000, charging: false });
    emit({ type: 'ERROR', code: 2, text: 'oops' });

    expect(wakeword).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(1, true);
    expect(battery).toHaveBeenCalledWith(80, 4000, false);
    expect(error).toHaveBeenCalledWith(2, 'oops');
  });

  it('отписка через возвращённую функцию прекращает доставку событий', () => {
    const { transport, emit } = makeFakeTransport();
    const api = new GlassesApi(transport);
    const received: number[] = [];
    const unsubscribe = api.onButton((kind) => received.push(kind));

    emit({ type: 'BUTTON', kind: 1 });
    unsubscribe();
    emit({ type: 'BUTTON', kind: 2 });

    expect(received).toEqual([1]);
  });
});
