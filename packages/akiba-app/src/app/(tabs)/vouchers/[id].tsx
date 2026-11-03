import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { ActivityIndicator, Badge, Card, Icon, PrimaryButton, ScrollView, StyleSheet, Text, TextButton, View, colors, fontFamily, radius } from '@/design-system';
import { useAuth } from '@/auth';
import { createApiClient } from '@/api';
import type { VoucherDetail, VoucherEntitlement } from '@/contracts/owned-vouchers';
import { isScreenshotModeEnabled } from '@/fixtures/screenshot-commerce';
import { createVoucherPresentationController, type PresentationView } from '@/lib/voucher-presentation';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; detail: VoucherDetail };
const formatDate = (value: string) => new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
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
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.page} contentContainerStyle={styles.scroll}>
    {state.kind === 'loading' ? <ActivityIndicator color={colors.teal} /> : state.kind === 'error' ? <Card><Text accessibilityRole="alert" style={styles.body}>{state.message}</Text><PrimaryButton label="Try again" onPress={() => void load()} /></Card> : detail ? <>
      <View style={styles.ticket}>
        <View style={[styles.hero, live && styles.heroCompact]}>
          <View style={styles.topRow}><View style={styles.mark}><Icon name="gift" size={22} color={colors.tealDark} /></View><View style={styles.identity}><Text style={styles.merchant}>{detail.merchantName ?? 'AkibaMiles'}</Text><Text style={styles.small}>Your AkibaMiles voucher</Text></View><Badge label={status === 'issued' ? 'Ready' : status === 'redeemed' ? 'Used' : status ?? ''} tone={status === 'issued' ? 'teal' : 'muted'} /></View>
          <Text style={[styles.benefit, live && styles.benefitCompact]}>{benefit(detail, entitlement)}</Text>
          {detail.title !== benefit(detail, entitlement) ? <Text style={styles.body}>{detail.title}</Text> : null}
          <View style={styles.divider} />
          <View style={styles.fact}><Icon name="clock" size={17} color={colors.muted} /><Text style={styles.body}>{expiry ? `${status === 'expired' ? 'Expired' : 'Use by'} ${formatDate(expiry)}` : 'No expiry recorded'}</Text></View>
        </View>
        <View style={styles.tear}><View style={styles.notch} /><View style={styles.dashes} /><View style={styles.notch} /></View>
        <View style={styles.redeem}>
          
          {status === 'issued' ? <>
            {!live ? <><Text style={styles.section}>Ready for your next visit</Text><Text style={styles.body}>Show this voucher to the cashier before paying.</Text></> : null}
            {live && presentation.kind === 'ready' ? <>
              <View style={styles.qr} accessible accessibilityLabel={sample ? 'Sample voucher QR. Not valid for redemption.' : 'Voucher redemption QR. Show this to the cashier.'}><QRCode value={presentation.data.token} size={224} ecl="M" color="#0D3349" backgroundColor={colors.white} /></View>
              {!sample ? <Text style={styles.refresh}>{`QR refreshes in ${seconds}s`}</Text> : null}
              <TextButton label="Close QR" onPress={() => controller.close()} />
            </> : presentation.kind === 'loading' ? <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.body}>Preparing your QR…</Text><TextButton label="Cancel" onPress={() => controller.close()} /></View> : <>
              {presentation.kind === 'error' ? <Text accessibilityRole="alert" style={styles.error}>{presentation.message}</Text> : null}
              <PrimaryButton label="Show QR to redeem in store" onPress={() => controller.open()} />
            </>}
          </> : <><Icon name={status === 'redeemed' ? 'check-circle' : 'info'} size={30} color={colors.tealDark} /><Text style={styles.section}>{status === 'redeemed' ? 'Voucher redeemed' : status === 'expired' ? 'This voucher has expired' : ['pending', 'claiming'].includes(status ?? '') ? 'Your voucher is being prepared' : 'This voucher is unavailable'}</Text><Text style={styles.body}>{status === 'redeemed' ? 'This voucher has already been used.' : status === 'expired' ? 'Explore current offers for your next visit.' : 'Check back shortly for the latest status.'}</Text><TextButton label="Refresh status" onPress={() => void load()} /></>}
        </View>
      </View>
      <Card style={styles.conditions}><Text style={styles.section}>Where to use it</Text>{entitlement?.merchants.length ? <>{entitlement.merchants.map((merchant) => <Text key={merchant.id || merchant.slug} style={styles.body}>{merchant.name}</Text>)}<Text style={styles.small}>{entitlement.merchantCount > 1 ? `Use once at any of ${entitlement.merchantCount} participating merchants.` : 'One use at this merchant.'}</Text>{entitlement.merchantsIncomplete ? <Text style={styles.body}>Some participating merchant details are unavailable.</Text> : null}</> : <Text style={styles.body}>{detail.merchantName ?? 'Merchant details unavailable'}</Text>}
        <Text style={styles.section}>Good to know</Text>
        {entitlement?.minimumSpendKes != null && entitlement.minimumSpendKes > 0 ? <Text style={styles.body}>Minimum purchase {money(entitlement.minimumSpendKes)}</Text> : null}
        {entitlement?.applicableCategory ? <Text style={styles.body}>On {entitlement.applicableCategory.replaceAll('_', ' ')}</Text> : null}
        {entitlement?.linkedProductId ? <Text style={styles.body}>Selected items only</Text> : null}
        {entitlement?.redemptionSchedule ? <><Text style={styles.body}>Use on {entitlement.redemptionSchedule.days.map((day) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]).join(', ')} ({entitlement.redemptionSchedule.timezone})</Text>{entitlement.redemptionSchedule.startDate && entitlement.redemptionSchedule.endDate ? <Text style={styles.body}>Valid {entitlement.redemptionSchedule.startDate} – {entitlement.redemptionSchedule.endDate}</Text> : null}</> : null}
        <Text style={styles.body}>{entitlement?.terms ?? 'Present your voucher at checkout. The merchant validates it before applying the benefit.'}</Text>
        {detail.redeemedAt ? <Text style={styles.small}>Used {formatDate(detail.redeemedAt)}</Text> : null}
      </Card>
    </> : null}
  </ScrollView>;
}
const styles = StyleSheet.create({
 heroCompact:{padding:18,gap:10},benefitCompact:{fontSize:28,lineHeight:34},page:{backgroundColor:colors.paper},scroll:{padding:20,gap:20,paddingBottom:40},ticket:{borderRadius:radius.lg,backgroundColor:colors.white,borderWidth:1,borderColor:colors.line,overflow:'hidden'},hero:{backgroundColor:colors.tint,padding:24,gap:15},topRow:{flexDirection:'row',alignItems:'center',gap:10},identity:{flex:1,gap:3},mark:{width:42,height:42,borderRadius:14,backgroundColor:colors.white,alignItems:'center',justifyContent:'center'},merchant:{fontFamily:fontFamily.sansBold,fontSize:17,color:colors.ink},benefit:{fontFamily:fontFamily.sansBold,fontSize:34,lineHeight:40,color:colors.ink,marginTop:8},body:{fontFamily:fontFamily.sans,fontSize:15,lineHeight:22,color:colors.muted},small:{fontFamily:fontFamily.sans,fontSize:12,lineHeight:18,color:colors.muted},divider:{height:1,backgroundColor:colors.line},fact:{flexDirection:'row',alignItems:'center',gap:8},tear:{height:20,flexDirection:'row',alignItems:'center',backgroundColor:colors.white,marginHorizontal:-10},notch:{width:20,height:20,borderRadius:10,backgroundColor:colors.paper,borderWidth:1,borderColor:colors.line},dashes:{flex:1,borderTopWidth:1,borderStyle:'dashed',borderColor:colors.line},redeem:{padding:24,gap:14},section:{fontFamily:fontFamily.sansBold,fontSize:18,color:colors.ink},qr:{alignSelf:'center',padding:16,backgroundColor:colors.white,borderRadius:16,borderWidth:1,borderColor:colors.line},refresh:{fontFamily:fontFamily.sansMedium,fontSize:13,color:colors.tealDark,textAlign:'center'},sample:{fontFamily:fontFamily.sansMedium,fontSize:12,color:colors.muted},loading:{alignItems:'center',gap:12,paddingVertical:16},error:{fontFamily:fontFamily.sans,fontSize:14,color:colors.danger},conditions:{gap:12},
});
