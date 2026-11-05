import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Image } from 'expo-image';

import {
  ActivityIndicator,
  Badge,
  Button,
  Card,
  Icon,
  ScrollView,
  StyleSheet,
  Text,
  View,
  colors,
  fontFamily,
  radius,
  spacing,
  typography,
} from '@/design-system';
import { useAuth } from '@/auth';
import { createApiClient } from '@/api';
import type { FundedClaimResult, FundedEligibility, FundedOffer } from '@/contracts';
import { ClaimIntentSection } from '@/components/claim-intent';

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'eligible'; eligibility: FundedEligibility }
  | { status: 'ineligible'; eligibility: FundedEligibility }
  | { status: 'already-claimed'; eligibility: FundedEligibility }
  | { status: 'claiming'; eligibility: FundedEligibility }
  | { status: 'success'; result: FundedClaimResult };

const REQUIREMENT_COPY: Record<string, string> = {
  username_required: 'Choose an Akiba username to claim this offer.',
  profile_country_required: 'Set your profile country to claim this offer.',
  profile_country_mismatch: 'This offer is only available to members in a different country.',
};

type FundedOfferClaimProps = {
  allocationId: string;
  title?: string;
  merchantName?: string;
  benefit?: string;
  minimumSpendKes?: string;
  terms?: string | null;
  sheetOffer?: FundedOffer;
  claimDeadline?: string | null;
  onClaimed?: () => void;
  onViewClaimed?: () => void;
  onViewVoucher: (voucherId: string) => void;
};

