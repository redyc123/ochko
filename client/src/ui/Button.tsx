import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { colors, radii, spacing } from './theme';

export type ButtonVariant = 'primary' | 'accent' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'default' | 'compact';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  rightSlot?: ReactNode;
}

const palette: Record<
  ButtonVariant,
  { background: string; border: string; text: string; icon: string }
> = {
  primary: {
    background: colors.ink,
    border: colors.ink,
    text: colors.surface,
    icon: colors.surface,
  },
  accent: {
    background: colors.accent,
    border: colors.accent,
    text: colors.surface,
    icon: colors.surface,
  },
  outline: {
    background: colors.surface,
    border: colors.line,
    text: colors.ink,
    icon: colors.ink,
  },
  ghost: {
    background: 'transparent',
    border: 'transparent',
    text: colors.accent,
    icon: colors.accent,
  },
  danger: {
    background: colors.dangerSoft,
    border: colors.dangerSoft,
    text: colors.danger,
    icon: colors.danger,
  },
};

export function Button({
  label,
  variant = 'primary',
  size = 'default',
  icon,
  iconPosition = 'left',
  fullWidth = false,
  style,
  rightSlot,
  disabled,
  ...rest
}: ButtonProps) {
  const tone = palette[variant];
  const iconSize = size === 'compact' ? 16 : 18;
  const content = (
    <>
      {icon && iconPosition === 'left' ? (
        <Icon name={icon} size={iconSize} color={tone.icon} strokeWidth={2} />
      ) : null}
      <Text
        style={[
          styles.label,
          size === 'compact' ? styles.labelCompact : styles.labelDefault,
          { color: tone.text },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {rightSlot}
      {icon && iconPosition === 'right' ? (
        <Icon name={icon} size={iconSize} color={tone.icon} strokeWidth={2} />
      ) : null}
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        size === 'compact' ? styles.compact : styles.defaultSize,
        {
          backgroundColor: tone.background,
          borderColor: tone.border,
          opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
        },
        fullWidth ? styles.fullWidth : null,
        style,
      ]}
      {...rest}
    >
      <View style={styles.row}>{content}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultSize: {
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  compact: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: {
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  labelDefault: {
    fontSize: 16,
  },
  labelCompact: {
    fontSize: 13,
  },
});
