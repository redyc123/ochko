import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { colors } from '@/ui/theme';

import type { EmulatorDevice } from './EmulatorDevice';
import { DISPLAY_COLS, DISPLAY_ROWS } from './displayContent';
import { useEmulatorDisplay } from './useEmulatorDisplay';

export interface EmulatorDisplayProps {
  device: EmulatorDevice;
  scale?: number;
  style?: StyleProp<ViewStyle>;
}

/** Чистое превью дисплея 72×40 без кнопки — для карточек и экрана очков. */
export function EmulatorDisplay({ device, scale = 4, style }: EmulatorDisplayProps) {
  const { currentPage } = useEmulatorDisplay(device);

  return (
    <View
      style={[
        styles.screen,
        {
          width: 72 * scale,
          height: 40 * scale,
          padding: 2 * scale,
        },
        style,
      ]}
    >
      {Array.from({ length: DISPLAY_ROWS }).map((_, row) => (
        <Text
          key={row}
          style={[
            styles.row,
            {
              fontSize: 7 * scale,
              lineHeight: 7.5 * scale,
            },
          ]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {(currentPage[row] ?? '').padEnd(DISPLAY_COLS, ' ')}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#000',
    justifyContent: 'space-between',
  },
  row: {
    color: colors.displayText,
    fontFamily: 'monospace',
  },
});
