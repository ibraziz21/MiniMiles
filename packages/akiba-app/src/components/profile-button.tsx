import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Icon, colors, shadows } from '@/design-system';

export function ProfileButton() {
  return (
    <Pressable
      accessibilityLabel="Open profile"
      accessibilityRole="button"
      hitSlop={4}
      onPress={() => router.push('/profile')}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Icon name="user" size={19} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    ...shadows.chip,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: 999,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  pressed: {
    backgroundColor: colors.tint,
    transform: [{ scale: 0.97 }],
  },
});
