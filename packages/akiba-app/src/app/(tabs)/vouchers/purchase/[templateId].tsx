// POST /api/v1/vouchers/quote → POST /api/v1/vouchers/redeem — Miles-cost
// purchase confirm screen. templateId/title/merchantName/milesCost are
// passed as route params by the caller (VoucherTemplateCard / merchant
// detail's VoucherRow) since there's no "get one template" endpoint and the
// quote response itself carries no display metadata.
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
import type { VoucherQuote, VoucherRedemption, VoucherUsePlan } from '@/contracts';
import { MilesAmount } from '@/components/miles-amount';
import { ClaimIntentSection } from '@/components/claim-intent';

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; quote: VoucherQuote }
  | { status: 'redeeming'; quote: VoucherQuote }
  | { status: 'success'; redemption: VoucherRedemption };

export default function VoucherPurchaseScreen() {
  const { templateId, title, merchantName, milesCost } = useLocalSearchParams<{
    templateId: string;
    title?: string;
    merchantName?: string;
    milesCost?: string;
  }>();
  const { accessToken } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  const [intentConfirmed, setIntentConfirmed] = useState(false);
  const [usePlan, setUsePlan] = useState<VoucherUsePlan | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) {
      setState({ status: 'error', message: 'Sign in to purchase this voucher.' });
      return;
    }
    try {
      const quote = await createApiClient({ accessToken }).getVoucherQuote(templateId);
      setState({ status: 'ready', quote });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
    }
  }, [templateId, accessToken]);

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

  const confirmPurchase = useCallback(
    async (quote: VoucherQuote) => {
      if (!accessToken) return;
      setState({ status: 'redeeming', quote });
      try {
        const redemption = await createApiClient({ accessToken }).redeemVoucher({
          templateId,
          quoteId: quote.quoteId,
          intentConfirmed,
          usePlan: usePlan ?? undefined,
        });
        setState({ status: 'success', redemption });
      } catch (error) {
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
      }
    },
    [accessToken, templateId, intentConfirmed, usePlan],
  );

  const canConfirm = (quote: VoucherQuote) => intentConfirmed && (!quote.claimFriction.requiresUsePlan || usePlan != null);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Confirm purchase' }} />
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
        ) : state.status === 'success' ? (
          <Card style={styles.card}>
            <Badge label={state.redemption.queued ? 'Submitted' : 'Complete'} tone="teal" />
            <Text style={styles.title}>{state.redemption.queued ? 'Purchase submitted' : 'Purchase complete'}</Text>
            <Text style={styles.body}>Code: {state.redemption.voucher.code}</Text>
            <Button
              onPress={() => router.replace(`/vouchers/${state.redemption.voucher.id}`)}
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
              <MilesAmount amount={state.quote.totalPoints} color={colors.teal} size="lg" />
              {milesCost && Number(milesCost) !== state.quote.totalPoints ? (
                <Text style={styles.meta}>Price updated since you last viewed this voucher.</Text>
              ) : null}
            </Card>

            <Card style={styles.card}>
              <ClaimIntentSection
                friction={state.quote.claimFriction}
                intentConfirmed={intentConfirmed}
                onIntentConfirmedChange={setIntentConfirmed}
                usePlan={usePlan}
                onUsePlanChange={setUsePlan}
              />
            </Card>

            <Button
              disabled={state.status === 'redeeming' || !canConfirm(state.quote)}
              onPress={() => confirmPurchase(state.quote)}
              style={[
                styles.primaryButton,
                (state.status === 'redeeming' || !canConfirm(state.quote)) && styles.primaryButtonDisabled,
              ]}>
              {state.status === 'redeeming' ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryLabel}>Confirm purchase</Text>
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
