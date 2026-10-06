// Native port of hub-page's current /me screen.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView as HorizontalScrollView, StyleSheet, Text, View } from 'react-native';

import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { MilesAmount } from '@/components/miles-amount';
import type { ActivityItem, MobileOverview, OwnedVoucherPreview, SavedMerchant, VerifiedDiscoveryHighlight } from '@/contracts';
import { ActivityIndicator, Icon, ScrollView, colors, fontFamily, shadows } from '@/design-system';

type ScreenState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: MobileOverview };

export default function ProfileScreen() {
  const { accessToken } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  const load = useCallback(async () => {
    try { setState({ status: 'ready', data: await createApiClient({ accessToken }).getOverview() }); }
    catch (error) { setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' }); }
  }, [accessToken]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page} style={styles.screen}>
      {state.status === 'loading' ? <View style={styles.centered}><ActivityIndicator color={colors.teal} /></View>
        : state.status === 'error' ? <ErrorState message={state.message} onRetry={load} />
          : <ProfileContent data={state.data} />}
    </ScrollView>
  );
}

function ProfileContent({ data }: { data: MobileOverview }) {
  const { profile, balance, stats, activity, savedMerchants, verifiedPlaces, voucherPreview } = data;
  const identity = profile.username ? `@${profile.username}` : profile.displayName;
  const initials = getInitials(profile.displayName || profile.username || 'A');
  const location = [profile.city, profile.country].filter(Boolean).join(', ') || 'Location not set';
  return <View>
    <View style={styles.hero}>
      <Text style={styles.heroEyebrow}>MY AKIBA</Text>
      <Pressable accessibilityLabel="Open settings" onPress={() => router.push('/profile/settings')} style={({ pressed }) => [styles.settings, pressed && styles.pressed]}><Icon name="settings" size={20} color={colors.ink} /></Pressable>
      <View style={styles.avatar}>{profile.avatarUrl ? <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} contentFit="cover" transition={160} /> : <Text style={styles.avatarInitials}>{initials}</Text>}</View>
      <Text style={styles.identity}>{identity}</Text>
      {profile.email ? <Text style={styles.email}>{profile.email}</Text> : null}
      <View style={styles.location}><Icon name="map-pin" size={13} color={colors.muted} /><Text style={styles.locationText}>{location}</Text></View>
    </View>

    <View style={styles.stats}>
      <Stat label="Available Miles">{balance.hasBalance ? <MilesAmount amount={balance.balance} /> : <Text style={styles.statValue}>—</Text>}</Stat>
      <View style={styles.statDivider} />
      <Stat label="Places visited"><Text style={styles.statValue}>{stats.placesVisited.toLocaleString('en-KE')}</Text></Stat>
      <View style={styles.statDivider} />
      <Stat label="Rewards used"><Text style={styles.statValue}>{stats.rewardsUsed.toLocaleString('en-KE')}</Text></Stat>
    </View>

    <Section title="My vouchers" subtitle="Your active Akiba rewards" action={voucherPreview.totalCount ? () => router.push('/vouchers') : undefined}>
      {voucherPreview.items.length ? voucherPreview.items.map((item) => <VoucherRow key={item.id} item={item} />) : <Empty icon="tag" title="No vouchers yet" body="Explore rewards from Akiba merchants and your vouchers will appear here." />}
    </Section>

    <Section title="Saved places" subtitle="Merchants you want to remember" action={savedMerchants.length ? () => router.push('/merchants') : undefined} edge>
      {savedMerchants.length ? <HorizontalScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedRail}>{savedMerchants.map((merchant) => <SavedCard key={merchant.id} merchant={merchant} />)}</HorizontalScrollView> : <View style={styles.sectionPad}><Empty icon="bookmark" title="Nothing saved yet" body="Tap the bookmark on any merchant to keep it close." /></View>}
    </Section>

    <Section title="Places worth a visit" subtitle="From verified Akiba visits">
      {verifiedPlaces.length ? verifiedPlaces.map((highlight) => <VerifiedCard key={highlight.merchantId} highlight={highlight} />) : <Empty icon="check-circle" title="Recommendations are coming" body="Verified community favourites will appear here." />}
    </Section>

    <Section title="Recent activity" subtitle="Your latest Miles and rewards">
      <View style={styles.activityGroup}>{activity.length ? activity.map((item, index) => <ActivityRow key={item.id} item={item} last={index === activity.length - 1} />) : <Empty icon="activity" title="No activity yet" body="Your Akiba activity will show up here." />}</View>
    </Section>
  </View>;
}

