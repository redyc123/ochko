import { base64Decode, base64Encode } from '@/ble/protocol/bytes';
import { encodeEvent } from '@/ble/protocol/events';
import { encodeInfo } from '@/ble/protocol/info';
import {
  GlassesConnection,
  type GlassesBleManager,
  OCHKO_CHARACTERISTICS,
  OCHKO_SERVICE_UUID,
  REQUESTED_MTU,
  SequentialWriteQueue,
  isPairingRequiredError,
  mapBleErrorToMessage,
  scanForGlasses,
} from '@/ble/connection';

describe('UUID О.Ч.К.О.', () => {
  it('строятся по шаблону из ТЗ §4.1', () => {
    expect(OCHKO_SERVICE_UUID).toBe('12770001-4f16-4cec-abf9-1d12f945b15b');
    expect(OCHKO_CHARACTERISTICS.display).toBe('12770002-4f16-4cec-abf9-1d12f945b15b');
    expect(OCHKO_CHARACTERISTICS.events).toBe('12770003-4f16-4cec-abf9-1d12f945b15b');
    expect(OCHKO_CHARACTERISTICS.audio).toBe('12770004-4f16-4cec-abf9-1d12f945b15b');
    expect(OCHKO_CHARACTERISTICS.control).toBe('12770005-4f16-4cec-abf9-1d12f945b15b');
    expect(OCHKO_CHARACTERISTICS.info).toBe('12770006-4f16-4cec-abf9-1d12f945b15b');
  });
});

describe('mapBleErrorToMessage / isPairingRequiredError', () => {
  it('ошибка недостаточного шифрования трактуется как «нужно сопряжение»', () => {
    const error = { attErrorCode: 15, errorCode: 2 }; // InsufficientEncryption
    expect(isPairingRequiredError(error)).toBe(true);
    expect(mapBleErrorToMessage(error)).toMatch(/сопряж/i);
  });

  it('устройство не найдено — понятное сообщение, не про сопряжение', () => {
    const error = { errorCode: 204, attErrorCode: null };
    expect(isPairingRequiredError(error)).toBe(false);
    expect(mapBleErrorToMessage(error)).toMatch(/не удалось найти/i);
  });

  it('разрыв соединения и таймаут распознаются отдельно', () => {
    expect(mapBleErrorToMessage({ errorCode: 201 })).toMatch(/потеряна/i);
    expect(mapBleErrorToMessage({ errorCode: 3 })).toMatch(/истекло время/i);
  });

  it('неизвестная ошибка — общее сообщение с причиной', () => {
    expect(mapBleErrorToMessage({ errorCode: 999, reason: 'что-то странное' })).toContain(
      'что-то странное',
    );
  });

  it('не-объект/null не ломает функцию', () => {
    expect(() => mapBleErrorToMessage(null)).not.toThrow();
    expect(isPairingRequiredError(undefined)).toBe(false);
  });
});

describe('SequentialWriteQueue', () => {
  it('выполняет записи строго по очереди, не параллельно', async () => {
    const order: string[] = [];
    const writeFn = jest.fn(async (bytes: Uint8Array) => {
      const label = `write-${bytes[0]}`;
      order.push(`start:${label}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end:${label}`);
    });
    const queue = new SequentialWriteQueue(writeFn);
    await Promise.all([queue.enqueue(new Uint8Array([1])), queue.enqueue(new Uint8Array([2]))]);
    expect(order).toEqual(['start:write-1', 'end:write-1', 'start:write-2', 'end:write-2']);
  });

  it('повторяет запись при ошибке и успевает за 3 попытки', async () => {
    let calls = 0;
    const writeFn = jest.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('ble write failed');
    });
    const queue = new SequentialWriteQueue(writeFn, 3);
    await expect(queue.enqueue(new Uint8Array([1]))).resolves.toBeUndefined();
    expect(writeFn).toHaveBeenCalledTimes(3);
  });

  it('бросает ошибку после превышения maxRetries', async () => {
    const writeFn = jest.fn(async () => {
      throw new Error('ble write failed');
    });
    const queue = new SequentialWriteQueue(writeFn, 2);
    await expect(queue.enqueue(new Uint8Array([1]))).rejects.toThrow('ble write failed');
    expect(writeFn).toHaveBeenCalledTimes(3); // 1 попытка + 2 повтора
  });

  it('ошибка одной записи не блокирует следующую в очереди', async () => {
    const writeFn = jest.fn(async (bytes: Uint8Array) => {
      if (bytes[0] === 1) throw new Error('fail forever');
    });
    const queue = new SequentialWriteQueue(writeFn, 0);
    await expect(queue.enqueue(new Uint8Array([1]))).rejects.toThrow();
    await expect(queue.enqueue(new Uint8Array([2]))).resolves.toBeUndefined();
  });
});

describe('scanForGlasses', () => {
  it('сканирует по UUID сервиса и сообщает о найденных устройствах', () => {
    const manager = { startDeviceScan: jest.fn(), stopDeviceScan: jest.fn() };
    const onFound = jest.fn();
    const stop = scanForGlasses(manager, onFound);

    expect(manager.startDeviceScan).toHaveBeenCalledWith(
      [OCHKO_SERVICE_UUID],
      null,
      expect.any(Function),
    );
    const listener = manager.startDeviceScan.mock.calls[0]![2] as (e: unknown, d: unknown) => void;
    listener(null, { id: 'AA:BB', name: 'О.Ч.К.О.' });
    expect(onFound).toHaveBeenCalledWith({ id: 'AA:BB', name: 'О.Ч.К.О.' });

    stop();
    expect(manager.stopDeviceScan).toHaveBeenCalled();
  });

  it('ошибка сканирования идёт в onError, а не в onFound', () => {
    const manager = { startDeviceScan: jest.fn(), stopDeviceScan: jest.fn() };
    const onFound = jest.fn();
    const onError = jest.fn();
    scanForGlasses(manager, onFound, onError);
    const listener = manager.startDeviceScan.mock.calls[0]![2] as (e: unknown, d: unknown) => void;
    listener({ errorCode: 999 }, null);
    expect(onFound).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });
});

