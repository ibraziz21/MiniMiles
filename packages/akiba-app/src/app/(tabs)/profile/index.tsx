import { useCallback, useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { Icon, fontFamily } from '@/design-system';
import { MyRewards } from '@/features/profile/my-rewards';
import { SavedItems } from '@/features/profile/saved-items';
import { MyShares } from '@/features/profile/my-shares';
import { Loading, Notice, palette, ui } from '@/features/profile/ui';
import { useProfileResource } from '@/features/profile/use-profile-resource';

export default function ProfileScreen() {
  const { session } = useAuth();
  return <Profile key={session?.user.id ?? 'guest'} />;
}
function Profile() {
  const { accessToken } = useAuth();
  const [tab, setTab] = useState<'rewards' | 'saved' | 'shares'>('rewards');
  const [refresh, setRefresh] = useState(0);
  const { data, loading, error, reload } = useProfileResource(useCallback(() => createApiClient({ accessToken }).getOverview(), [accessToken]));
  const profile = data?.profile;
  const name = profile?.displayName || profile?.username || 'Your profile';
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  return <ScrollView style={ui.screen} contentContainerStyle={[ui.page, { paddingBottom: 88 }]} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={() => { void reload(); setRefresh(value => value + 1); }} tintColor={palette.teal} />}>
    <View style={styles.top}><Text style={styles.pageTitle}>Profile</Text><Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/profile/settings')} style={styles.settings}><Icon name="settings" size={24} color={palette.muted} /></Pressable></View>
    {!data && loading ? <Loading /> : null}
    {error ? <Notice error title="Couldn't refresh your profile" body="Please try again. Your last loaded profile is shown when available." action="Retry" onAction={reload} /> : null}
    {profile ? <>
      <View style={styles.identity}>
        <View style={styles.avatar}>{profile.avatarUrl ? <Image source={profile.avatarUrl} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Text style={styles.initials}>{initials}</Text>}</View>
        <Text style={styles.name}>{name}</Text>
        {profile.username ? <Text style={ui.body}>@{profile.username}</Text> : null}
        <View style={styles.location}><Icon name="map-pin" size={14} color={palette.teal} /><Text style={ui.meta}>{[profile.city, profile.country].filter(Boolean).join(', ') || 'Add your location'}</Text><Pressable accessibilityRole="button" onPress={() => router.push('/profile/settings')} style={styles.edit}><Text style={styles.editText}>Edit profile</Text></Pressable></View>
      </View>
      <View accessibilityRole="tablist" style={styles.tabs}>{([{ value: 'rewards', label: 'My rewards' }, { value: 'saved', label: 'Saved' }, { value: 'shares', label: 'My shares' }] as const).map(item => <Pressable key={item.value} accessibilityRole="tab" accessibilityState={{ selected: tab === item.value }} onPress={() => setTab(item.value)} style={[styles.tab, tab === item.value && styles.selected]}><Text style={[styles.tabText, tab === item.value && { color: palette.teal }]}>{item.label}</Text></Pressable>)}</View>
      {tab === 'rewards' ? <MyRewards balance={data.balance} refresh={refresh} /> : tab === 'saved' ? <SavedItems refresh={refresh} /> : <MyShares refresh={refresh} />}
    </> : null}
  </ScrollView>;
}
const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, pageTitle: { fontFamily: fontFamily.sansBold, fontSize: 25, color: palette.ink }, settings: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  identity: { alignItems: 'center', paddingTop: 20, paddingBottom: 20 }, avatar: { backgroundColor: palette.tint, width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 12 }, initials: { fontFamily: fontFamily.sansBold, color: palette.teal, fontSize: 27 }, name: { fontFamily: fontFamily.sansBold, fontSize: 23, color: palette.ink, textAlign: 'center', marginBottom: 3 }, location: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 5 }, edit: { minHeight: 44, paddingHorizontal: 6, justifyContent: 'center' }, editText: { color: palette.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 13 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: palette.line, marginBottom: 20 }, tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderBottomWidth: 3, borderBottomColor: 'transparent' }, selected: { borderBottomColor: palette.teal }, tabText: { color: palette.muted, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
});
