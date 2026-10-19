import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RouteMapProps } from './RouteMap';

export type { RouteMapProps } from './RouteMap';

/**
 * Веб-заглушка: react-native-maps не загружается в браузере (его нативные
 * компоненты падают при импорте модуля), поэтому на web карту не рисуем —
 * см. docs/LIMITATIONS.md. Остальной экран «Навигация» (поиск, манёвры,
 * превью очков) работает как обычно.
 */
export function RouteMap(_props: RouteMapProps): React.JSX.Element {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.text}>
        Карта недоступна в веб-версии — соберите приложение под Android/iOS.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    height: 220,
    borderRadius: 8,
    backgroundColor: '#eee',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  text: { color: '#777', textAlign: 'center' },
});