export function FundedOfferClaim({
  allocationId, title, merchantName, benefit, minimumSpendKes, terms, sheetOffer, claimDeadline, onClaimed, onViewClaimed, onViewVoucher,
}: FundedOfferClaimProps) {
  const { accessToken } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  const [intentConfirmed, setIntentConfirmed] = useState(false);
  const claimInFlight = useRef(false);

  const load = useCallback(async () => {
    if (!accessToken) {
      setState({ status: 'error', message: 'Sign in to claim this offer.' });
      return;
    }
    try {
      const eligibility = await createApiClient({ accessToken }).getFundedEligibility(allocationId);
      if (eligibility.alreadyClaimed) setState({ status: 'already-claimed', eligibility });
      else if (eligibility.eligible) setState({ status: 'eligible', eligibility });
      else setState({ status: 'ineligible', eligibility });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
    }
  }, [allocationId, accessToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const retry = useCallback(() => {
    setIntentConfirmed(false);
    setState({ status: 'loading' });
    load();
  }, [load]);

  const confirmClaim = useCallback(
    async (eligibility: FundedEligibility) => {
      if (!accessToken || claimInFlight.current) return;
      claimInFlight.current = true;
      setState({ status: 'claiming', eligibility });
      try {
        const result = await createApiClient({ accessToken }).claimFundedOffer(allocationId, {
          intentConfirmed,
        });
        setState({ status: 'success', result });
        onClaimed?.();
      } catch (error) {
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
      } finally {
        claimInFlight.current = false;
      }
    },
    [accessToken, allocationId, intentConfirmed, onClaimed],
  );

  const ready = state.status === 'eligible' || state.status === 'claiming';
  const locked = state.status === 'claiming' || !intentConfirmed;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior={sheetOffer ? "never" : "automatic"}
        alwaysBounceVertical={sheetOffer ? false : undefined}
        contentContainerStyle={[styles.scrollContent, sheetOffer && styles.sheetContent]}
        style={[styles.screen, sheetOffer && styles.sheetScreen]}>
        {state.status !== 'success' && sheetOffer ? (
          <SheetOfferSummary offer={sheetOffer} merchantName={merchantName} benefit={benefit} ready={ready} claimDeadline={claimDeadline} />
        ) : state.status !== 'success' && (title || merchantName || benefit) ? (
          <Card style={styles.card}>
            {merchantName ? <Text style={styles.body}>{merchantName}</Text> : null}
            {benefit || title ? <Text style={styles.title}>{benefit || title}</Text> : null}
            {title && benefit && title !== benefit ? <Text style={styles.body}>{title}</Text> : null}
            {minimumSpendKes && Number(minimumSpendKes) > 0 ? (
              <Text style={styles.meta}>Min. spend KES {Number(minimumSpendKes).toLocaleString('en-KE')}</Text>
            ) : null}
            <Text style={styles.meta}>No AkibaMiles needed</Text>
            {terms ? <Text style={styles.meta}>{terms}</Text> : null}
          </Card>
        ) : null}
        {state.status === 'loading' ? (
          <View style={styles.checking}>
            <ActivityIndicator color={colors.tealDark} />
            <View accessibilityLiveRegion="polite" style={styles.sheetIdentity}>
              <Text style={styles.checkingLabel}>Checking eligibility…</Text>
              <Text style={styles.factDetail}>We’re checking the voucher rules and your account.</Text>
            </View>
          </View>
        ) : state.status === 'error' ? (
          <Card style={styles.card}>
            <Text style={styles.body}>{state.message}</Text>
            <Button onPress={retry} style={styles.primaryButton}>
              <Text style={styles.primaryLabel}>Retry</Text>
            </Button>
          </Card>
        ) : state.status === 'already-claimed' ? (
          <Card style={styles.card}>
            <Badge label="Claimed" tone="muted" />
            <Text style={styles.body}>You&apos;ve already claimed this offer.</Text>
            {onViewClaimed ? <Button onPress={onViewClaimed}><Text style={styles.body}>Go to My vouchers</Text></Button> : null}
          </Card>
        ) : state.status === 'ineligible' ? (
          <Card style={styles.card}>
            <Badge label="Locked" tone="muted" />
            {!state.eligibility.allocationAvailable ? <Text style={styles.body}>This offer is unavailable to claim right now.</Text> : null}
            {state.eligibility.requirementsRemaining.map((code) => (
              <Text key={code} style={styles.body}>
                {REQUIREMENT_COPY[code] ?? code}
              </Text>
            ))}
          </Card>
        ) : state.status === 'success' ? (
          <Card style={styles.card}>
            <Badge label={state.result.idempotent ? 'Claimed' : 'Complete'} tone="teal" />
            <Text style={styles.title}>{state.result.idempotent ? 'Already claimed' : 'Offer claimed'}</Text>
            <Button
              onPress={() => onViewVoucher(state.result.voucherId)}
              style={styles.primaryButton}>
              <Text style={styles.primaryLabel}>View voucher</Text>
            </Button>
          </Card>
        ) : (
          <View style={sheetOffer ? styles.sheetControls : styles.content}>
            <Card style={sheetOffer ? styles.sheetIntentCard : styles.card}>
              <ClaimIntentSection
                sheet={Boolean(sheetOffer)}
                intentConfirmed={intentConfirmed}
                onIntentConfirmedChange={setIntentConfirmed}
              />
            </Card>

            <Button
              disabled={locked}
              onPress={() => confirmClaim(state.eligibility)}
              style={[
                styles.primaryButton,
                sheetOffer && styles.sheetConfirm,
                locked && (sheetOffer ? styles.sheetConfirmDisabled : styles.primaryButtonDisabled),
              ]}>
              {state.status === 'claiming' ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Text style={[styles.primaryLabel, sheetOffer && locked && styles.sheetConfirmLabelDisabled]}>Confirm claim</Text>
                  {sheetOffer ? <Icon name="arrow-right" size={17} color={locked ? colors.muted : colors.white} /> : null}
                </>
              )}
            </Button>
          </View>
        )}
      </ScrollView>
    </>
  );
}

