import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmulatorDisplay } from '@/emulator/EmulatorDisplay';
import type { EmulatorDevice } from '@/emulator/EmulatorDevice';

import { Icon } from './Icon';
import { colors, radii, shadows, spacing } from './theme';

export interface GlassesCardProps {
  device: EmulatorDevice;
  onPress?: () => void;
  scale?: number;
}

export function GlassesCard({ device, onPress, scale = 1.5 }: GlassesCardProps) {
  const content = (
    <>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="glasses" size={15} color={colors.surface} strokeWidth={2} />
          <Text style={styles.headerTitle}>Экран очков</Text>
        </View>
        <View style={styles.live}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>
      <View style={styles.displayWrap}>
        <EmulatorDisplay device={device} scale={scale} />
      </View>
    </>
  );

  if (!onPress) {
    return <View style={styles.card}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Открыть экран очков"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  );
}

export interface GlassesMiniProps {
  onPress: () => void;
  label?: string;
}

export function GlassesMini({ onPress, label = 'Очки' }: GlassesMiniProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Открыть экран очков"
      onPress={onPress}
      style={({ pressed }) => [styles.mini, pressed ? styles.pressed : null]}
    >
      <Icon name="glasses" size={17} color={colors.surface} strokeWidth={2} />
      <Text style={styles.miniLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'flex-start',
    padding: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: colors.dark,
    gap: spacing.sm,
    ...shadows.dark,
  },
  pressed: {
    opacity: 0.82,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.soft,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.displayText,
  },
  liveText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.displayText,
  },
  displayWrap: {
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  mini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.dark,
    ...shadows.card,
  },
  miniLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.surface,
  },
});
