// Native port of hub-page's /me/settings. Wallet rows are intentionally
// omitted: Akiba Pass mobile is web2-only; every other current Hub group is
// represented with the same hierarchy and editable profile fields.
import { useCallback, useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createApiClient, ApiRequestError } from '@/api';
import { supabase, useAuth } from '@/auth';
import type { MobileSettings } from '@/contracts';
import { ActivityIndicator, Icon, ListGroup, ListRow, ScrollView, colors, fontFamily } from '@/design-system';

type ScreenState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: MobileSettings };
type Editor = 'username' | 'phone' | 'location' | 'security' | null;
const HELP_LINKS = [
  { icon: 'external-link' as const, label: 'Contact support', description: 'hello@akibamiles.com', url: 'mailto:hello@akibamiles.com' },
  { icon: 'shield' as const, label: 'Privacy policy', url: 'https://app.akibamiles.com/privacy-policy' },
  { icon: 'shield' as const, label: 'Terms of use', url: 'https://app.akibamiles.com/terms-of-use' },
];

export default function SettingsScreen() {
  const { accessToken, signOut } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  const load = useCallback(async () => {
    if (!accessToken) return setState({ status: 'error', message: 'Sign in to view settings.' });
    try { setState({ status: 'ready', data: await createApiClient({ accessToken }).getSettings() }); }
    catch (error) { setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' }); }
  }, [accessToken]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page} style={styles.screen}>
      <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Icon name="arrow-left" size={16} color={colors.muted} /><Text style={styles.backText}>Back to profile</Text></Pressable>
      <View style={styles.heading}><Text style={styles.title}>Settings</Text><Text style={styles.subtitle}>Manage your profile, sign-in and preferences.</Text></View>
      {state.status === 'loading' ? <View style={styles.centered}><ActivityIndicator color={colors.teal} /></View>
        : state.status === 'error' ? <ErrorState message={state.message} onRetry={load} />
          : <SettingsContent accessToken={accessToken} initial={state.data} onSignOut={signOut} />}
    </ScrollView>
  </>;
}

function SettingsContent({ accessToken, initial, onSignOut }: { accessToken: string | null; initial: MobileSettings; onSignOut: () => void }) {
  const [data, setData] = useState(initial);
  const [editor, setEditor] = useState<Editor>(null);
  const profile = data.profile;
  const identity = profile.username ? `@${profile.username}` : profile.displayName;
  const initials = (profile.username ?? profile.displayName).replace(/^@/, '').split(/[\s._-]+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'AK';
  const location = [profile.city, profile.country].filter(Boolean).join(', ') || 'Add your location';
  return <View style={styles.content}>
    <View style={styles.profileCard}><View style={styles.avatar}>{profile.avatarUrl ? <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} contentFit="cover" /> : <Text style={styles.avatarInitial}>{initials}</Text>}</View><View style={styles.flex}><Text style={styles.identity} numberOfLines={1}>{identity}</Text>{profile.email ? <Text style={styles.meta} numberOfLines={1}>{profile.email}</Text> : null}</View></View>

    <SettingsSection title="Profile details"><ListRow icon="at-sign" label="Username" description={profile.username ? `@${profile.username}` : 'Choose a username'} onPress={() => setEditor('username')} /><ListRow icon="phone" label="Phone number" description={profile.phone ?? 'Add a phone number'} onPress={() => setEditor('phone')} /><ListRow icon="map-pin" label="Location" description={location} onPress={() => setEditor('location')} /></SettingsSection>
    <SettingsSection title="Notifications"><ListRow icon="bell" label="Notifications" description="Reward and account updates" onPress={() => Linking.openSettings()} /></SettingsSection>
    <SettingsSection title="Account & security"><ListRow icon="mail" label="Email" description={profile.email ?? 'No email on this account'} showChevron={false} /><ListRow icon="lock" label="Security" description="Password & sign-in" onPress={() => setEditor('security')} /></SettingsSection>
    <SettingsSection title="Help & legal">{HELP_LINKS.map((link) => <ListRow key={link.label} icon={link.icon} label={link.label} description={link.description} onPress={() => Linking.openURL(link.url)} />)}</SettingsSection>
    <ListGroup><ListRow icon="log-out" label="Sign out" variant="danger" showChevron={false} onPress={onSignOut} /></ListGroup>
    <EditSheet editor={editor} profile={profile} accessToken={accessToken} onClose={() => setEditor(null)} onSaved={(patch) => setData((current) => ({ profile: { ...current.profile, ...patch } }))} />
  </View>;
}

function SettingsSection({ children, title }: { children: React.ReactNode; title: string }) { return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><ListGroup>{children}</ListGroup></View>; }

function EditSheet({ accessToken, editor, onClose, onSaved, profile }: { accessToken: string | null; editor: Editor; onClose: () => void; onSaved: (patch: Partial<MobileSettings['profile']>) => void; profile: MobileSettings['profile'] }) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // The sheet remains mounted so Modal can animate; opening a different
    // field deliberately resets its draft from the latest saved profile.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (editor === 'username') setDraft(profile.username ?? '');
    else if (editor === 'phone') setDraft(profile.phone ?? '');
    else if (editor === 'location') setCity(profile.city ?? '');
    else setDraft('');
    setError(null);
  }, [editor, profile.city, profile.phone, profile.username]);
  const titles = { username: 'Akiba username', phone: 'Phone number', location: 'Location', security: 'Security' } as const;
  const save = async () => {
    if (!editor || !accessToken) return;
    setSaving(true); setError(null);
    try {
      if (editor === 'security') {
        if (draft.length < 8) throw new Error('Use at least 8 characters.');
        const { error: authError } = await supabase.auth.updateUser({ password: draft });
        if (authError) throw authError;
      } else {
        const input = editor === 'username' ? { username: draft.trim().toLowerCase() } : editor === 'phone' ? { phone: draft.trim() } : { country: 'Kenya', city: city.trim() };
        const result = await createApiClient({ accessToken }).updateSettings(input);
        onSaved(editor === 'username' ? { username: result.username ?? draft.trim().toLowerCase() } : editor === 'phone' ? { phone: result.phone ?? null } : { country: 'Kenya', city: result.city ?? null });
      }
      onClose();
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.body && typeof caught.body === 'object' && 'error' in caught.body) {
        const value = (caught.body as { error?: { message?: string } }).error?.message; setError(value ?? 'Could not save your changes.');
      } else setError(caught instanceof Error ? caught.message : 'Could not save your changes.');
    } finally { setSaving(false); }
  };
  if (!editor) return null;
  const usernameValid = /^[a-z0-9_]{3,20}$/.test(draft.trim().toLowerCase());
  const canSave = editor === 'username' ? usernameValid : editor === 'location' ? true : editor === 'security' ? draft.length >= 8 : Boolean(draft.trim());
  return <Modal animationType="slide" onRequestClose={onClose} transparent visible>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.scrim}>
      <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.handle} /><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{titles[editor]}</Text><Pressable onPress={onClose} style={styles.close}><Icon name="x" size={20} color={colors.ink} /></Pressable></View>
        {editor === 'username' ? <><Text style={styles.sheetCopy}>Your identity across Akiba. Use 3–20 lowercase letters, numbers or underscores.</Text><View style={styles.prefixedInput}><Text style={styles.prefix}>@</Text><TextInput autoCapitalize="none" maxLength={20} onChangeText={setDraft} placeholder="username" placeholderTextColor="#8B8888" style={styles.inputBare} value={draft} /></View>{draft.length > 0 && !usernameValid ? <Text style={styles.validation}>3–20 lowercase letters, numbers or underscores.</Text> : null}</>
          : editor === 'phone' ? <><Text style={styles.sheetCopy}>Used for order updates and future reward matching. Verification is coming soon.</Text><TextInput keyboardType="phone-pad" onChangeText={setDraft} placeholder="e.g. 0712 345 678" placeholderTextColor="#8B8888" style={styles.input} value={draft} /></>
            : editor === 'location' ? <><Text style={styles.sheetCopy}>Akiba Pass is currently available in Kenya. Add your city to surface nearby places.</Text><View style={styles.fixedCountry}><Text style={styles.fieldLabel}>Country</Text><Text style={styles.fixedCountryValue}>Kenya</Text></View><Text style={styles.fieldLabel}>City (optional)</Text><TextInput autoCapitalize="words" onChangeText={setCity} placeholder="e.g. Nairobi" placeholderTextColor="#8B8888" style={styles.input} value={city} /></>
              : <><Text style={styles.sheetCopy}>Set a password for email sign-in. Use at least 8 characters.</Text><TextInput autoCapitalize="none" onChangeText={setDraft} placeholder="New password" placeholderTextColor="#8B8888" secureTextEntry style={styles.input} value={draft} /></>}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable disabled={!canSave || saving} onPress={save} style={({ pressed }) => [styles.save, (!canSave || saving) && styles.saveDisabled, pressed && styles.pressed]}>{saving ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.saveText}>{editor === 'security' ? 'Set password' : 'Save changes'}</Text>}</Pressable>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <View style={styles.errorState}><Text style={styles.meta}>{message}</Text><Pressable onPress={onRetry} style={styles.retry}><Text style={styles.saveText}>Retry</Text></Pressable></View>; }

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.paper }, page: { alignSelf: 'center', maxWidth: 720, paddingBottom: 36, paddingHorizontal: 16, width: '100%' }, back: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 6, minHeight: 44, paddingRight: 12 }, backText: { color: colors.muted, fontFamily: fontFamily.sansMedium, fontSize: 14 }, pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] }, heading: { marginBottom: 24, marginTop: 4 }, title: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 30 }, subtitle: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, marginTop: 4 }, centered: { alignItems: 'center', minHeight: 420, justifyContent: 'center' }, content: { gap: 28 }, flex: { flex: 1 },
  profileCard: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 16, padding: 16 }, avatar: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 999, height: 64, justifyContent: 'center', overflow: 'hidden', width: 64 }, avatarImage: { height: '100%', width: '100%' }, avatarInitial: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 18 }, identity: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 18 }, meta: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, marginTop: 2 }, section: { gap: 11 }, sectionTitle: { color: colors.muted, fontFamily: fontFamily.sansSemiBold, fontSize: 12, letterSpacing: 0.7, textTransform: 'uppercase' },
  scrim: { backgroundColor: 'rgba(13,14,12,0.42)', flex: 1, justifyContent: 'flex-end' }, sheet: { backgroundColor: colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 8 }, handle: { alignSelf: 'center', backgroundColor: colors.line, borderRadius: 99, height: 4, width: 42 }, sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14, marginTop: 8 }, sheetTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 23 }, close: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 }, sheetCopy: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 18, marginBottom: 13 }, input: { borderColor: colors.line, borderRadius: 12, borderWidth: 1, color: colors.ink, fontFamily: fontFamily.sans, fontSize: 14, minHeight: 48, paddingHorizontal: 14 }, prefixedInput: { alignItems: 'center', borderColor: colors.line, borderRadius: 12, borderWidth: 1, flexDirection: 'row', minHeight: 48, paddingHorizontal: 14 }, prefix: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14 }, inputBare: { color: colors.ink, flex: 1, fontFamily: fontFamily.sans, fontSize: 14, minHeight: 46, paddingLeft: 5 }, validation: { color: colors.danger, fontFamily: fontFamily.sans, fontSize: 11, marginTop: 6 }, fieldLabel: { color: colors.muted, fontFamily: fontFamily.sansMedium, fontSize: 11, marginBottom: 6, marginTop: 8 }, fixedCountry: { marginBottom: 5 }, fixedCountryValue: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: 12, borderWidth: 1, color: colors.ink, fontFamily: fontFamily.sansMedium, fontSize: 14, overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 14 }, errorText: { backgroundColor: colors.dangerTint, borderRadius: 8, color: colors.danger, fontFamily: fontFamily.sans, fontSize: 12, marginTop: 10, padding: 10 }, save: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, justifyContent: 'center', marginTop: 16, minHeight: 48 }, saveDisabled: { opacity: 0.45 }, saveText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 14 }, errorState: { alignItems: 'center', minHeight: 360, justifyContent: 'center' }, retry: { backgroundColor: colors.teal, borderRadius: 999, marginTop: 14, paddingHorizontal: 20, paddingVertical: 11 },
});
