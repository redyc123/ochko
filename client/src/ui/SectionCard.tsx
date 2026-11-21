import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { colors, radii, shadows, spacing } from './theme';

export interface SectionCardProps {
  children: ReactNode;
  title?: string;
  action?: ReactNode;
  tone?: 'light' | 'dark';
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

export function SectionCard({
  children,
  title,
  action,
  tone = 'light',
  padded = true,
  style,
  contentStyle,
}: SectionCardProps) {
  const dark = tone === 'dark';
  return (
    <View
      style={[
        styles.card,
        dark ? styles.darkCard : styles.lightCard,
        padded ? styles.padded : null,
        style,
      ]}
    >
      {title || action ? (
        <View style={styles.header}>
          {title ? (
            <Text style={[styles.title, { color: dark ? colors.surface : colors.muted }]}>
              {title}
            </Text>
          ) : (
            <View />
          )}
          {action}
        </View>
      ) : null}
      <View style={contentStyle}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
  },
  lightCard: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    ...shadows.card,
  },
  darkCard: {
    backgroundColor: colors.dark,
    borderColor: colors.dark,
    ...shadows.dark,
  },
  padded: {
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
