import { Pressable, StyleSheet, Text, View } from 'react-native';

import { shortPlaceName } from '@/agent/tools';
import type { GeocodeResult } from '@/nav/geocode';

import { Icon } from './Icon';
import { colors, radii, spacing } from './theme';

export interface CandidateListProps {
  candidates: GeocodeResult[];
  onSelect: (candidate: GeocodeResult, index: number) => void;
}

export function CandidateList({ candidates, onSelect }: CandidateListProps) {
  return (
    <View style={styles.list}>
      {candidates.map((candidate, index) => (
        <Pressable
          key={`${candidate.lat},${candidate.lon},${index}`}
          accessibilityRole="button"
          accessibilityLabel={shortPlaceName(candidate.displayName)}
          onPress={() => onSelect(candidate, index)}
          style={({ pressed }) => [
            styles.row,
            index === candidates.length - 1 ? styles.last : styles.divider,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{index + 1}</Text>
          </View>
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              {shortPlaceName(candidate.displayName)}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {candidate.displayName}
            </Text>
          </View>
          <Icon name="chevronRight" size={18} color={colors.soft} strokeWidth={2} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  last: {},
  pressed: {
    opacity: 0.65,
  },
  badge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.muted,
  },
});
