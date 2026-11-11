import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcon, colors } from '@/design-system';

// Rendered once in the tabs layout so the Pass QR is one tap away on every screen.
export function FloatingPassButton() {
  const insets = useSafeAreaInsets();
  return <Pressable accessibilityRole="button" accessibilityLabel="Show your Akiba Pass QR code" onPress={() => router.navigate('/pass')} style={({ pressed }) => [styles.button, { bottom: insets.bottom + 80, right: Math.max(16, insets.right) }, pressed && styles.pressed]}>
    <MaterialIcon name="qrcode" size={28} color={colors.white} />
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center', boxShadow: '0 5px 16px rgba(35,141,157,0.32)' },
  pressed: { backgroundColor: colors.tealDark, transform: [{ scale: 0.96 }] },
});
