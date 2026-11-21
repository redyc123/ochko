import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ButtonKind } from '../ble/protocol/events';
import { EmulatorDisplay } from './EmulatorDisplay';
import type { EmulatorDevice } from './EmulatorDevice';
import { useEmulatorDisplay } from './useEmulatorDisplay';

export interface EmulatorScreenProps {
  device: EmulatorDevice;
  scale?: number;
  buttonSize?: number;
  layout?: 'column' | 'row';
  showButton?: boolean;
}

/**
 * Превью экрана очков 72×40 + кнопка D1. Рисует ровно то, что декодировал
 * EmulatorDevice из тех же байтов display/control — не берёт ничего из стора
 * приложения напрямую (ТЗ §2).
 */
export function EmulatorScreen({
  device,
  scale = 4,
  buttonSize = 64,
  layout = 'column',
  showButton = true,
}: EmulatorScreenProps) {
  const { nextPage } = useEmulatorDisplay(device);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFired = useRef(false);

  const handlePressIn = () => {
    holdFired.current = false;
    holdTimer.current = setTimeout(() => {
      holdFired.current = true;
      device.pressButton(ButtonKind.HOLD_START);
    }, 500);
  };

  const handlePressOut = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holdFired.current) {
      device.pressButton(ButtonKind.RELEASE);
    } else {
      device.pressButton(ButtonKind.SHORT);
      nextPage();
    }
  };

  return (
    <View style={[styles.container, layout === 'row' ? styles.row : styles.column]}>
      <EmulatorDisplay device={device} scale={scale} />
      {showButton ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Кнопка D1"
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={[
            styles.button,
            {
              width: buttonSize,
              height: buttonSize,
              borderRadius: buttonSize / 2,
            },
          ]}
        >
          <Text style={styles.buttonLabel}>D1</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 12,
  },
  column: {
    flexDirection: 'column',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  button: {
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
