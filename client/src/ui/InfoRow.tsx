import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from './theme';

export interface InfoRowProps {
  label: string;
  value: string;
  last?: boolean;
}

export function InfoRow({ label, value, last = false }: InfoRowProps) {
  return (
    <View style={[styles.row, last ? null : styles.divider]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    gap: spacing.lg,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  label: {
    fontSize: 14,
    color: colors.muted,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
    flexShrink: 1,
    textAlign: 'right',
  },
});
