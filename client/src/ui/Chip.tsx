import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { colors, radii, spacing } from './theme';

export type ChipTone = 'neutral' | 'accent' | 'dark' | 'outline';

export interface ChipProps {
  label: string;
  icon?: IconName;
  tone?: ChipTone;
  dot?: boolean;
  selected?: boolean;
  onPress?: () => void;
}

const tones: Record<ChipTone, { background: string; border: string; text: string }> = {
  neutral: { background: colors.surface, border: colors.line, text: colors.muted },
  accent: { background: colors.accentSoft, border: colors.accentSoft, text: colors.accent },
  dark: { background: colors.dark, border: colors.dark, text: colors.surface },
  outline: { background: 'transparent', border: colors.line, text: colors.ink },
};

export function Chip({
  label,
  icon,
  tone = 'neutral',
  dot = false,
  selected = false,
  onPress,
}: ChipProps) {
  const toneStyle = selected ? tones.accent : tones[tone];
  const content = (
    <View style={styles.row}>
      {dot ? <View style={[styles.dot, { backgroundColor: toneStyle.text }]} /> : null}
      {icon ? <Icon name={icon} size={14} color={toneStyle.text} strokeWidth={2} /> : null}
      <Text style={[styles.label, { color: toneStyle.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) {
    return (
      <View
        style={[
          styles.base,
          { backgroundColor: toneStyle.background, borderColor: toneStyle.border },
        ]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: toneStyle.background, borderColor: toneStyle.border },
        pressed ? styles.pressed : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    alignSelf: 'flex-start',
  },
  pressed: {
    opacity: 0.75,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
