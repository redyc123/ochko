import React, { useEffect, useState } from 'react';
import { AppState, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { NotificationListener } from '../../modules/notification-listener';
import { EmulatorScreen } from '../emulator/EmulatorScreen';
import { useDeviceStore } from '../store/deviceStore';
import type { ScannedGlasses } from '../ble/connection';

const CONNECTION_STATE_LABELS: Record<string, string> = {
  idle: 'Не подключено',
  connecting: 'Подключаюсь…',
  connected: 'Подключено',
  pairing_required: 'Нужно сопряжение',
  disconnected: 'Отключено',
  error: 'Ошибка',
};

/** Android: доступ к уведомлениям выдаётся только в системных настройках. */
function NotificationAccessRow(): React.JSX.Element | null {
  const [granted, setGranted] = useState(() => NotificationListener?.isPermissionGranted() ?? true);

  useEffect(() => {
    // Пользователь возвращается из настроек — перепроверяем
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setGranted(NotificationListener?.isPermissionGranted() ?? true);
    });
    return () => sub.remove();
  }, []);

  if (!NotificationListener || granted) return null;
  return (
    <Pressable style={styles.button} onPress={() => NotificationListener?.openPermissionSettings()}>
      <Text style={styles.buttonText}>Разрешить доступ к уведомлениям</Text>
    </Pressable>
  );
}

export function DeviceScreen(): React.JSX.Element {
  const mode = useDeviceStore((s) => s.mode);
  const bleConnection = useDeviceStore((s) => s.bleConnection);
  const battery = useDeviceStore((s) => s.battery);
  const emulator = useDeviceStore((s) => s.emulator);
  const setMode = useDeviceStore((s) => s.setMode);
  const scan = useDeviceStore((s) => s.scan);
  const connect = useDeviceStore((s) => s.connect);
  const disconnect = useDeviceStore((s) => s.disconnect);
  const forget = useDeviceStore((s) => s.forget);

  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<ScannedGlasses[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    useDeviceStore.getState().hydrate();
  }, []);

  const info = mode === 'emulator' ? emulator.info : bleConnection.info;

  const handleScan = () => {
    setFound([]);
    setScanError(null);
    setScanning(true);
    const stop = scan(
      (device) =>
        setFound((prev) => (prev.some((d) => d.id === device.id) ? prev : [...prev, device])),
      (message) => setScanError(message),
    );
    setTimeout(() => {
      stop();
      setScanning(false);
    }, 10_000);
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.label}>Режим эмулятора</Text>
        <Switch
          value={mode === 'emulator'}
          onValueChange={(v) => setMode(v ? 'emulator' : 'ble')}
        />
      </View>

      <NotificationAccessRow />

      {info && (
        <Text style={styles.info}>
          Протокол v{info.protoVer} · прошивка {info.fwMajor}.{info.fwMinor}.{info.fwPatch}
        </Text>
      )}
      {battery && (
        <Text style={styles.info}>
          Заряд: {battery.percent}% ({battery.mv} мВ){battery.charging ? ' ⚡' : ''}
        </Text>
      )}

      {mode === 'emulator' ? (
        <View style={styles.emulatorBlock}>
          <EmulatorScreen device={emulator} />
          <Pressable style={styles.button} onPress={() => emulator.setBattery(80, 4000, false)}>
            <Text style={styles.buttonText}>Имитировать заряд 80%</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.bleBlock}>
          <Text style={styles.status}>
            {CONNECTION_STATE_LABELS[bleConnection.state] ?? bleConnection.state}
          </Text>
          {bleConnection.errorMessage && (
            <Text style={styles.error}>{bleConnection.errorMessage}</Text>
          )}

          <Pressable style={styles.button} onPress={handleScan} disabled={scanning}>
            <Text style={styles.buttonText}>{scanning ? 'Сканирую…' : 'Сканировать'}</Text>
          </Pressable>
          {scanError && <Text style={styles.error}>{scanError}</Text>}

          <FlatList
            data={found}
            keyExtractor={(d) => d.id}
            renderItem={({ item }) => (
              <Pressable style={styles.deviceRow} onPress={() => connect(item.id, item.name)}>
                <Text>{item.name ?? item.id}</Text>
              </Pressable>
            )}
          />

          <View style={styles.row}>
            <Pressable style={styles.button} onPress={() => disconnect()}>
              <Text style={styles.buttonText}>Отключить</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.dangerButton]} onPress={() => forget()}>
              <Text style={styles.buttonText}>Забыть</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 16 },
  info: { color: '#555' },
  status: { fontSize: 18, fontWeight: '600' },
  error: { color: '#c0392b' },
  button: {
    backgroundColor: '#2e7d32',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  dangerButton: { backgroundColor: '#c0392b' },
  buttonText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  emulatorBlock: { alignItems: 'center', gap: 12, marginTop: 12 },
  bleBlock: { gap: 12, flex: 1 },
  deviceRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
});
