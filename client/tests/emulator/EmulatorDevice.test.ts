import { encodeControlMessage } from '@/ble/protocol/control';
import { encodeDisplayMessage } from '@/ble/protocol/display';
import { fragmentPacket } from '@/ble/protocol/fragment';
import { GlassesApi } from '@/glasses/api';
import { EmulatorDevice } from '@/emulator/EmulatorDevice';

describe('EmulatorDevice: writeDisplay декодирует те же байты и обновляет экран', () => {
  it('через GlassesApi.showManeuver экран получает манёвр', async () => {
    const device = new EmulatorDevice();
    const api = new GlassesApi(device);
    await api.showManeuver({
      icon: 7,
      exitNo: 0,
      distM: 100,
      totalM: 500,
      etaMin: 5,
      street: 'ул. Ленина',
    });

    expect(device.getScreenState().nav.maneuver).toEqual({
      icon: 7,
      exitNo: 0,
      distM: 100,
      totalM: 500,
      etaMin: 5,
      street: 'ул. Ленина',
    });
  });

  it('уведомляет подписчиков onScreenChange при каждом изменении', async () => {
    const device = new EmulatorDevice();
    const api = new GlassesApi(device);
    const seen: number[] = [];
    device.onScreenChange((s) => seen.push(s.nav.state));

    await api.showNavState(1);
    await api.showNavState(2);

    expect(seen).toEqual([1, 2]);
  });

  it('собирает фрагментированный пакет перед тем, как обновить экран', async () => {
    const device = new EmulatorDevice();
    const packet = encodeDisplayMessage(
      {
        type: 'AGENT_TEXT',
        ttlS: 10,
        text: 'Длинный текст ответа агента, который не влезет в один маленький кусок',
      },
      1,
    );
    const fragments = fragmentPacket(packet, 20);
    expect(fragments.length).toBeGreaterThan(1);

    for (let i = 0; i < fragments.length - 1; i += 1) {
      await device.writeDisplay(fragments[i]!);
      expect(device.getScreenState().agent.text).toBeNull(); // пакет ещё не собран целиком
    }
    await device.writeDisplay(fragments[fragments.length - 1]!);
    expect(device.getScreenState().agent.text).toContain('Длинный текст ответа агента');
  });
});

describe('EmulatorDevice: writeControl', () => {
  it('обновляет яркость, запись аудио и режим соединения', async () => {
    const device = new EmulatorDevice();
    await device.writeControl(encodeControlMessage({ type: 'BRIGHTNESS', level: 42 }, 1));
    await device.writeControl(encodeControlMessage({ type: 'AUDIO_CTRL', cmd: 1 }, 2));
    await device.writeControl(encodeControlMessage({ type: 'CONN_PARAMS', mode: 1 }, 3));
    await device.writeControl(
      encodeControlMessage({ type: 'SET_TIME', unix: 1792000000, tzMin: 180 }, 4),
    );

    expect(device.getControlState()).toEqual({
      brightness: 42,
      audioRecording: true,
      connFast: true,
      lastSetTimeUnix: 1792000000,
    });
  });
});

describe('EmulatorDevice: события от кнопки/батареи — тот же протокол, что и у реальных очков', () => {
  it('pressButton доходит до onGlassesEvent декодированным обратно', () => {
    const device = new EmulatorDevice();
    const received: unknown[] = [];
    device.onGlassesEvent((e) => received.push(e));

    device.pressButton(1);
    device.pressButton(2);

    expect(received).toEqual([
      { type: 'BUTTON', kind: 1 },
      { type: 'BUTTON', kind: 2 },
    ]);
  });

  it('triggerWakeword, sendConfirmResult, setBattery доходят до подписчиков', () => {
    const device = new EmulatorDevice();
    const received: unknown[] = [];
    device.onGlassesEvent((e) => received.push(e));

    device.triggerWakeword();
    device.sendConfirmResult(1, true);
    device.setBattery(55, 3800, true);

    expect(received).toEqual([
      { type: 'WAKEWORD' },
      { type: 'CONFIRM_RESULT', id: 1, result: true },
      { type: 'BATTERY', percent: 55, mv: 3800, charging: true },
    ]);
  });

  it('через GlassesApi.onButton тоже работает (полный цикл GlassesApi <-> эмулятор)', () => {
    const device = new EmulatorDevice();
    const api = new GlassesApi(device);
    const kinds: number[] = [];
    api.onButton((k) => kinds.push(k));

    device.pressButton(1);
    device.pressButton(4);

    expect(kinds).toEqual([1, 4]);
  });
});
