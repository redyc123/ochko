import type { ViewStyle } from 'react-native';

/** Палитра V1 «Air»: тёплый светлый фон, тёмный текст, изумрудный акцент. */
export const colors = {
  bg: '#F4F1EA',
  surface: '#FFFFFF',
  ink: '#14171A',
  muted: '#6B7280',
  soft: '#9A9385',
  line: '#E7E1D5',
  accent: '#0F7B5F',
  accentSoft: '#DDF0E9',
  accent2: '#2F6BFF',
  sand: '#EAE3D5',
  danger: '#C0392B',
  dangerSoft: '#FDECEA',
  dark: '#14171A',
  display: '#07120E',
  displayText: '#9BE8C8',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  sheet: 28,
  pill: 999,
} as const;

export const shadows: Record<'card' | 'floating' | 'sheet' | 'dark', ViewStyle> = {
  card: {
    shadowColor: colors.ink,
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  floating: {
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  sheet: {
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 12,
  },
  dark: {
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
};

export const profileLabels = {
  pedestrian: 'пешком',
  bicycle: 'на велосипеде',
  auto: 'на машине',
} as const;