function SheetOfferSummary({ offer, merchantName, benefit, ready, claimDeadline }: {
  offer: FundedOffer;
  merchantName?: string;
  benefit?: string;
  ready: boolean;
  claimDeadline?: string | null;
}) {
  const [termsOpen, setTermsOpen] = useState(false);
  const image = (offer.merchants?.length ?? 0) > 1 ? null : offer.merchant.imageUrl;
  const seconds = offer.voucherValiditySeconds;
  const validity = seconds && seconds > 0
    ? seconds % 86400 === 0 ? `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`
      : seconds % 3600 === 0 ? `${seconds / 3600} hr` : seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`
    : null;
  const schedule = offer.redemptionSchedule;
  const timing = [
    validity ? `Valid for ${schedule?.endDate ? 'up to ' : ''}${validity} after claiming` : null,
    schedule?.startDate && schedule.endDate ? `Use from ${schedule.startDate} to ${schedule.endDate}` : null,
    offer.redemptionSchedule?.days.length ? `Use on ${offer.redemptionSchedule.days.map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ')}` : null,
    claimDeadline,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <View style={styles.sheetHero}>
        <View style={styles.sheetImage}>
          {image ? <Image source={{ uri: image }} contentFit="contain" style={StyleSheet.absoluteFill} /> : <Icon name="shopping-bag" size={25} color={colors.tealDark} />}
        </View>
        <View style={styles.sheetIdentity}>
          {merchantName ? <Text style={styles.sheetMerchant}>{merchantName}</Text> : null}
          {benefit ? <Text style={styles.sheetBenefit}>{benefit}</Text> : null}
          {offer.title && offer.title !== benefit ? <Text style={styles.sheetSubtitle}>{offer.title}</Text> : null}
        </View>
      </View>
      {ready ? (
        <View style={styles.verified}>
          <Icon name="check-circle" size={18} color={colors.tealDark} />
          <Text accessibilityLiveRegion="polite" style={styles.factLabel}>Eligibility verified</Text>
        </View>
      ) : null}
      <View style={styles.factList}>
        {offer.minimumSpendKes > 0 ? <SheetFact icon="credit-card" label={`Minimum spend: KES ${offer.minimumSpendKes.toLocaleString('en-KE')}`} /> : null}
        {timing ? <SheetFact icon="clock" label="Redemption window" detail={timing} /> : null}
        <SheetFact icon="award" label="No AkibaMiles needed" detail="Free voucher" />
        {offer.terms ? (
          <>
            <Button accessibilityRole="button" accessibilityState={{ expanded: termsOpen }} onPress={() => setTermsOpen(!termsOpen)} style={styles.termsButton}>
              <Text style={styles.factLabel}>Terms</Text>
              <Icon name={termsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.tealDark} />
            </Button>
            {termsOpen ? <Text style={styles.factDetail}>{offer.terms}</Text> : null}
          </>
        ) : null}
      </View>
    </>
  );
}

function SheetFact({ icon, label, detail }: { icon: ComponentProps<typeof Icon>['name']; label: string; detail?: string }) {
  return (
    <View style={styles.fact}>
      <View style={styles.factIcon}><Icon name={icon} size={16} color={colors.tealDark} /></View>
      <View style={styles.sheetIdentity}>
        <Text style={styles.factLabel}>{label}</Text>
        {detail ? <Text style={styles.factDetail}>{detail}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetScreen: { backgroundColor: colors.white },
  sheetContent: { gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  sheetControls: { gap: 12 },
  sheetHero: { alignItems: 'center', flexDirection: 'row', gap: 8, padding: 8, borderRadius: 12, backgroundColor: colors.tint },
  sheetImage: { alignItems: 'center', justifyContent: 'center', height: 40, width: 40, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.white },
  sheetIdentity: { flex: 1, minWidth: 0, gap: 2 },
  sheetMerchant: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
  sheetSubtitle: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 11, lineHeight: 14 },
  sheetBenefit: { color: colors.tealDark, fontFamily: fontFamily.sansBold, fontSize: 16 },
  verified: { alignItems: 'center', flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, backgroundColor: '#D1FAE5' },
  factList: { gap: 6 },
  fact: { alignItems: 'center', flexDirection: 'row', gap: 8, padding: 9, borderColor: colors.line, borderWidth: 1, borderRadius: 10 },
  factIcon: { alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 16, backgroundColor: colors.tint },
  termsButton: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 10 },
  factLabel: { color: colors.ink, fontFamily: fontFamily.sansMedium, fontSize: 14 },
  factDetail: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 17 },
  sheetIntentCard: { padding: 0, borderWidth: 0, backgroundColor: colors.white, elevation: 0, shadowOpacity: 0, boxShadow: 'none' },
  sheetConfirm: { flexDirection: 'row', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: 14, backgroundColor: colors.tealDark },
  sheetConfirmDisabled: { backgroundColor: colors.tint },
  sheetConfirmLabelDisabled: { color: colors.muted },
  screen: {
    backgroundColor: colors.paper,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  checking: { alignItems: 'center', flexDirection: 'row', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.teal, backgroundColor: colors.tint },
  checkingLabel: { color: colors.tealDark, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
  content: {
    gap: spacing.lg,
  },
  card: {
    gap: spacing.sm,
  },
  title: {
    color: colors.ink,
    fontFamily: fontFamily.serif,
    fontSize: typography.title,
    fontWeight: '700',
  },
  body: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.body,
  },
  meta: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.teal,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryLabel: {
    color: colors.white,
    fontFamily: fontFamily.sansBold,
    fontSize: typography.body,
    fontWeight: '700',
  },
});
