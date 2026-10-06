// POST /api/v1/vouchers/loyalty/:templateId/claim — loyalty-offer claim
// confirm screen. Unlike the funded-offer claim screen, this one needs no
// network call to load: eligible/alreadyClaimed/progress/claimFriction all
// arrive via route params from the card tap, since they're already in the
// Vouchers tab's loaded GET /api/v1/me/voucher-state overlay.
import { useCallback, useMemo, useState } from 'react';
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
import type { ClaimFriction, LoyaltyClaimResult, LoyaltyQualificationOutcome, VoucherUsePlan } from '@/contracts';
import { MilesAmount } from '@/components/miles-amount';
import { ClaimIntentSection } from '@/components/claim-intent';

// Loyalty offers carry no per-offer claimFriction of their own — it's the
// same member-wide friction every claim type shares, so it's read from the
// Vouchers tab's voucher-state overlay and passed through as a param, same
// as every other display field this screen needs.
const DEFAULT_FRICTION: ClaimFriction = {
  expiredUnusedCount: 0,
  activeUnusedCount: 0,
  redeemedCount: 0,
  requiresUsePlan: false,
};

function progressLabel(outcome: LoyaltyQualificationOutcome): string {
  if (outcome.type === 'merchant_purchase_count') {
    return `${outcome.actual ?? 0} of ${outcome.minimum} purchases`;
  }
  return `KES ${(outcome.actual ?? 0).toLocaleString('en-KE')} of ${outcome.minimum.toLocaleString('en-KE')} spent`;
}

type ScreenState =
  | { status: 'idle' }
  | { status: 'claiming' }
  | { status: 'success'; result: LoyaltyClaimResult }
  | { status: 'error'; message: string };

export default function LoyaltyOfferClaimScreen() {
  const {
    templateId,
    title,
    merchantName,
    benefit,
    customerCopy,
    acquisitionMode,
    milesCost,
    eligible,
    alreadyClaimed,
    progress,
    claimFriction,
  } = useLocalSearchParams<{
    templateId: string;
    title?: string;
    merchantName?: string;
    benefit?: string;
    customerCopy?: string;
    acquisitionMode?: string;
    milesCost?: string;
    eligible?: string;
    alreadyClaimed?: string;
    progress?: string;
    claimFriction?: string;
  }>();
  const { accessToken } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'idle' });
  const [intentConfirmed, setIntentConfirmed] = useState(false);
  const [usePlan, setUsePlan] = useState<VoucherUsePlan | null>(null);

  const parsedProgress = useMemo<LoyaltyQualificationOutcome[]>(() => {
    if (!progress) return [];
    try {
      return JSON.parse(progress) as LoyaltyQualificationOutcome[];
    } catch {
      return [];
    }
  }, [progress]);

  const friction = useMemo<ClaimFriction>(() => {
    if (!claimFriction) return DEFAULT_FRICTION;
    try {
      return JSON.parse(claimFriction) as ClaimFriction;
    } catch {
      return DEFAULT_FRICTION;
    }
  }, [claimFriction]);

  const isEligible = eligible === 'true';
  const isAlreadyClaimed = alreadyClaimed === 'true';
  const canConfirm = intentConfirmed && (!friction.requiresUsePlan || usePlan != null);

  const confirmClaim = useCallback(async () => {
    if (!accessToken) return;
    setState({ status: 'claiming' });
    try {
      const result = await createApiClient({ accessToken }).claimLoyaltyOffer(templateId, {
        intentConfirmed,
        usePlan: usePlan ?? undefined,
      });
      setState({ status: 'success', result });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
    }
  }, [accessToken, templateId, intentConfirmed, usePlan]);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Claim offer' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
        style={styles.screen}>
        {!accessToken ? (
          <Card style={styles.card}>
            <Text style={styles.body}>Sign in to claim this offer.</Text>
          </Card>
        ) : state.status === 'error' ? (
          <Card style={styles.card}>
            <Text style={styles.body}>{state.message}</Text>
            <Button onPress={() => setState({ status: 'idle' })} style={styles.primaryButton}>
              <Text style={styles.primaryLabel}>Retry</Text>
            </Button>
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
        ) : isAlreadyClaimed ? (
          <Card style={styles.card}>
            <Badge label="Claimed" tone="muted" />
            <Text style={styles.body}>You&apos;ve already claimed this offer.</Text>
          </Card>
        ) : (
          <View style={styles.content}>
            <Card style={styles.card}>
              {benefit ? <Text style={styles.benefit}>{benefit}</Text> : null}
              {title ? (
                <Text style={styles.title} numberOfLines={2}>
                  {title}
                </Text>
              ) : null}
              {merchantName ? <Text style={styles.body}>{merchantName}</Text> : null}
              {acquisitionMode === 'miles' && milesCost ? (
                <MilesAmount amount={Number(milesCost)} color={colors.teal} size="lg" />
              ) : null}
            </Card>

            {!isEligible ? (
              <Card style={styles.card}>
                <Badge label="Locked" tone="muted" />
                {customerCopy ? <Text style={styles.body}>{customerCopy}</Text> : null}
                {parsedProgress.map((outcome) => (
                  <Text key={outcome.type} style={styles.meta}>
                    {progressLabel(outcome)}
                  </Text>
                ))}
              </Card>
            ) : (
              <>
                <Card style={styles.card}>
                  <ClaimIntentSection
                    friction={friction}
                    intentConfirmed={intentConfirmed}
                    onIntentConfirmedChange={setIntentConfirmed}
                    usePlan={usePlan}
                    onUsePlanChange={setUsePlan}
                  />
                </Card>

                <Button
                  disabled={state.status === 'claiming' || !canConfirm}
                  onPress={confirmClaim}
                  style={[
                    styles.primaryButton,
                    (state.status === 'claiming' || !canConfirm) && styles.primaryButtonDisabled,
                  ]}>
                  {state.status === 'claiming' ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.primaryLabel}>
                      {acquisitionMode === 'free' ? 'Claim free offer' : 'Claim offer'}
                    </Text>
                  )}
                </Button>
              </>
            )}
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
  content: {
    gap: spacing.lg,
  },
  card: {
    gap: spacing.sm,
  },
  benefit: {
    color: colors.ink,
    fontFamily: fontFamily.serif,
    fontSize: typography.title,
    fontWeight: '700',
  },
  title: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.body,
    fontWeight: '600',
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