function Stat({ children, label }: { children: ReactNode; label: string }) { return <View style={styles.stat}><View style={styles.statMain}>{children}</View><Text style={styles.statLabel}>{label}</Text></View>; }
function Section({ action, children, edge, subtitle, title }: { action?: () => void; children: ReactNode; edge?: boolean; subtitle: string; title: string }) { return <View style={styles.section}><View style={styles.sectionHeader}><View style={styles.flex}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text></View>{action ? <Pressable onPress={action} style={styles.viewAll}><Text style={styles.viewAllText}>View all</Text><Icon name="chevron-right" size={14} color={colors.ink} /></Pressable> : null}</View><View style={!edge && styles.sectionPad}>{children}</View></View>; }

function VoucherRow({ item }: { item: OwnedVoucherPreview }) {
  const expiry = item.expiresAt ? new Date(item.expiresAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : null;
  return <Pressable onPress={() => router.push(`/vouchers/${item.id}`)} style={({ pressed }) => [styles.voucher, pressed && styles.pressed]}><View style={styles.voucherStripe} /><View style={styles.logo}>{item.merchantLogoUrl ? <Image source={{ uri: item.merchantLogoUrl }} style={styles.logoImage} contentFit="contain" /> : <Icon name="shopping-bag" size={20} color={colors.muted} />}</View><View style={styles.flex}><View style={styles.voucherMetaRow}><Text style={styles.merchantLabel} numberOfLines={1}>{item.merchantName}</Text><Text style={styles.status}>{item.status}</Text></View><Text style={styles.voucherValue}>{item.valueLabel}</Text><Text style={styles.voucherTitle} numberOfLines={1}>{item.title}</Text>{expiry ? <Text style={styles.expiry}>Expires {expiry}</Text> : null}</View><Icon name="chevron-right" size={18} color={colors.muted} /></Pressable>;
}

function SavedCard({ merchant }: { merchant: SavedMerchant }) { return <Pressable onPress={() => router.push(`/merchants/${merchant.slug}`)} style={({ pressed }) => [styles.savedCard, pressed && styles.pressed]}><View style={styles.savedMedia}>{merchant.bannerUrl ? <Image source={{ uri: merchant.bannerUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : merchant.logoUrl ? <Image source={{ uri: merchant.logoUrl }} style={styles.savedLogo} contentFit="contain" /> : <Text style={styles.savedInitial}>{merchant.name.charAt(0)}</Text>}<View style={styles.savedBadge}><Icon name="bookmark" size={13} color={colors.teal} /></View></View><Text style={styles.savedName} numberOfLines={2}>{merchant.name}</Text><Text style={styles.savedHint}>Saved place</Text></Pressable>; }

function VerifiedCard({ highlight }: { highlight: VerifiedDiscoveryHighlight }) {
  const count = highlight.verifiedRecommendationBand.kind === 'exact' ? `${highlight.verifiedRecommendationBand.count} verified recommendations` : 'New verified recommendation';
  const reason = highlight.recommendedItems[0] ?? highlight.lovedLabels[0] ?? 'Recommended after a verified visit';
  return <Pressable onPress={() => router.push(`/merchants/${highlight.merchantSlug}`)} style={({ pressed }) => [styles.verifiedCard, pressed && styles.pressed]}><Image source={{ uri: highlight.photo.thumbnailUrl }} style={styles.verifiedPhoto} contentFit="cover" /><View style={styles.verifiedBody}><View style={styles.verifiedBadge}><Icon name="check-circle" size={13} color={colors.teal} /><Text style={styles.verifiedBadgeText}>Verified visit</Text></View><Text style={styles.verifiedName} numberOfLines={1}>{highlight.merchantName}</Text><Text style={styles.verifiedReason} numberOfLines={2}>{reason}</Text><Text style={styles.verifiedCount}>{count}</Text></View></Pressable>;
}

function ActivityRow({ item, last }: { item: ActivityItem; last: boolean }) { const positive = (item.miles ?? 0) > 0; return <View style={[styles.activityRow, !last && styles.activityBorder]}><View style={styles.activityIcon}><Icon name={activityIcon(item.kind)} size={17} color={colors.teal} /></View><View style={styles.flex}><Text style={styles.activityTitle}>{item.title}</Text><Text style={styles.activityMeta} numberOfLines={1}>{item.detail ? `${item.detail} · ` : ''}{relativeTime(item.ts)}</Text></View>{item.miles != null && item.miles !== 0 ? <View style={[styles.activityMilesPill, !positive && styles.activityMilesPillSpent]}><MilesAmount amount={Math.abs(item.miles)} color={positive ? colors.teal : colors.muted} prefix={positive ? '+' : '−'} /></View> : null}</View>; }
function Empty({ body, icon, title }: { body: string; icon: 'tag' | 'bookmark' | 'check-circle' | 'activity'; title: string }) { return <View style={styles.empty}><View style={styles.emptyIcon}><Icon name={icon} size={24} color={colors.teal} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <View style={styles.error}><Text style={styles.emptyTitle}>Profile temporarily unavailable</Text><Text style={styles.emptyBody}>{message}</Text><Pressable onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable></View>; }
function getInitials(value: string) { return value.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join(''); }
function relativeTime(ts: number) { const delta = Date.now() - ts; const days = Math.floor(delta / 86_400_000); if (days > 0) return days === 1 ? 'Yesterday' : `${days} days ago`; const hours = Math.floor(delta / 3_600_000); if (hours > 0) return `${hours}h ago`; return 'Just now'; }
function activityIcon(kind: ActivityItem['kind']): 'gift' | 'shopping-bag' | 'award' | 'zap' { if (kind === 'voucher_grant' || kind === 'voucher_redeem') return 'gift'; if (kind === 'merchant_award') return 'shopping-bag'; if (kind === 'miles_spent') return 'award'; return 'zap'; }

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.paper }, page: { alignSelf: 'center', maxWidth: 760, paddingBottom: 28, width: '100%' }, centered: { alignItems: 'center', minHeight: 520, justifyContent: 'center' }, flex: { flex: 1 }, pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  hero: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 32, borderWidth: 1, margin: 16, paddingBottom: 30, paddingHorizontal: 20, paddingTop: 20, position: 'relative' }, heroEyebrow: { color: colors.teal, fontFamily: fontFamily.sansBold, fontSize: 11, letterSpacing: 1.7 }, settings: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 999, height: 42, justifyContent: 'center', position: 'absolute', right: 14, top: 14, width: 42 }, avatar: { alignItems: 'center', backgroundColor: colors.teal, borderColor: colors.white, borderRadius: 999, borderWidth: 4, height: 96, justifyContent: 'center', marginTop: 18, overflow: 'hidden', width: 96 }, avatarImage: { height: '100%', width: '100%' }, avatarInitials: { color: colors.white, fontFamily: fontFamily.sterlingSemiBold, fontSize: 31 }, identity: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 25, marginTop: 12 }, email: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, marginTop: 3 }, location: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 7 }, locationText: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12 },
  stats: { ...shadows.chip, alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 17, borderWidth: 1, flexDirection: 'row', marginHorizontal: 24, marginTop: -30, minHeight: 90, paddingVertical: 14 }, stat: { alignItems: 'center', flex: 1, paddingHorizontal: 4 }, statMain: { alignItems: 'center', minHeight: 27, justifyContent: 'center' }, statValue: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 21 }, statLabel: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 10, marginTop: 4, textAlign: 'center' }, statDivider: { backgroundColor: colors.line, height: 40, width: 1 },
  section: { marginTop: 30 }, sectionHeader: { alignItems: 'flex-end', flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12 }, sectionTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 21 }, sectionSubtitle: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, marginTop: 2 }, sectionPad: { gap: 10, paddingHorizontal: 16 }, viewAll: { alignItems: 'center', flexDirection: 'row', minHeight: 38 }, viewAllText: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 12 },
  voucher: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 126, overflow: 'hidden', padding: 14, paddingLeft: 19 }, voucherStripe: { backgroundColor: colors.teal, bottom: 0, left: 0, position: 'absolute', top: 0, width: 5 }, logo: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, height: 48, justifyContent: 'center', padding: 6, width: 48 }, logoImage: { height: '100%', width: '100%' }, voucherMetaRow: { alignItems: 'center', flexDirection: 'row', gap: 8 }, merchantLabel: { color: colors.muted, flex: 1, fontFamily: fontFamily.sansSemiBold, fontSize: 10, textTransform: 'uppercase' }, status: { backgroundColor: colors.tint, borderRadius: 999, color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 9, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2, textTransform: 'uppercase' }, voucherValue: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 20, marginTop: 7 }, voucherTitle: { color: colors.ink, fontFamily: fontFamily.sansMedium, fontSize: 13, marginTop: 1 }, expiry: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 10, marginTop: 4 },
  savedRail: { gap: 10, paddingHorizontal: 16 }, savedCard: { backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, overflow: 'hidden', paddingBottom: 12, width: 176 }, savedMedia: { alignItems: 'center', backgroundColor: colors.card, height: 98, justifyContent: 'center', position: 'relative' }, savedLogo: { height: 58, width: 98 }, savedInitial: { color: colors.teal, fontFamily: fontFamily.sterlingSemiBold, fontSize: 32 }, savedBadge: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 999, height: 30, justifyContent: 'center', position: 'absolute', right: 8, top: 8, width: 30 }, savedName: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 14, lineHeight: 18, marginHorizontal: 12, marginTop: 10 }, savedHint: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 10, marginHorizontal: 12, marginTop: 2 },
  verifiedCard: { backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, flexDirection: 'row', minHeight: 120, overflow: 'hidden' }, verifiedPhoto: { width: 112 }, verifiedBody: { flex: 1, justifyContent: 'center', padding: 13 }, verifiedBadge: { alignItems: 'center', flexDirection: 'row', gap: 4 }, verifiedBadgeText: { color: colors.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 10, textTransform: 'uppercase' }, verifiedName: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 18, marginTop: 6 }, verifiedReason: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 17, marginTop: 2 }, verifiedCount: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 10, marginTop: 5 },
  activityGroup: { backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, overflow: 'hidden' }, activityRow: { alignItems: 'center', flexDirection: 'row', gap: 11, minHeight: 76, marginHorizontal: 14, paddingVertical: 12 }, activityBorder: { borderBottomColor: colors.line, borderBottomWidth: 1 }, activityIcon: { alignItems: 'center', backgroundColor: colors.tint, borderRadius: 999, height: 40, justifyContent: 'center', width: 40 }, activityTitle: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 13 }, activityMeta: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 11, marginTop: 2 }, activityMilesPill: { backgroundColor: colors.tint, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }, activityMilesPillSpent: { backgroundColor: colors.card },
  empty: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderCurve: 'continuous', borderRadius: 16, borderWidth: 1, padding: 28 }, emptyIcon: { alignItems: 'center', backgroundColor: colors.tint, borderRadius: 999, height: 48, justifyContent: 'center', width: 48 }, emptyTitle: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 18, marginTop: 10, textAlign: 'center' }, emptyBody: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 18, marginTop: 3, textAlign: 'center' }, error: { alignItems: 'center', margin: 16, padding: 40 }, retry: { backgroundColor: colors.teal, borderRadius: 999, marginTop: 14, paddingHorizontal: 20, paddingVertical: 11 }, retryText: { color: colors.white, fontFamily: fontFamily.sansSemiBold },
});
