import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  GlassesConnection,
  scanForGlasses,
  type ConnectionSnapshot,
  type GlassesBleManager,
  type ScannedGlasses,
  type ScanningBleManager,
} from '../ble/connection';
import { EmulatorDevice } from '../emulator/EmulatorDevice';
import { GlassesApi, type GlassesTransport } from '../glasses/api';
import { FrameCompositor } from '../glasses/frameCompositor';

export type DeviceMode = 'emulator' | 'ble';

export interface BatteryState {
  percent: number;
  mv: number;
  charging: boolean;
}

const STORAGE_KEY_MODE = 'ochko/deviceMode';
const STORAGE_KEY_LAST_DEVICE = 'ochko/lastDevice';

const INITIAL_BLE_SNAPSHOT: ConnectionSnapshot = {
  state: 'idle',
  deviceId: null,
  deviceName: null,
  info: null,
  errorMessage: null,
};

/**
 * Единая точка входа для GlassesApi: сама решает, писать ли в эмулятор или в
 * реальное BLE-соединение, в зависимости от текущего режима в сторе.
 * События (кнопка, батарея…) фильтруются по тому же режиму, чтобы эмулятор
 * не «подсказывал» события в сессию с реальными очками и наоборот.
 */
export class DelegatingTransport implements GlassesTransport {
  private bleConnection: GlassesConnection | null = null;
  /** Реальные очки (прошивка v2) рисуют только готовые кадры — их собирает компоновщик. */
  readonly compositor = new FrameCompositor((bytes) => {
    if (!this.bleConnection) return Promise.reject(new Error('нет соединения с очками'));
    return this.bleConnection.writeDisplay(bytes);
  });
  private readonly eventListeners = new Set<Parameters<GlassesTransport['onGlassesEvent']>[0]>();

  constructor(
    private readonly emulator: EmulatorDevice,
    private readonly getMode: () => DeviceMode,
  ) {
    emulator.onGlassesEvent((event) => {
      if (this.getMode() === 'emulator') {
        this.eventListeners.forEach((l) => l(event));
      }
    });
  }

  attachBleConnection(connection: GlassesConnection): void {
    this.bleConnection = connection;
    connection.onGlassesEvent((event) => {
      if (this.getMode() === 'ble') {
        this.eventListeners.forEach((l) => l(event));
      }
    });
  }

  private active(): GlassesTransport {
    if (this.getMode() === 'ble' && this.bleConnection) {
      return this.bleConnection;
    }
    return this.emulator;
  }

  writeDisplay(bytes: Uint8Array): Promise<void> {
    const active = this.active();
    if (active !== this.emulator) {
      // Зеркалим те же байты в эмулятор для превью «тот же рендер, что в
      // эмуляторе» (ТЗ §1.6), даже когда реально пишем в настоящие очки.
      void this.emulator.writeDisplay(bytes);
      return this.compositor.handleDisplayPacket(bytes);
    }
    return active.writeDisplay(bytes);
  }

  writeControl(bytes: Uint8Array): Promise<void> {
    const active = this.active();
    if (active !== this.emulator) {
      void this.emulator.writeControl(bytes);
    }
    return active.writeControl(bytes);
  }

  onGlassesEvent(listener: Parameters<GlassesTransport['onGlassesEvent']>[0]): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
}

export interface DeviceStoreState {
  mode: DeviceMode;
  bleConnection: ConnectionSnapshot;
  battery: BatteryState | null;
  lastDeviceId: string | null;
  lastDeviceName: string | null;

  readonly emulator: EmulatorDevice;
  readonly glassesApi: GlassesApi;

  hydrate: () => Promise<void>;
  setMode: (mode: DeviceMode) => void;
  registerBleManager: (manager: GlassesBleManager & ScanningBleManager) => void;
  scan: (onFound: (d: ScannedGlasses) => void, onError?: (message: string) => void) => () => void;
  connect: (deviceId: string, name: string | null) => Promise<void>;
  disconnect: () => Promise<void>;
  forget: () => Promise<void>;
}

export const useDeviceStore = create<DeviceStoreState>((set, get) => {
  const emulator = new EmulatorDevice();
  let scanningManager: ScanningBleManager | null = null;
  let connection: GlassesConnection | null = null;

  const transport = new DelegatingTransport(emulator, () => get().mode);
  const glassesApi = new GlassesApi(transport);
  glassesApi.onBattery((percent, mv, charging) => set({ battery: { percent, mv, charging } }));

  return {
    mode: 'emulator',
    bleConnection: INITIAL_BLE_SNAPSHOT,
    battery: null,
    lastDeviceId: null,
    lastDeviceName: null,
    emulator,
    glassesApi,

    hydrate: async () => {
      const [mode, lastDeviceJson] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_MODE),
        AsyncStorage.getItem(STORAGE_KEY_LAST_DEVICE),
      ]);
      const patch: Partial<DeviceStoreState> = {};
      if (mode === 'ble' || mode === 'emulator') {
        patch.mode = mode;
      }
      if (lastDeviceJson) {
        try {
          const parsed = JSON.parse(lastDeviceJson) as { id: string; name: string | null };
          patch.lastDeviceId = parsed.id;
          patch.lastDeviceName = parsed.name;
        } catch {
          // повреждённая запись — игнорируем, не ломаем запуск приложения
        }
      }
      set(patch);
    },

    setMode: (mode) => {
      set({ mode });
      void AsyncStorage.setItem(STORAGE_KEY_MODE, mode);
    },

    registerBleManager: (manager) => {
      scanningManager = manager;
      connection = new GlassesConnection(manager);
      connection.onStateChange((snapshot) => {
        set({ bleConnection: snapshot });
        if (snapshot.state === 'connected') transport.compositor.start();
        else transport.compositor.stop();
      });
      transport.attachBleConnection(connection);
    },

    scan: (onFound, onError) => {
      if (!scanningManager) {
        onError?.('BLE-менеджер не зарегистрирован — нечем сканировать.');
        return () => {};
      }
      return scanForGlasses(scanningManager, onFound, onError);
    },

    connect: async (deviceId, name) => {
      if (!connection) {
        throw new Error('BLE-менеджер не зарегистрирован — невозможно подключиться.');
      }
      await connection.connect(deviceId, name);
      set({ lastDeviceId: deviceId, lastDeviceName: name });
      await AsyncStorage.setItem(STORAGE_KEY_LAST_DEVICE, JSON.stringify({ id: deviceId, name }));
    },

    disconnect: async () => {
      await connection?.disconnect();
    },

    forget: async () => {
      await connection?.disconnect();
      set({ lastDeviceId: null, lastDeviceName: null });
      await AsyncStorage.removeItem(STORAGE_KEY_LAST_DEVICE);
    },
  };
});
