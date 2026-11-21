import { StyleSheet, Text, View } from 'react-native';

import { ManeuverIcon } from '@/nav/maneuverMap';

import { Icon, maneuverIconName } from './Icon';
import { colors, radii, spacing } from './theme';

export interface ManeuverCardProps {
  iconType: number;
  distance: string;
  street: string;
}

function actionFor(type: number): string {
  switch (type) {
    case ManeuverIcon.STRAIGHT:
      return 'прямо на';
    case ManeuverIcon.SLIGHT_RIGHT:
    case ManeuverIcon.RIGHT:
    case ManeuverIcon.SHARP_RIGHT:
    case ManeuverIcon.KEEP_RIGHT:
      return 'направо на';
    case ManeuverIcon.SLIGHT_LEFT:
    case ManeuverIcon.LEFT:
    case ManeuverIcon.SHARP_LEFT:
    case ManeuverIcon.KEEP_LEFT:
      return 'налево на';
    case ManeuverIcon.UTURN:
      return 'развернитесь на';
    case ManeuverIcon.ROUNDABOUT:
      return 'через круг на';
    case ManeuverIcon.ARRIVE:
      return 'прибытие';
    case ManeuverIcon.START:
      return 'старт';
    case ManeuverIcon.STAIRS_OR_CROSSING:
      return 'лестница или переход';
    case ManeuverIcon.FERRY_OR_TRANSIT:
      return 'паром или транзит';
    default:
      return 'на';
  }
}

export function ManeuverCard({ iconType, distance, street }: ManeuverCardProps) {
  const action = actionFor(iconType);
  const subtitle = street ? `${action} ${street}` : action;

  return (
    <View style={styles.card}>
      <View style={styles.iconBox}>
        <Icon name={maneuverIconName(iconType)} size={30} color={colors.accent} strokeWidth={2} />
      </View>
      <View style={styles.text}>
        <Text style={styles.distance}>{distance}</Text>
        <Text style={styles.street} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  text: {
    flex: 1,
  },
  distance: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -1.1,
    color: colors.ink,
  },
  street: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
});
