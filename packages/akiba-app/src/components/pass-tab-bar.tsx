import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, colors, fontFamily } from '@/design-system';

const MAIN_TABS = [
  { href: '/' as const, label: 'Explore', icon: 'compass' as const },
  { href: '/merchants' as const, label: 'Merchants', icon: 'shopping-bag' as const },
  { href: '/vouchers' as const, label: 'Rewards', icon: 'tag' as const },
];
const OFFERS_TAB = { href: '/offers' as const, label: 'Offers', icon: 'percent' as const };
const GIFTS_TAB = { href: '/gifts' as const, label: 'Gifts', icon: 'gift' as const };
const PROFILE_TAB = { href: '/profile' as const, label: 'Profile', icon: 'user' as const };

export function PassTabBar({ showGifts = false }: { showGifts?: boolean }) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const tabs = [...MAIN_TABS, showGifts ? GIFTS_TAB : OFFERS_TAB, PROFILE_TAB];
  return <View style={[styles.shell, { paddingBottom: insets.bottom }]}>
    <View accessibilityRole="tablist" style={styles.row}>{tabs.map(item => {
      const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
      return <Pressable key={item.href} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => router.navigate(item.href)} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
        <View style={[styles.iconWell, active && styles.activeWell]}><Icon name={item.icon} size={21} color={active ? colors.teal : colors.muted} /></View>
        <Text style={[styles.label, active && styles.activeLabel]}>{item.label}</Text>
      </Pressable>;
    })}</View>
  </View>;
}
const styles = StyleSheet.create({
  shell: { backgroundColor: colors.white, borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', height: 64 },
  item: { alignItems: 'center', flex: 1, gap: 2, justifyContent: 'center', minHeight: 56 },
  pressed: { backgroundColor: colors.tint },
  iconWell: { alignItems: 'center', borderRadius: 12, height: 32, justifyContent: 'center', minWidth: 40 },
  activeWell: { backgroundColor: colors.tint },
  label: { color: colors.muted, fontFamily: fontFamily.sansSemiBold, fontSize: 10, lineHeight: 14 },
  activeLabel: { color: colors.teal },
});
