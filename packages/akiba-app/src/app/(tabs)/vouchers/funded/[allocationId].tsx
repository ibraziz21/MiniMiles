// GET /api/v1/vouchers/funded/:allocationId/eligibility → POST .../claim —
// funded-offer claim confirm screen. allocationId/title/merchantName/
// discountKes/minimumSpendKes are passed as route params by the caller
// (FundedOfferCard) since the eligibility response carries no display
// metadata.
import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';

import {
  ActivityIndicator,
  Badge,
  Button,
  Card,
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
import type { FundedClaimResult, FundedEligibility, VoucherUsePlan } from '@/contracts';
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

export default function FundedOfferClaimScreen() {
  const { allocationId, title, merchantName, discountKes, minimumSpendKes } = useLocalSearchParams<{
    allocationId: string;
    title?: string;
    merchantName?: string;
    discountKes?: string;
    minimumSpendKes?: string;
  }>();
  const { accessToken } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  const [intentConfirmed, setIntentConfirmed] = useState(false);
  const [usePlan, setUsePlan] = useState<VoucherUsePlan | null>(null);

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
    setUsePlan(null);
    setState({ status: 'loading' });
    load();
  }, [load]);

  const confirmClaim = useCallback(
    async (eligibility: FundedEligibility) => {
      if (!accessToken) return;
      setState({ status: 'claiming', eligibility });
      try {
        const result = await createApiClient({ accessToken }).claimFundedOffer(allocationId, {
          intentConfirmed,
          usePlan: usePlan ?? undefined,
        });
        setState({ status: 'success', result });
      } catch (error) {
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
      }
    },
    [accessToken, allocationId, intentConfirmed, usePlan],
  );

  const canConfirm = (eligibility: FundedEligibility) =>
    intentConfirmed && (!eligibility.claimFriction.requiresUsePlan || usePlan != null);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Claim offer' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
        style={styles.screen}>
        {state.status === 'loading' ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.teal} />
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
          </Card>
        ) : state.status === 'ineligible' ? (
          <Card style={styles.card}>
            <Badge label="Locked" tone="muted" />
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
              onPress={() => router.replace(`/vouchers/${state.result.voucherId}`)}
              style={styles.primaryButton}>
              <Text style={styles.primaryLabel}>View voucher</Text>
            </Button>
          </Card>
        ) : (
          <View style={styles.content}>
            <Card style={styles.card}>
              {title ? (
                <Text style={styles.title} numberOfLines={2}>
                  {title}
                </Text>
              ) : null}
              {merchantName ? <Text style={styles.body}>{merchantName}</Text> : null}
              {discountKes && minimumSpendKes ? (
                <Text style={styles.meta}>
                  KES {Number(discountKes).toLocaleString('en-KE')} off orders over KES{' '}
                  {Number(minimumSpendKes).toLocaleString('en-KE')}
                </Text>
              ) : null}
            </Card>

            <Card style={styles.card}>
              <ClaimIntentSection
                friction={state.eligibility.claimFriction}
                intentConfirmed={intentConfirmed}
                onIntentConfirmedChange={setIntentConfirmed}
                usePlan={usePlan}
                onUsePlanChange={setUsePlan}
              />
            </Card>

            <Button
              disabled={state.status === 'claiming' || !canConfirm(state.eligibility)}
              onPress={() => confirmClaim(state.eligibility)}
              style={[
                styles.primaryButton,
                (state.status === 'claiming' || !canConfirm(state.eligibility)) && styles.primaryButtonDisabled,
              ]}>
              {state.status === 'claiming' ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryLabel}>Claim offer</Text>
              )}
            </Button>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.paper,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  centered: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
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
