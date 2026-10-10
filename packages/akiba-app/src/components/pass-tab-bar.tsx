import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, MaterialIcon, colors, fontFamily } from '@/design-system';

type TabKey = 'explore' | 'merchants' | 'rewards' | 'gifts';

const LEFT_TABS = [
  { key: 'explore' as const, href: '/' as const, label: 'Explore', icon: 'compass' as const },
  { key: 'merchants' as const, href: '/merchants' as const, label: 'Merchants', icon: 'shopping-bag' as const },
];

const RIGHT_TABS = [
  { key: 'rewards' as const, href: '/vouchers' as const, label: 'Rewards', icon: 'tag' as const },
  { key: 'gifts' as const, href: '/gifts' as const, label: 'Gifts', icon: 'gift' as const },
];

function resolveActive(pathname: string): TabKey | null {
  if (pathname === '/') return 'explore';
  if (pathname.startsWith('/merchants')) return 'merchants';
  if (pathname.startsWith('/vouchers')) return 'rewards';
  if (pathname.startsWith('/gifts')) return 'gifts';
  return null;
}

type TabItem = (typeof LEFT_TABS | typeof RIGHT_TABS)[number];

function NavigationItem({ item, active }: { item: TabItem; active: boolean }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={() => router.navigate(item.href)}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}>
      <View style={[styles.iconWell, active && styles.iconWellActive]}>
        <Icon name={item.icon} size={20} color={active ? colors.teal : colors.muted} />
      </View>
      <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
    </Pressable>
  );
}

/**
 * `showGifts` comes from the resolved `features.gifts` flag: the Gifts tab
 * is a coming-soon placeholder, so the destination is hidden entirely
 * rather than shipped as a dead end (AKIBA-MOB-001 §1).
 */
export function PassTabBar({ showGifts = false }: { showGifts?: boolean }) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const active = resolveActive(pathname);
  const passActive = pathname.startsWith('/pass');
  const rightTabs = showGifts ? RIGHT_TABS : RIGHT_TABS.filter((item) => item.key !== 'gifts');

  return (
    <View style={[styles.shell, { paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        {LEFT_TABS.map((item) => (
          <NavigationItem key={item.key} item={item} active={active === item.key} />
        ))}

        <View style={styles.passSlot}>
          <Pressable
            accessibilityLabel="Show your Akiba Pass"
            accessibilityRole="tab"
            accessibilityState={{ selected: passActive }}
            onPress={() => router.navigate('/pass')}
            style={({ pressed }) => [
              styles.passButton,
              passActive && styles.passButtonActive,
              pressed && styles.passButtonPressed,
            ]}>
            <MaterialIcon name="qrcode" size={27} color={colors.white} />
          </Pressable>
          <Text style={[styles.passLabel, passActive && styles.labelActive]}>Pass</Text>
        </View>

        {rightTabs.map((item) => (
          <NavigationItem key={item.key} item={item} active={active === item.key} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    height: 64,
    overflow: 'visible',
  },
  item: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 56,
  },
  itemPressed: {
    backgroundColor: 'rgba(247,247,247,0.7)',
  },
  iconWell: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: 12,
    height: 32,
    justifyContent: 'center',
    minWidth: 40,
  },
  iconWellActive: {
    backgroundColor: colors.tint,
  },
  label: {
    color: colors.muted,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 10,
    letterSpacing: 0.35,
    lineHeight: 12,
  },
  labelActive: {
    color: colors.teal,
  },
  passSlot: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
    width: 80,
  },
  passButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderColor: colors.white,
    borderRadius: 999,
    borderWidth: 4,
    boxShadow: '0 8px 20px rgba(13,14,12,0.22)',
    height: 62,
    justifyContent: 'center',
    marginTop: -32,
    width: 62,
  },
  passButtonActive: {
    backgroundColor: colors.teal,
  },
  passButtonPressed: {
    transform: [{ scale: 0.95 }],
  },
  passLabel: {
    color: colors.muted,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: 10,
    letterSpacing: 0.35,
    lineHeight: 12,
    marginTop: 1,
  },
});
