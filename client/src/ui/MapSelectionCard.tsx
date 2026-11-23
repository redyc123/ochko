import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { LatLng } from '@/nav/types';

import { Button } from './Button';
import { Icon } from './Icon';
import { colors, radii, shadows, spacing } from './theme';

export interface MapSelectionCardProps {
  position: LatLng;
  address: string | null;
  loading: boolean;
  error: string | null;
  canBuildRoute: boolean;
  onBuildRoute: () => void;
  onClose: () => void;
}

export function MapSelectionCard({
  position,
  address,
  loading,
  error,
  canBuildRoute,
  onBuildRoute,
  onClose,
}: MapSelectionCardProps) {
  const title = address ?? (loading ? 'Определяем адрес…' : 'Точка на карте');
  const coordinates = `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.pin}>
          <Icon name="pin" size={20} color={colors.accent} strokeWidth={2} />
        </View>
        <View style={styles.address}>
          <Text style={styles.title} numberOfLines={3}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {loading && address ? coordinates : loading ? 'Ищем улицу и номер дома' : coordinates}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть выбранную точку"
          onPress={onClose}
          style={styles.close}
          hitSlop={8}
        >
          <Icon name="close" size={19} color={colors.muted} strokeWidth={2} />
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!canBuildRoute ? (
        <Text style={styles.error}>
          Для построения маршрута включите GPS и дождитесь текущей позиции.
        </Text>
      ) : null}
      <Button
        label="Построить маршрут"
        icon="route"
        onPress={onBuildRoute}
        disabled={!canBuildRoute}
        fullWidth
        style={styles.routeButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    ...shadows.floating,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  address: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontSize: 12,
  },
  close: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    marginTop: spacing.md,
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
  },
  routeButton: {
    marginTop: spacing.md,
  },
});
