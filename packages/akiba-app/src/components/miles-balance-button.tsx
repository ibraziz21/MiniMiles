import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text } from 'react-native';
import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { colors, fontFamily } from '@/design-system';

const milesIcon = require('../../assets/images/splash-icon.png') as number;

export function MilesBalanceButton() {
  const { accessToken, session } = useAuth();
  const owner = session?.user.id;
  const [balance, setBalance] = useState<{ owner: string | undefined; amount: number | null } | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (accessToken) {
      void createApiClient({ accessToken }).getVoucherState().then(result => {
        if (active) setBalance({ owner, amount: result.balance });
      }).catch(() => { if (active) setBalance({ owner, amount: null }); });
    }
    return () => { active = false; };
  }, [accessToken, owner]));
  const amount = balance?.owner === owner ? balance?.amount : null;
  return <Pressable accessibilityRole="button" accessibilityLabel={amount == null ? 'Miles balance unavailable. Open activity' : `${amount.toLocaleString('en-KE')} Miles. Open activity`} onPress={() => router.push('/profile/activity')} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
    <Image source={milesIcon} style={styles.icon} contentFit="contain" />
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.amount}>{amount == null ? '—' : amount.toLocaleString('en-KE')}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { flexDirection: 'row', gap: 5, flexShrink: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint, borderRadius: 24, minHeight: 44, minWidth: 74, maxWidth: 132, paddingHorizontal: 12 },
  icon: { width: 19, height: 19 },
  amount: { flexShrink: 1, color: colors.ink, fontFamily: fontFamily.sansBold, fontSize: 14, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.7 },
});
