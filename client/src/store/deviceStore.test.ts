import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDeviceStore } from './deviceStore';

function makeFakeManager() {
  const writeCalls: unknown[] = [];
  const eventListener: { current: ((...args: unknown[]) => void) | null } = { current: null };
  const manager = {
    startDeviceScan: jest.fn(
      (_uuids: unknown, _opts: unknown, listener: (...a: unknown[]) => void) => {
        listener(null, { id: 'DEV-1', name: 'О.Ч.К.О.' });
      },
    ),
    stopDeviceScan: jest.fn(),
    connectToDevice: jest.fn(async (id: string) => ({ id, name: 'О.Ч.К.О.' })),
    discoverAllServicesAndCharacteristicsForDevice: jest.fn(async (id: string) => ({ id })),
    requestMTUForDevice: jest.fn(async (id: string) => ({ id })),
    readCharacteristicForDevice: jest.fn(async () => ({
      value: 'AQADAQ8A', // encodeInfo({protoVer:1,fwMajor:0,fwMinor:3,fwPatch:1,caps:all}) — проверено в protocol-тестах
    })),
    writeCharacteristicWithResponseForDevice: jest.fn(async (...args: unknown[]) => {
      writeCalls.push(args);
      return { value: null };
    }),
    monitorCharacteristicForDevice: jest.fn(
      (_id: string, _s: string, _c: string, listener: (...a: unknown[]) => void) => {
        eventListener.current = listener;
        return { remove: jest.fn() };
      },
    ),
    onDeviceDisconnected: jest.fn(() => ({ remove: jest.fn() })),
    cancelDeviceConnection: jest.fn(async (id: string) => ({ id })),
  };
  return { manager, writeCalls, eventListener };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useDeviceStore.setState({
    mode: 'emulator',
    bleConnection: {
      state: 'idle',
      deviceId: null,
      deviceName: null,
      info: null,
      errorMessage: null,
    },
    battery: null,
    lastDeviceId: null,
    lastDeviceName: null,
  });
});

describe('useDeviceStore: режим по умолчанию — эмулятор', () => {
  it('glassesApi пишет в эмулятор, когда mode = emulator', async () => {
    const store = useDeviceStore.getState();
    await store.glassesApi.showNavState(2);
    expect(store.emulator.getScreenState().nav.state).toBe(2);
  });

  it('события эмулятора (кнопка) доходят до glassesApi.onButton', () => {
    const store = useDeviceStore.getState();
    const received: number[] = [];
    store.glassesApi.onButton((k) => received.push(k));
    store.emulator.pressButton(1);
    expect(received).toEqual([1]);
  });
});

describe('useDeviceStore: без зарегистрированного BLE-менеджера', () => {
  it('connect бросает понятную ошибку', async () => {
    const store = useDeviceStore.getState();
    useDeviceStore.setState({ mode: 'ble' });
    await expect(store.connect('AA:BB', null)).rejects.toThrow(/не зарегистрирован/);
  });

  it('scan сообщает об ошибке через onError, не кидает исключение', () => {
    const store = useDeviceStore.getState();
    const onFound = jest.fn();
    const onError = jest.fn();
    store.scan(onFound, onError);
    expect(onFound).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/не зарегистрирован/));
  });
});

describe('useDeviceStore: с зарегистрированным BLE-менеджером', () => {
  it('registerBleManager + connect переводит mode=ble и обновляет bleConnection', async () => {
    const { manager } = makeFakeManager();
    const store = useDeviceStore.getState();
    // @ts-expect-error фейковый менеджер реализует только нужное подмножество методов
    store.registerBleManager(manager);
    useDeviceStore.setState({ mode: 'ble' });

    await store.connect('DEV-1', 'О.Ч.К.О.');

    expect(useDeviceStore.getState().bleConnection.state).toBe('connected');
    expect(useDeviceStore.getState().lastDeviceId).toBe('DEV-1');
  });

  it('после подключения glassesApi пишет через BLE и зеркалит те же байты в эмулятор для превью', async () => {
    const { manager, writeCalls } = makeFakeManager();
    const store = useDeviceStore.getState();
    // @ts-expect-error см. выше
    store.registerBleManager(manager);
    useDeviceStore.setState({ mode: 'ble' });
    await store.connect('DEV-1', null);

    await store.glassesApi.showNavState(5);

    expect(writeCalls).toHaveLength(1); // реальная передача ушла в BLE
    expect(store.emulator.getScreenState().nav.state).toBe(5); // и тут же отражена в превью
  });

  it('scan находит устройство через manager.startDeviceScan', () => {
    const { manager } = makeFakeManager();
    const store = useDeviceStore.getState();
    // @ts-expect-error см. выше
    store.registerBleManager(manager);
    const onFound = jest.fn();
    store.scan(onFound);
    expect(onFound).toHaveBeenCalledWith({ id: 'DEV-1', name: 'О.Ч.К.О.' });
  });

  it('forget отключает и забывает последнее устройство', async () => {
    const { manager } = makeFakeManager();
    const store = useDeviceStore.getState();
    // @ts-expect-error см. выше
    store.registerBleManager(manager);
    useDeviceStore.setState({ mode: 'ble' });
    await store.connect('DEV-1', null);

    await store.forget();

    expect(manager.cancelDeviceConnection).toHaveBeenCalledWith('DEV-1');
    expect(useDeviceStore.getState().lastDeviceId).toBeNull();
    expect(await AsyncStorage.getItem('ochko/lastDevice')).toBeNull();
  });
});

describe('useDeviceStore: hydrate восстанавливает режим и последнее устройство', () => {
  it('читает mode и lastDevice из AsyncStorage', async () => {
    await AsyncStorage.setItem('ochko/deviceMode', 'ble');
    await AsyncStorage.setItem('ochko/lastDevice', JSON.stringify({ id: 'DEV-9', name: 'Очки' }));

    await useDeviceStore.getState().hydrate();

    const state = useDeviceStore.getState();
    expect(state.mode).toBe('ble');
    expect(state.lastDeviceId).toBe('DEV-9');
    expect(state.lastDeviceName).toBe('Очки');
  });

  it('setMode сохраняет выбор в AsyncStorage', async () => {
    useDeviceStore.getState().setMode('ble');
    expect(useDeviceStore.getState().mode).toBe('ble');
    await Promise.resolve();
    expect(await AsyncStorage.getItem('ochko/deviceMode')).toBe('ble');
  });
});

describe('info-характеристика эмулятора декодируется сразу байт-в-байт', () => {
  it('значение из info base64 из makeFakeManager декодируется в valid GlassesInfo', async () => {
    const { manager } = makeFakeManager();
    const store = useDeviceStore.getState();
    // @ts-expect-error см. выше
    store.registerBleManager(manager);
    useDeviceStore.setState({ mode: 'ble' });
    await store.connect('DEV-1', null);
    expect(useDeviceStore.getState().bleConnection.info?.protoVer).toBe(1);
  });
});
