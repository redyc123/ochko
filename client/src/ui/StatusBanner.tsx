import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { colors, radii, spacing } from './theme';

export type StatusBannerTone = 'error' | 'info' | 'success';

export interface StatusBannerProps {
  message: string;
  tone?: StatusBannerTone;
  onPress?: () => void;
}

const tones: Record<StatusBannerTone, { background: string; color: string; icon: IconName }> = {
  error: { background: colors.dangerSoft, color: colors.danger, icon: 'warning' },
  info: { background: colors.accentSoft, color: colors.accent, icon: 'dot' },
  success: { background: colors.accentSoft, color: colors.accent, icon: 'check' },
};

export function StatusBanner({ message, tone = 'info', onPress }: StatusBannerProps) {
  const palette = tones[tone];
  const content = (
    <View style={styles.row}>
      <Icon name={palette.icon} size={18} color={palette.color} strokeWidth={2} />
      <Text style={[styles.text, { color: palette.color }]}>{message}</Text>
    </View>
  );

  if (!onPress) {
    return <View style={[styles.base, { backgroundColor: palette.background }]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={message}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.background },
        pressed ? styles.pressed : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  pressed: {
    opacity: 0.78,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  text: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
});
