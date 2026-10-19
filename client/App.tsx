import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { RootNavigator } from './src/screens/RootNavigator';
import { useDeviceStore } from './src/store/deviceStore';

/**
 * BleManager — нативный модуль, которого нет в Expo Go и в web-сборке.
 * Создаём его лениво и без шума: если модуль не слинкован (запуск без
 * dev client/prebuild), приложение остаётся на эмуляторе очков, что и
 * задумано для разработки без прошивки под рукой.
 */
function tryRegisterBleManager(): void {
  if (Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BleManager } = require('react-native-ble-plx') as typeof import('react-native-ble-plx');
    useDeviceStore.getState().registerBleManager(new BleManager());
  } catch (err) {
    console.warn(
      'BLE недоступен (нужен dev client/prebuild) — работаем через эмулятор очков.',
      err,
    );
  }
}

export default function App(): React.JSX.Element {
  useEffect(() => {
    tryRegisterBleManager();
    void useDeviceStore.getState().hydrate();
  }, []);

  return (
    <>
      <RootNavigator />
      <StatusBar style="auto" />
    </>
  );
}
