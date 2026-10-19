import type { BleManager, Characteristic, Subscription } from 'react-native-ble-plx';
import { BleATTErrorCode, BleErrorCode } from 'react-native-ble-plx';
import { base64Decode, base64Encode } from './protocol/bytes';
import { decodeEvent, type GlassesEvent } from './protocol/events';
import { decodeInfo, type GlassesInfo } from './protocol/info';

/** Базовый UUID сервиса О.Ч.К.О. (ТЗ §4.1): `1277XXXX-4f16-4cec-abf9-1d12f945b15b`. */
function ochkoUuid(suffix: string): string {
  return `1277${suffix}-4f16-4cec-abf9-1d12f945b15b`;
}

export const OCHKO_SERVICE_UUID = ochkoUuid('0001');
export const OCHKO_CHARACTERISTICS = {
  display: ochkoUuid('0002'),
  events: ochkoUuid('0003'),
  audio: ochkoUuid('0004'),
  control: ochkoUuid('0005'),
  info: ochkoUuid('0006'),
} as const;

export const REQUESTED_MTU = 247;

/**
 * Переводит ошибку react-native-ble-plx в понятное сообщение для пользователя.
 * attErrorCode из группы «недостаточно шифрования/аутентификации» — это именно
 * тот случай из ТЗ §0: характеристики закрыты до сопряжения, и это нормально.
 */
export function mapBleErrorToMessage(error: unknown): string {
  const e = error as {
    errorCode?: number;
    attErrorCode?: number | null;
    reason?: string | null;
    message?: string;
  } | null;
  if (!e || typeof e !== 'object') {
    return 'Неизвестная ошибка Bluetooth.';
  }
  const authErrors: number[] = [
    BleATTErrorCode.InsufficientAuthentication,
    BleATTErrorCode.InsufficientEncryption,
    BleATTErrorCode.InsufficientAuthorization,
    BleATTErrorCode.InsufficientEncryptionKeySize,
  ];
  if (e.attErrorCode != null && authErrors.includes(e.attErrorCode)) {
    return 'Очки требуют сопряжения. Введите код, который они показывают на экране.';
  }
  switch (e.errorCode) {
    case BleErrorCode.DeviceNotFound:
      return 'Не удалось найти очки. Проверьте, что они включены и рядом.';
    case BleErrorCode.OperationTimedOut:
      return 'Не удалось подключиться: истекло время ожидания.';
    case BleErrorCode.DeviceDisconnected:
      return 'Связь с очками потеряна.';
    case BleErrorCode.OperationCancelled:
      return 'Подключение отменено.';
    case BleErrorCode.BluetoothUnauthorized:
      return 'Нет разрешения на использование Bluetooth.';
    default:
      return `Ошибка Bluetooth: ${e.reason ?? e.message ?? 'неизвестная ошибка'}`;
  }
}

export function isPairingRequiredError(error: unknown): boolean {
  const e = error as { attErrorCode?: number | null } | null;
  if (!e || typeof e !== 'object' || e.attErrorCode == null) return false;
  return (
    [
      BleATTErrorCode.InsufficientAuthentication,
      BleATTErrorCode.InsufficientEncryption,
      BleATTErrorCode.InsufficientAuthorization,
      BleATTErrorCode.InsufficientEncryptionKeySize,
    ] as number[]
  ).includes(e.attErrorCode);
}

/**
 * Строго последовательная очередь записи с повтором (ТЗ §4.2): следующая запись
 * начинается только после завершения предыдущей, при ошибке — до 3 повторов.
 */
export class SequentialWriteQueue {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly writeFn: (bytes: Uint8Array) => Promise<void>,
    private readonly maxRetries = 3,
  ) {}

  enqueue(bytes: Uint8Array): Promise<void> {
    const task = this.tail.then(() => this.writeWithRetry(bytes));
    this.tail = task.catch(() => undefined);
    return task;
  }

  private async writeWithRetry(bytes: Uint8Array): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.writeFn(bytes);
        return;
      } catch (err) {
        if (attempt >= this.maxRetries) {
          throw err;
        }
      }
    }
  }
}

export type ConnectionState =
  'idle' | 'connecting' | 'connected' | 'pairing_required' | 'disconnected' | 'error';

export interface ConnectionSnapshot {
  state: ConnectionState;
  deviceId: string | null;
  deviceName: string | null;
  info: GlassesInfo | null;
  errorMessage: string | null;
}

const INITIAL_SNAPSHOT: ConnectionSnapshot = {
  state: 'idle',
  deviceId: null,
  deviceName: null,
  info: null,
  errorMessage: null,
};

/** Подмножество BleManager, которое использует это приложение — удобно для подмены в тестах. */
export type GlassesBleManager = Pick<
  BleManager,
  | 'connectToDevice'
  | 'cancelDeviceConnection'
  | 'discoverAllServicesAndCharacteristicsForDevice'
  | 'requestMTUForDevice'
  | 'readCharacteristicForDevice'
  | 'writeCharacteristicWithResponseForDevice'
  | 'monitorCharacteristicForDevice'
  | 'onDeviceDisconnected'
>;

export type ScanningBleManager = Pick<BleManager, 'startDeviceScan' | 'stopDeviceScan'>;

