import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Modal, useWindowDimensions } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { ActivityIndicator, Badge, Card, Icon, PrimaryButton, ScrollView, StyleSheet, Text, TextButton, View, colors, fontFamily, radius } from '@/design-system';
import { useAuth } from '@/auth';
import { createApiClient } from '@/api';
import type { VoucherDetail, VoucherEntitlement } from '@/contracts/owned-vouchers';
import { isScreenshotModeEnabled } from '@/fixtures/screenshot-commerce';
import { createVoucherPresentationController, type PresentationView } from '@/lib/voucher-presentation';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; detail: VoucherDetail };
const formatDate = (value: string) => new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' });
const money = (value: number) => `KES ${value.toLocaleString('en-KE')}`;
function benefit(detail: VoucherDetail, e?: VoucherEntitlement) {
  if ((e?.voucherType ?? detail.voucherType) === 'percent_off') return `${e?.discountPercent ?? detail.discountPercent ?? 0}% off${e?.maximumDiscountKes != null ? `, up to ${money(e.maximumDiscountKes)}` : ''}`;
  if ((e?.voucherType ?? detail.voucherType) === 'fixed_off') return e?.discountKes != null ? `${money(e.discountKes)} off` : detail.discountCusd != null ? `$${detail.discountCusd} off` : 'Your discount';
  return e?.retailValueKes != null ? `Free item, up to ${money(e.retailValueKes)}` : detail.title ?? 'Free item';
}
function resolvedStatus(detail: VoucherDetail) {
  return ['issued', 'pending', 'claiming'].includes(detail.status) && detail.expiresAt && Date.parse(detail.expiresAt) <= Date.now() ? 'expired' : detail.status;
}
export default function VoucherDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <><Stack.Screen options={{ headerShown: true, title: 'Your voucher', headerBackTitle: 'Rewards' }} /><VoucherContent key={id} id={id} /></>;
}
function VoucherContent({ id }: { id: string }) {
  const { accessToken } = useAuth();
  const { width } = useWindowDimensions();
  const api = useMemo(() => createApiClient({ accessToken }), [accessToken]);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [presentation, setPresentation] = useState<PresentationView>({ kind: 'closed' });
  const [now, setNow] = useState(() => Date.now());
  const sample = isScreenshotModeEnabled() && id.startsWith('screenshot-voucher-');
  const controller = useMemo(() => createVoucherPresentationController({ issue: () => api.getVoucherPresentation(id), revoke: () => api.revokeVoucherPresentation(id) }, setPresentation), [api, id]);
  const load = useCallback(async (valid: () => boolean = () => true) => {
    try {
      const detail = await api.getVoucherDetail(id);
      if (valid()) setState({ kind: 'ready', detail });
    } catch (error) {
      if (valid()) setState({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to load voucher' });
    }
  }, [api, id]);
  useFocusEffect(useCallback(() => {
    let focused = true;
    void load(() => focused);
    return () => { focused = false; controller.close(); };
  }, [load, controller]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (value) => { if (value !== 'active') controller.close(); });
    return () => sub.remove();
  }, [controller]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const detail = state.kind === 'ready' ? state.detail : null;
  const status = detail ? resolvedStatus(detail) : null;
  useEffect(() => { if (status && status !== 'issued') controller.close(); }, [status, controller]);
  const live = presentation.kind === 'ready' && Date.parse(presentation.data.expires_at) > now;
  const seconds = presentation.kind === 'ready' ? Math.max(0, Math.ceil((Date.parse(presentation.data.expires_at) - now) / 1000)) : 0;
  useEffect(() => {
    if (presentation.kind === 'ready' && seconds === 0 && status === 'issued') controller.open();
  }, [presentation, seconds, status, controller]);
  useEffect(() => {
    if (presentation.kind !== 'ready') return;
    let disposed = false;
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const next = await api.getVoucherPresentationStatus(id);
        if (!disposed && next.voucher_status !== 'issued') {
          controller.close();
          setState((current) => current.kind === 'ready' ? { kind: 'ready', detail: { ...current.detail, status: next.voucher_status } } : current);
        }
      } catch {
        // Fail closed: a QR must not stay visible if current status cannot be checked.
        if (!disposed) { controller.close(); setPresentation({ kind: 'error', message: 'Could not confirm voucher status. Try again when connected.' }); }
      } finally { checking = false; }
    }, 3000);
    return () => { disposed = true; clearInterval(timer); };
  }, [presentation, api, id, controller]);
  const entitlement = presentation.kind === 'ready' ? presentation.data.entitlement : detail?.entitlement;
  const expiry = entitlement?.timing.expiresAt ?? detail?.expiresAt;
  const minimumSpend = entitlement?.minimumSpendKes;
  const schedule = entitlement?.redemptionSchedule ?? detail?.redemptionSchedule;
  const preparing = status === 'pending' || status === 'claiming';
  const statusLabel = status === 'issued' ? 'Ready' : status === 'redeemed' ? 'Used' : status === 'expired' ? 'Expired' : preparing ? 'Preparing' : 'Unavailable';
  const merchantName = detail?.merchantName ?? entitlement?.merchants[0]?.name ?? 'AkibaMiles';
  const voucherBenefit = detail ? benefit(detail, entitlement) : null;
  const qrSize = Math.min(272, width - 104);
  const closeQr = () => controller.close();

  return (
    <>
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.page} contentContainerStyle={styles.scroll}>
        {state.kind === 'loading' ? <ActivityIndicator color={colors.teal} /> : null}
        {state.kind === 'error' ? (
          <Card style={styles.conditions}>
            <Text accessibilityRole="alert" style={styles.body}>{state.message}</Text>
            <PrimaryButton label="Try again" onPress={() => void load()} />
          </Card>
        ) : null}
        {detail ? (
          <>
            <View style={styles.ticket}>
              <View style={styles.hero}>
                <View style={styles.topRow}>
                  <View style={styles.mark}><Icon name="gift" size={22} color={colors.tealDark} /></View>
                  <Text style={styles.merchant}>{merchantName}</Text>
                  <Badge label={statusLabel} tone={status === 'issued' ? 'teal' : 'muted'} />
                </View>
                <Text accessibilityRole="header" style={styles.benefit}>{voucherBenefit}</Text>
                {detail.title && detail.title !== voucherBenefit ? <Text style={styles.body}>{detail.title}</Text> : null}
              </View>
              <View style={styles.tear}><View style={styles.notch} /><View style={styles.dashes} /><View style={styles.notch} /></View>
              <View style={styles.redeem}>
                {status === 'redeemed' && detail.redeemedAt ? <Text style={styles.body}>Used {formatDate(detail.redeemedAt)}</Text> : null}
                {expiry && (status === 'issued' || status === 'expired') ? (
                  <View style={styles.fact}>
                    <Icon name="clock" size={16} color={colors.muted} />
                    <Text style={styles.body}>{status === 'expired' ? 'Expired' : 'Use by'} {formatDate(expiry)}</Text>
                  </View>
                ) : null}
                {status === 'issued' && minimumSpend != null && minimumSpend > 0 ? (
                  <Text style={styles.body}>Min. spend {money(minimumSpend)}</Text>
                ) : null}
                {status === 'issued' && schedule?.days.length ? (
                  <Text style={styles.body}>Use on {schedule.days.map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ')}</Text>
                ) : null}
                {status === 'issued' ? (
                  <PrimaryButton label="Show QR" onPress={() => controller.open()} />
                ) : status === 'expired' ? (
                  <TextButton label="Browse offers" onPress={() => router.push('/offers')} />
                ) : status === 'redeemed' ? null : (
                  <>
                    <Text style={styles.body}>{preparing ? 'Your voucher is being prepared.' : 'This voucher is unavailable.'}</Text>
                    <TextButton label="Refresh status" onPress={() => void load()} />
                  </>
                )}
              </View>
            </View>
            <Card style={styles.conditions}>
              <Text accessibilityRole="header" style={styles.section}>Where to use it</Text>
              {entitlement?.merchants.length ? (
                <>
                  <Text style={styles.body}>{entitlement.merchantCount > 1 ? `Use once at any of ${entitlement.merchantCount} participating places.` : 'Use once at this place.'}</Text>
                  {entitlement.merchants.map((merchant) => <Text key={merchant.id || merchant.slug} style={styles.place}>{merchant.name}</Text>)}
                </>
              ) : <Text style={styles.body}>{detail.merchantName ?? 'Place details unavailable'}</Text>}
              {entitlement?.merchantsIncomplete ? <Text style={styles.body}>Some participating place details are unavailable.</Text> : null}
            </Card>
            <Card style={styles.conditions}>
              <Text accessibilityRole="header" style={styles.section}>Voucher terms</Text>
              {minimumSpend != null && minimumSpend > 0 ? <Text style={styles.body}>Minimum purchase {money(minimumSpend)}</Text> : null}
              {entitlement?.applicableCategory ? <Text style={styles.body}>On {entitlement.applicableCategory.replaceAll('_', ' ')}</Text> : null}
              {entitlement?.linkedProductId ? <Text style={styles.body}>Selected items only</Text> : null}
              {schedule?.days.length ? <Text style={styles.body}>Use on {schedule.days.map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ')} ({schedule.timezone})</Text> : null}
              {entitlement?.redemptionSchedule?.startDate && entitlement.redemptionSchedule.endDate ? (
                <Text style={styles.body}>Valid {entitlement.redemptionSchedule.startDate} – {entitlement.redemptionSchedule.endDate}</Text>
              ) : null}
              <Text style={styles.body}>{entitlement?.terms ?? 'Present your voucher at checkout. The business validates it before applying the benefit.'}</Text>
            </Card>
          </>
        ) : null}
      </ScrollView>

      {status === 'issued' && presentation.kind !== 'closed' ? (
        <Modal animationType="fade" transparent onRequestClose={closeQr}>
          <View style={styles.qrBackdrop}>
            <ScrollView contentContainerStyle={styles.qrScroll} keyboardShouldPersistTaps="handled">
              <View accessibilityViewIsModal style={styles.qrPanel}>
                <Text style={styles.qrMerchant}>{merchantName}</Text>
                <Text accessibilityRole="header" style={styles.section}>{voucherBenefit}</Text>
                <Text style={styles.qrHint}>Show this to the cashier before paying.</Text>
                {live && presentation.kind === 'ready' ? (
                  <>
                    <View style={styles.qr} accessible accessibilityLabel={sample ? 'Sample voucher QR. Not valid for redemption.' : 'Voucher redemption QR.'}>
                      <QRCode value={presentation.data.token} size={qrSize} ecl="M" color="#0D3349" backgroundColor={colors.white} />
                    </View>
                    <Text style={styles.refresh}>{sample ? 'Sample QR for preview only' : `QR refreshes in ${seconds}s`}</Text>
                  </>
                ) : presentation.kind === 'error' ? (
                  <>
                    <Text accessibilityRole="alert" style={styles.error}>{presentation.message}</Text>
                    <PrimaryButton label="Try again" onPress={() => controller.open()} />
                  </>
                ) : (
                  <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.body}>Preparing your QR…</Text></View>
                )}
                <TextButton label="Close QR" onPress={closeQr} />
              </View>
            </ScrollView>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.paper },
  scroll: { alignSelf: 'center', gap: 12, maxWidth: 600, padding: 16, paddingBottom: 32, width: '100%' },
  ticket: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  hero: { backgroundColor: colors.tint, gap: 10, padding: 18 },
  topRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  mark: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 12, height: 38, justifyContent: 'center', width: 38 },
  merchant: { color: colors.ink, flex: 1, fontFamily: fontFamily.sansSemiBold, fontSize: 15 },
  benefit: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 34, lineHeight: 40 },
  body: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20 },
  fact: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  tear: { alignItems: 'center', backgroundColor: colors.white, flexDirection: 'row', height: 16, marginHorizontal: -8 },
  notch: { backgroundColor: colors.paper, borderColor: colors.line, borderRadius: 8, borderWidth: 1, height: 16, width: 16 },
  dashes: { borderColor: colors.line, borderStyle: 'dashed', borderTopWidth: 1, flex: 1 },
  redeem: { gap: 8, padding: 18, paddingTop: 8 },
  section: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 17 },
  place: { color: colors.ink, fontFamily: fontFamily.sansMedium, fontSize: 14 },
  conditions: { gap: 7 },
  qrBackdrop: { backgroundColor: 'rgba(0,0,0,0.62)', flex: 1 },
  qrScroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  qrPanel: { alignSelf: 'center', backgroundColor: colors.white, borderRadius: 24, gap: 12, maxWidth: 400, padding: 20, width: '100%' },
  qrMerchant: { color: colors.tealDark, fontFamily: fontFamily.sansSemiBold, fontSize: 13 },
  qrHint: { color: colors.ink, fontFamily: fontFamily.sans, fontSize: 15, lineHeight: 21 },
  qr: { alignSelf: 'center', backgroundColor: colors.white, padding: 8 },
  refresh: { color: colors.tealDark, fontFamily: fontFamily.sansMedium, fontSize: 13, textAlign: 'center' },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  error: { color: colors.danger, fontFamily: fontFamily.sans, fontSize: 14 },
});
