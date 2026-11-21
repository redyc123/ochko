import { StyleSheet, Switch, Text, View } from 'react-native';

import { colors, spacing } from './theme';

export interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
}: ToggleRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.sand, true: colors.accent }}
        thumbColor={colors.surface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: 6,
  },
  text: {
    flex: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  description: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: colors.muted,
  },
});