function makeFakeManager() {
  const listeners: Record<string, ((...args: unknown[]) => void) | undefined> = {};
  const manager = {
    connectToDevice: jest.fn(async (id: string) => ({ id, name: 'О.Ч.К.О.' })),
    discoverAllServicesAndCharacteristicsForDevice: jest.fn(async (id: string) => ({ id })),
    requestMTUForDevice: jest.fn(async (id: string, mtu: number) => ({ id, mtu })),
    readCharacteristicForDevice: jest.fn(async () => ({
      value: base64Encode(
        encodeInfo({
          protoVer: 1,
          fwMajor: 0,
          fwMinor: 3,
          fwPatch: 1,
          caps: { audio: true, wakeword: true, navIcons: true, cyrillic: true },
        }),
      ),
    })),
    writeCharacteristicWithResponseForDevice: jest.fn(async () => ({ value: null })),
    monitorCharacteristicForDevice: jest.fn(
      (_id: string, _svc: string, _char: string, listener: (...a: unknown[]) => void) => {
        listeners.events = listener;
        return { remove: jest.fn() };
      },
    ),
    onDeviceDisconnected: jest.fn((_id: string, listener: (...a: unknown[]) => void) => {
      listeners.disconnected = listener;
      return { remove: jest.fn() };
    }),
    cancelDeviceConnection: jest.fn(async (id: string) => ({ id })),
  };
  return { manager, listeners };
}

describe('GlassesConnection', () => {
  it('успешное подключение: вызывает шаги по порядку, запрашивает MTU 247, декодирует info', async () => {
    const { manager } = makeFakeManager();
    const conn = new GlassesConnection(manager as unknown as GlassesBleManager);
    await conn.connect('AA:BB', 'О.Ч.К.О.');

    expect(manager.connectToDevice).toHaveBeenCalledWith('AA:BB');
    expect(manager.requestMTUForDevice).toHaveBeenCalledWith('AA:BB', REQUESTED_MTU);

    const snapshot = conn.getSnapshot();
    expect(snapshot.state).toBe('connected');
    expect(snapshot.info?.protoVer).toBe(1);
    expect(snapshot.info?.caps.cyrillic).toBe(true);
  });

  it('ошибка недостаточного шифрования при чтении info -> pairing_required', async () => {
    const { manager } = makeFakeManager();
    manager.readCharacteristicForDevice.mockRejectedValueOnce({ attErrorCode: 5, errorCode: 2 });
    const conn = new GlassesConnection(manager as unknown as GlassesBleManager);

    await expect(conn.connect('AA:BB', null)).rejects.toBeTruthy();
    expect(conn.getSnapshot().state).toBe('pairing_required');
    expect(conn.getSnapshot().errorMessage).toMatch(/сопряж/i);
  });

  it('writeDisplay до подключения бросает ошибку', async () => {
    const { manager } = makeFakeManager();
    const conn = new GlassesConnection(manager as unknown as GlassesBleManager);
    await expect(conn.writeDisplay(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });

  it('writeDisplay после подключения пишет в характеристику display в base64', async () => {
    const { manager } = makeFakeManager();
    const conn = new GlassesConnection(manager as unknown as GlassesBleManager);
    await conn.connect('AA:BB', null);

    const bytes = new Uint8Array([1, 2, 3, 4]);
    await conn.writeDisplay(bytes);

    expect(manager.writeCharacteristicWithResponseForDevice).toHaveBeenCalledWith(
      'AA:BB',
      OCHKO_SERVICE_UUID,
      OCHKO_CHARACTERISTICS.display,
      base64Encode(bytes),
    );
  });

  it('уведомление в events декодируется и доходит до onGlassesEvent', async () => {
    const { manager, listeners } = makeFakeManager();
    const conn = new GlassesConnection(manager as unknown as GlassesBleManager);
    await conn.connect('AA:BB', null);

    const received: unknown[] = [];
    conn.onGlassesEvent((e) => received.push(e));

    const packet = encodeEvent({ type: 'BATTERY', percent: 77, mv: 3950, charging: true }, 1);
    listeners.events?.(null, { value: base64Encode(packet) });

    expect(received).toEqual([{ type: 'BATTERY', percent: 77, mv: 3950, charging: true }]);
  });

  it('disconnect отменяет подписки и переводит состояние в disconnected', async () => {
    const { manager } = makeFakeManager();
    const conn = new GlassesConnection(manager as unknown as GlassesBleManager);
    await conn.connect('AA:BB', null);
    await conn.disconnect();

    expect(manager.cancelDeviceConnection).toHaveBeenCalledWith('AA:BB');
    expect(conn.getSnapshot().state).toBe('disconnected');
  });

  it('внешний разрыв соединения (onDeviceDisconnected) переводит состояние в disconnected', async () => {
    const { manager, listeners } = makeFakeManager();
    const conn = new GlassesConnection(manager as unknown as GlassesBleManager);
    await conn.connect('AA:BB', null);

    listeners.disconnected?.(null, { id: 'AA:BB' });

    expect(conn.getSnapshot().state).toBe('disconnected');
  });

  it('base64Decode(base64Encode(...)) не теряет байты (связка с info-характеристикой)', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
  });
});
