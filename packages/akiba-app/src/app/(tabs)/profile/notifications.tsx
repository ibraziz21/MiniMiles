// Settings → Notifications: which kinds of push a member gets, saved to the
// same preferences the web Hub uses (/api/v1/me/notification-preferences),
// so a choice made on one applies to both. The push sender checks these
// before every send (hub-page src/lib/push/dispatch.ts).
//
// Orders and marketing are not offered: the app has no orders, and nothing
// sends marketing pushes. The phone's own permission comes first, because
// with it off none of the switches can do anything.
import { useCallback, useEffect, useState } from 'react';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import type { NotificationCategory, NotificationPreferences } from '@/contracts';
import { ActivityIndicator, Icon, ListGroup, ListRow, colors, fontFamily } from '@/design-system';

type Preferences = NotificationPreferences['preferences'];

const CATEGORIES: { key: NotificationCategory; icon: 'award' | 'tag' | 'users'; label: string; description: string }[] = [
  {
    key: 'earnings',
    icon: 'award',
    label: 'Miles you earn',
    description: 'When Miles land after a purchase, and a quick “How was it?” afterwards.',
  },
  {
    key: 'vouchers',
    icon: 'tag',
    label: 'Vouchers and offers',
    description: 'Vouchers ready to use, reminders before one expires, and new offers at places you saved.',
  },
  {
    key: 'rewards',
    icon: 'users',
    label: 'Referral rewards',
    description: 'When a friend you invited joins or becomes active.',
  },
];

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; preferences: Preferences };

export default function NotificationSettingsScreen() {
  const { accessToken } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [saving, setSaving] = useState<NotificationCategory | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [phoneAllowed, setPhoneAllowed] = useState<boolean | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    setState({ status: 'loading' });
    createApiClient({ accessToken })
      .getNotificationPreferences()
      .then((result) => setState({ status: 'ready', preferences: result.preferences }))
      .catch(() => setState({ status: 'error' }));
  }, [accessToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Re-checked on every return, since the member may have just changed it
  // in the phone's settings.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return;
      let active = true;
      void Notifications.getPermissionsAsync().then((permission) => {
        if (active) {
          setPhoneAllowed(permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
        }
      });
      return () => {
        active = false;
      };
    }, []),
  );

  async function toggle(category: NotificationCategory, enabled: boolean) {
    if (state.status !== 'ready' || !accessToken || saving) return;
    const previous = state.preferences;
    // Shown straight away; put back if the server doesn't take it.
    setState({ status: 'ready', preferences: { ...previous, [category]: enabled } });
    setSaving(category);
    setSaveFailed(false);
    try {
      const result = await createApiClient({ accessToken }).updateNotificationPreferences({ [category]: enabled });
      setState({ status: 'ready', preferences: result.preferences });
    } catch {
      setState({ status: 'ready', preferences: previous });
      setSaveFailed(true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.page} contentInsetAdjustmentBehavior="automatic" style={styles.screen}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Icon color={colors.muted} name="arrow-left" size={16} />
          <Text style={styles.backText}>Back to settings</Text>
        </Pressable>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>Choose what Akiba tells you about. This applies on the app and the web.</Text>
        </View>

        {phoneAllowed === false ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Notifications are off on this phone</Text>
            <Text style={styles.noticeBody}>Turn them on for Akiba in your phone’s settings, or none of these will arrive.</Text>
            <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={styles.noticeButton}>
              <Text style={styles.noticeButtonText}>Open phone settings</Text>
            </Pressable>
          </View>
        ) : null}

        {state.status === 'loading' ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.teal} />
          </View>
        ) : state.status === 'error' ? (
          <View style={styles.centered}>
            <Text style={styles.subtitle}>We couldn’t load your notification settings.</Text>
            <Pressable accessibilityRole="button" onPress={load} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ListGroup>
            {CATEGORIES.map((category) => (
              <ListRow
                key={category.key}
                accessibilityLabel={category.label}
                description={category.description}
                icon={category.icon}
                label={category.label}
                showChevron={false}
                trailing={
                  <Switch
                    accessibilityLabel={category.label}
                    disabled={saving !== null}
                    onValueChange={(value) => void toggle(category.key, value)}
                    thumbColor={colors.white}
                    trackColor={{ false: colors.line, true: colors.tealDark }}
                    value={state.preferences[category.key]}
                  />
                }
              />
            ))}
          </ListGroup>
        )}

        {saveFailed ? (
          <Text accessibilityRole="alert" style={styles.error}>
            That change didn’t save. Check your connection and try again.
          </Text>
        ) : null}
        <Text style={styles.footnote}>Account and security messages are always sent by email.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.paper },
  page: { alignSelf: 'center', gap: 16, maxWidth: 720, paddingBottom: 36, paddingHorizontal: 16, width: '100%' },
  back: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 6, minHeight: 44, paddingRight: 12 },
  backText: { color: colors.muted, fontFamily: fontFamily.sansMedium, fontSize: 14 },
  pressed: { opacity: 0.76 },
  heading: { gap: 4 },
  title: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 30 },
  subtitle: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20 },
  centered: { alignItems: 'center', gap: 12, minHeight: 200, justifyContent: 'center' },
  retry: { backgroundColor: colors.tealDark, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 11 },
  retryText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
  notice: { backgroundColor: colors.tint, borderRadius: 16, gap: 6, padding: 16 },
  noticeTitle: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 15 },
  noticeBody: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 19 },
  noticeButton: { alignSelf: 'flex-start', justifyContent: 'center', marginTop: 4, minHeight: 44 },
  noticeButtonText: { color: colors.tealDark, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
  error: { color: colors.danger, fontFamily: fontFamily.sansMedium, fontSize: 13 },
  footnote: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12 },
});