export interface ScannedGlasses {
  id: string;
  name: string | null;
}

/** Сканирование по UUID сервиса О.Ч.К.О. (ТЗ §0). Возвращает функцию остановки. */
export function scanForGlasses(
  manager: ScanningBleManager,
  onFound: (device: ScannedGlasses) => void,
  onError?: (message: string) => void,
): () => void {
  void manager.startDeviceScan([OCHKO_SERVICE_UUID], null, (error, device) => {
    if (error) {
      onError?.(mapBleErrorToMessage(error));
      return;
    }
    if (device) {
      onFound({ id: device.id, name: device.name });
    }
  });
  return () => {
    void manager.stopDeviceScan();
  };
}

/**
 * Высокоуровневое соединение с очками: подключение, запрос MTU, сопряжение
 * (транспарентно для нас — ОС сама покажет диалог Passkey Entry при первой
 * операции с зашифрованной характеристикой), подписка на события, очереди
 * записи display/control.
 */
export class GlassesConnection {
  private snapshot: ConnectionSnapshot = INITIAL_SNAPSHOT;
  private readonly stateListeners = new Set<(s: ConnectionSnapshot) => void>();
  private readonly eventListeners = new Set<(e: GlassesEvent) => void>();
  private readonly subscriptions: Subscription[] = [];
  private displayQueue: SequentialWriteQueue | null = null;
  private controlQueue: SequentialWriteQueue | null = null;

  constructor(
    private readonly manager: GlassesBleManager,
    private readonly requestedMtu: number = REQUESTED_MTU,
  ) {}

  getSnapshot(): ConnectionSnapshot {
    return this.snapshot;
  }

  onStateChange(listener: (s: ConnectionSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onGlassesEvent(listener: (e: GlassesEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private update(patch: Partial<ConnectionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.stateListeners.forEach((l) => l(this.snapshot));
  }

  async connect(deviceId: string, deviceName: string | null): Promise<void> {
    this.update({ state: 'connecting', deviceId, deviceName, errorMessage: null });
    try {
      await this.manager.connectToDevice(deviceId);
      await this.manager.discoverAllServicesAndCharacteristicsForDevice(deviceId);
      await this.manager.requestMTUForDevice(deviceId, this.requestedMtu);

      const infoChar = await this.manager.readCharacteristicForDevice(
        deviceId,
        OCHKO_SERVICE_UUID,
        OCHKO_CHARACTERISTICS.info,
      );
      const info = decodeInfo(base64Decode(infoChar.value ?? ''));

      this.setUpWriteQueues(deviceId);
      this.subscribeToNotifications(deviceId);

      this.update({ state: 'connected', info, errorMessage: null });
    } catch (err) {
      this.update({
        state: isPairingRequiredError(err) ? 'pairing_required' : 'error',
        errorMessage: mapBleErrorToMessage(err),
      });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    const deviceId = this.snapshot.deviceId;
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions.length = 0;
    this.displayQueue = null;
    this.controlQueue = null;
    if (deviceId) {
      await this.manager.cancelDeviceConnection(deviceId).catch(() => undefined);
    }
    this.update({ state: 'disconnected', info: null });
  }

  async writeDisplay(bytes: Uint8Array): Promise<void> {
    if (!this.displayQueue) {
      throw new Error('writeDisplay: нет соединения с очками');
    }
    return this.displayQueue.enqueue(bytes);
  }

  async writeControl(bytes: Uint8Array): Promise<void> {
    if (!this.controlQueue) {
      throw new Error('writeControl: нет соединения с очками');
    }
    return this.controlQueue.enqueue(bytes);
  }

  private setUpWriteQueues(deviceId: string): void {
    this.displayQueue = new SequentialWriteQueue((bytes) =>
      this.rawWrite(deviceId, OCHKO_CHARACTERISTICS.display, bytes),
    );
    this.controlQueue = new SequentialWriteQueue((bytes) =>
      this.rawWrite(deviceId, OCHKO_CHARACTERISTICS.control, bytes),
    );
  }

  private async rawWrite(
    deviceId: string,
    characteristicUuid: string,
    bytes: Uint8Array,
  ): Promise<void> {
    await this.manager.writeCharacteristicWithResponseForDevice(
      deviceId,
      OCHKO_SERVICE_UUID,
      characteristicUuid,
      base64Encode(bytes),
    );
  }

  private subscribeToNotifications(deviceId: string): void {
    const onEventsNotification = (_error: unknown, characteristic: Characteristic | null) => {
      if (!characteristic?.value) return;
      try {
        const { event } = decodeEvent(base64Decode(characteristic.value));
        this.eventListeners.forEach((l) => l(event));
      } catch {
        // Повреждённый/неизвестный пакет — игнорируем, не роняем соединение.
      }
    };
    this.subscriptions.push(
      this.manager.monitorCharacteristicForDevice(
        deviceId,
        OCHKO_SERVICE_UUID,
        OCHKO_CHARACTERISTICS.events,
        onEventsNotification,
      ),
    );
    this.subscriptions.push(
      this.manager.onDeviceDisconnected(deviceId, () => {
        this.update({ state: 'disconnected' });
      }),
    );
  }
}
