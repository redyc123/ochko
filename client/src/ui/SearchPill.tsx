import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from './Icon';
import { colors, radii, shadows, spacing } from './theme';

export interface SearchPillProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  onMic?: () => void;
  editable?: boolean;
}

export function SearchPill({
  value,
  onChangeText,
  onSubmit,
  placeholder = 'Куда идём?',
  onMic,
  editable = true,
}: SearchPillProps) {
  return (
    <View style={styles.pill}>
      <Icon name="search" size={19} color={colors.muted} strokeWidth={2} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.soft}
        selectionColor={colors.accent}
        returnKeyType="search"
        autoCorrect={false}
        editable={editable}
        clearButtonMode="while-editing"
      />
      {onMic ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Спросить голосом"
          onPress={onMic}
          style={({ pressed }) => [styles.mic, pressed ? styles.pressed : null]}
        >
          <Icon name="mic" size={18} color={colors.accent} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 54,
    paddingLeft: spacing.lg,
    paddingRight: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.floating,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.ink,
    paddingVertical: 0,
    minHeight: 24,
  },
  mic: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  pressed: {
    opacity: 0.7,
  },
});
