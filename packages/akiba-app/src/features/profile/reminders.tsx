import { loadOfferDecisionState } from '@/lib/offer-decision-storage';
import { useCallback, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Alert, Linking, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { Icon } from '@/design-system';
import { forgetServerReminder, loadOfferLibrary, rememberServerReminder, type SavedServerReminder } from '@/lib/profile-offer-library';
import { scheduleOfferReminder } from '@/push/funded-offer-reminder';
import { Action, Card, Loading, Notice, palette, ui } from './ui';
import { useProfileResource } from './use-profile-resource';

type Reminder = { id: string; title: string; merchantSlug: string; merchantName: string; source: 'device' | 'service'; date?: string; openingAt?: string; leadMinutes?: 30 | 60 | 1440; service?: SavedServerReminder; unavailable?: boolean };
export function ProfileReminders({ refresh }: { refresh: number }) {
  const { accessToken, session } = useAuth();
  const scope = session?.user.id ?? 'guest';
  const insets = useSafeAreaInsets();
  const { data, setData, loading, error, reload } = useProfileResource(useCallback(async () => {
    void refresh;
    const [library, scheduled] = await Promise.all([loadOfferLibrary(scope), Platform.OS === 'web' ? Promise.resolve([]) : Notifications.getAllScheduledNotificationsAsync()]);
    const decisions = await loadOfferDecisionState(scope);
    const legacy = decisions.entries.filter(([id, kind]) => kind === 'r' && !id.startsWith('funded-') && !library.reminders.some(item => item.id === id));
    if (legacy.length) {
      const feed = await createApiClient({ accessToken }).getMerchantOffers();
      for (const [id] of legacy) {
        const saved = await createApiClient({ accessToken }).getOfferReminder(id);
        if (!saved.reminder) continue;
        const offer = feed.offers.find(item => item.id === id);
        const reminder = { id, title: offer?.title ?? 'Offer reminder', merchantName: offer?.partner.name ?? '', merchantSlug: offer?.partner.slug ?? '', leadMinutes: saved.reminder.leadMinutes };
        await rememberServerReminder(scope, reminder);
        library.reminders.push(reminder);
      }
    }
    const local: Reminder[] = scheduled.filter(item => item.content.data?.ownerId === scope && (item.identifier.startsWith('offer-') || item.identifier.startsWith('funded-offer-'))).map(item => {
      const metadata = item.content.data ?? {};
      const url = typeof metadata.url === 'string' ? metadata.url : '';
      return { id: item.identifier, title: typeof metadata.offerTitle === 'string' ? metadata.offerTitle : item.content.body ?? 'Offer reminder', merchantName: '', merchantSlug: url.startsWith('/merchants/') ? url.slice(11) : '', source: 'device', date: typeof metadata.remindAt === 'string' ? metadata.remindAt : undefined, openingAt: typeof metadata.openingAt === 'string' ? metadata.openingAt : undefined };
    });
    const remote = await Promise.all(library.reminders.map(async item => {
      try {
        const state = await createApiClient({ accessToken }).getOfferReminder(item.id);
        if (!state.reminder) return null;
        return { ...item, source: 'service' as const, leadMinutes: state.reminder.leadMinutes, service: item };
      } catch { return { ...item, source: 'service' as const, service: item, unavailable: true }; }
    }));
    return [...local, ...remote.filter((item): item is NonNullable<typeof item> => item !== null)] as Reminder[];
  }, [scope, accessToken, refresh]));
  const [editor, setEditor] = useState<Reminder | null>(null);
  const [lead, setLead] = useState<30 | 60 | 1440>(30);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  function open(item: Reminder) { setActionError(null); setEditor(item); setLead(item.leadMinutes ?? 30); }
  async function save() {
    if (!editor || pending) return; setPending(true); setActionError(null);
    try {
      if (editor.source === 'service') {
        await createApiClient({ accessToken }).setOfferReminder(editor.id, lead);
        await rememberServerReminder(scope, { ...editor.service!, leadMinutes: lead });
      } else {
        const date = new Date(editor.openingAt ? Date.parse(editor.openingAt) - lead * 60_000 : Date.now() + lead * 60_000);
        if (date.getTime() <= Date.now()) { setActionError('That time has passed. Choose a later reminder or view the offer for its next opening.'); return; }
        await scheduleOfferReminder({ id: editor.id, title: editor.title, merchantSlug: editor.merchantSlug, ownerId: scope, openingAt: editor.openingAt, date });
      }
      setEditor(null); setNotice('Reminder updated'); await reload();
    } catch { setActionError('We couldn’t confirm this change. Try again or refresh to check the current reminder. For phone reminders, check notification permissions.'); }
    finally { setPending(false); }
  }
  async function cancel(item: Reminder) {
    if (pending) return; setPending(true); setActionError(null);
    try {
      if (item.source === 'service') { await createApiClient({ accessToken }).removeOfferReminder(item.id); await forgetServerReminder(scope, item.id); }
      else await Notifications.cancelScheduledNotificationAsync(item.id);
      setData(current => current?.filter(row => row.id !== item.id) ?? []); setNotice('Reminder cancelled');
    } catch { setActionError('We couldn’t confirm cancellation. Refresh to check whether the reminder is still active.'); }
    finally { setPending(false); }
  }
  return <View style={ui.stack}><Text style={ui.heading}>My reminders</Text><Text style={ui.meta}>Reminders saved from this device.</Text>
    {loading && !data ? <Loading /> : null}{error ? <Notice error title="Couldn't load reminders" action="Retry" onAction={reload} /> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={ui.badge}>{notice}</Text> : null}
    {actionError && !editor ? <Notice error title="Reminder not updated" body={actionError} /> : null}
    {data?.map(item => <Card key={item.id}><View style={ui.row}><View style={ui.icon}><Icon name="bell" color={palette.teal} size={22} /></View><View style={ui.flex}>{item.merchantName ? <Text style={ui.meta}>{item.merchantName}</Text> : null}<Text style={ui.title}>{item.title}</Text></View></View>
      <Text style={ui.body}>{item.source === 'device' ? item.date ? new Date(item.date).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Scheduled on this phone' : item.leadMinutes === 1440 ? '1 day before the offer opens' : `${item.leadMinutes === 60 ? '1 hour' : '30 minutes'} before the offer opens`}</Text>
      <Text style={ui.meta}>{item.source === 'device' ? 'Reminder on this phone' : 'Offer opening reminder'}</Text>
      {item.unavailable ? <Text style={[ui.body, { color: palette.danger }]}>We couldn’t check this reminder. Refresh to try again.</Text> : null}
      <View style={[ui.row, { flexWrap: 'wrap' }]}><Action label="Change" disabled={pending} onPress={() => open(item)} /><Action label="Cancel reminder" disabled={pending} onPress={() => Alert.alert('Cancel this reminder?', item.title, [{ text: 'Keep reminder', style: 'cancel' }, { text: 'Cancel reminder', style: 'destructive', onPress: () => void cancel(item) }])} />{item.merchantSlug ? <Action label="View offer" onPress={() => router.push(`/merchants/${item.merchantSlug}`)} /> : null}</View>
    </Card>)}
    {!loading && !error && data?.length === 0 ? <Notice title="No upcoming reminders" body="Tap the bell on an offer to remember it later." action="Explore offers" onAction={() => router.push('/offers')} /> : null}
    <Modal visible={!!editor} transparent animationType="slide" onRequestClose={() => { if (!pending) setEditor(null); }}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0007' }}><Pressable accessibilityRole="button" accessibilityLabel="Close reminder editor" disabled={pending} style={{ flex: 1 }} onPress={() => setEditor(null)} /><View accessibilityViewIsModal style={{ backgroundColor: '#fff', padding: 24, paddingBottom: Math.max(24, insets.bottom), borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 12 }}>
      <Text style={ui.heading}>Change reminder</Text><Text style={ui.body}>{editor?.title}</Text>
      {([30, 60, 1440] as const).map(value => <Pressable accessibilityRole="radio" accessibilityState={{ checked: lead === value }} disabled={pending} key={value} onPress={() => setLead(value)} style={[ui.row, { minHeight: 48 }]}><Icon name={lead === value ? 'check-circle' : 'circle'} color={palette.teal} size={22} /><Text style={ui.body}>{editor?.source === 'service' || editor?.openingAt ? `${value === 1440 ? '1 day' : value === 60 ? '1 hour' : '30 minutes'} before opening` : `In ${value === 1440 ? '1 day' : value === 60 ? '1 hour' : '30 minutes'}`}</Text></Pressable>)}
      {actionError ? <Text accessibilityLiveRegion="polite" style={[ui.body, { color: palette.danger }]}>{actionError}</Text> : null}
      {actionError && editor?.source === 'device' ? <Action label="Notification settings" onPress={() => { void Linking.openSettings(); }} /> : null}
      <Action primary label={pending ? 'Saving…' : 'Save reminder'} disabled={pending} onPress={save} /><Action label="Keep current reminder" disabled={pending} onPress={() => setEditor(null)} />
    </View></View></Modal>
  </View>;
}
