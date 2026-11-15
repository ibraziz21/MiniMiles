import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import type { ActivityItem } from '@/contracts';
import { Icon } from '@/design-system';
import { Action, Card, Loading, Notice, Pills, palette, ui } from '@/features/profile/ui';
import { useProfileResource } from '@/features/profile/use-profile-resource';

export default function ActivityScreen() {
  const { session } = useAuth();
  return <Activity key={session?.user.id ?? 'guest'} />;
}
function Activity() {
  const { accessToken } = useAuth();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<'all' | 'earned' | 'spent'>('all');
  const [selected, setSelected] = useState<ActivityItem | null>(null);
  const activity = useProfileResource(useCallback(() => createApiClient({ accessToken }).getProfileActivity(), [accessToken]));
  const overview = useProfileResource(useCallback(() => createApiClient({ accessToken }).getOverview(), [accessToken]));
  const items = activity.data?.items.filter(item => filter === 'all' || (filter === 'earned' ? (item.miles ?? 0) > 0 : (item.miles ?? 0) < 0)) ?? [];
  const groups = new Map<string, ActivityItem[]>();
  items.forEach(item => { const date = new Date(item.ts).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }); groups.set(date, [...(groups.get(date) ?? []), item]); });
  return <>
    <ScrollView style={ui.screen} contentContainerStyle={[ui.page, ui.stack]} refreshControl={<RefreshControl refreshing={activity.loading && !!activity.data} onRefresh={() => { void activity.reload(); void overview.reload(); }} tintColor={palette.teal} />}>
      <View style={ui.row}><Pressable accessibilityRole="button" accessibilityLabel="Back to profile" style={ui.action} onPress={() => router.back()}><Icon name="arrow-left" size={23} /></Pressable><Text style={ui.heading}>Activity</Text></View>
      <Card><Text style={ui.meta}>Available Miles</Text><Text style={[ui.heading, { fontSize: 30 }]}>{overview.data?.balance.hasBalance ? overview.data.balance.balance.toLocaleString('en-KE') : '—'} <Text style={[ui.title, { color: palette.teal }]}>Miles</Text></Text>{overview.error ? <Action label="Retry balance" onPress={overview.reload} /> : null}</Card>
      <Pills value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'earned', label: 'Earned (+)' }, { value: 'spent', label: 'Spent (−)' }]} />
      {activity.loading && !activity.data ? <Loading /> : null}
      {activity.error ? <Notice error title="Couldn't load your activity" body="Please try again. Any previously loaded activity is shown below." action="Retry" onAction={activity.reload} /> : null}
      {[...groups].map(([date, rows]) => <View key={date} style={ui.stack}><Text style={ui.meta}>{date}</Text>{rows.map(item => <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${amount(item)}. View details`} key={item.id} onPress={() => setSelected(item)} style={[ui.card, ui.row]}><View style={[ui.icon, { backgroundColor: palette.tint }]}><Icon name={(item.miles ?? 0) < 0 ? 'gift' : 'zap'} color={palette.teal} size={22} /></View><View style={ui.flex}><Text style={ui.title}>{item.title}</Text><Text style={ui.meta}>{item.detail}</Text></View><View style={{ alignItems: 'flex-end', maxWidth: '34%' }}><Text style={[ui.title, { color: (item.miles ?? 0) < 0 ? palette.danger : palette.teal }]}>{amount(item)}</Text><Icon name="chevron-right" size={16} color={palette.muted} /></View></Pressable>)}</View>)}
      {!activity.loading && !activity.error && !items.length ? <Notice title="No activity here yet" body={filter === 'all' ? 'Your Miles and reward activity will appear here.' : `No ${filter === 'earned' ? 'earned' : 'spent'} Miles in your recent activity.`} /> : null}
      {activity.data && !activity.error && !!items.length ? <Text style={[ui.meta, { textAlign: 'center', padding: 16 }]}>{activity.data.items.length >= activity.data.limit ? `Showing your ${activity.data.limit} most recent activities` : 'Recent activity loaded'}</Text> : null}
    </ScrollView>
    <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0007' }}><Pressable accessibilityRole="button" accessibilityLabel="Close activity details" style={{ flex: 1 }} onPress={() => setSelected(null)} /><View accessibilityViewIsModal style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: Math.max(24, insets.bottom), gap: 16 }}>
        {selected ? <><Text style={ui.heading}>{selected.title}</Text><Text style={ui.heading}>{amount(selected)}</Text>{selected.detail ? <Text style={ui.body}>{selected.detail}</Text> : null}<Text style={ui.body}>{new Date(selected.ts).toLocaleString('en-KE')}</Text><Text selectable style={ui.meta}>Activity reference: {selected.id}</Text></> : null}<Action primary label="Done" onPress={() => setSelected(null)} />
      </View></View>
    </Modal>
  </>;
}
function amount(item: ActivityItem) { return item.miles == null || item.miles === 0 ? 'Reward activity' : `${item.miles > 0 ? '+' : '−'}${Math.abs(item.miles).toLocaleString('en-KE')} Miles`; }
