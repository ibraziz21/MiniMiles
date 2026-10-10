// GET /api/v1/me/vouchers/:id — self-only. The backend returns an
// identical, non-enumerating 404 for both "missing" and "not yours", so
// the client has nothing extra to distinguish here either — both surface
// through the same error state as any other failure.
import { useCallback, useEffect, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';

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
import type { VoucherDetail } from '@/contracts';
import { MilesAmount } from '@/components/miles-amount';

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: VoucherDetail };

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function VoucherDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accessToken } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'loading' });

  const load = useCallback(async () => {
    if (!accessToken) {
      setState({ status: 'error', message: 'Sign in to view this voucher.' });
      return;
    }
    try {
      const detail = await createApiClient({ accessToken }).getVoucherDetail(id);
      setState({ status: 'ready', detail });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
    }
  }, [id, accessToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    load();
  }, [load]);

  const title = state.status === 'ready' ? state.detail.title ?? 'Voucher' : 'Voucher';

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title }} />
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
            <Button onPress={retry} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Button>
          </Card>
        ) : (
          <VoucherDetailContent detail={state.detail} />
        )}
      </ScrollView>
    </>
  );
}

function VoucherDetailContent({ detail }: { detail: VoucherDetail }) {
  const status = effectiveVoucherStatus(detail.status, detail.expiresAt);
  const createdAt = formatDate(detail.createdAt);
  const expiresAt = formatDate(detail.expiresAt);
  const redeemedAt = formatDate(detail.redeemedAt);

  return (
    <View style={styles.content}>
      <Card style={styles.card}>
        <Badge label={status} tone={status === 'issued' ? 'teal' : 'muted'} />
        {detail.merchantName ? <Text style={styles.body}>{detail.merchantName}</Text> : null}
        {detail.milesCost != null ? <MilesAmount amount={detail.milesCost} color={colors.teal} /> : null}
        {detail.discountPercent != null ? (
          <Text style={styles.meta}>{detail.discountPercent}% off</Text>
        ) : detail.discountCusd != null ? (
          <Text style={styles.meta}>${detail.discountCusd} off</Text>
        ) : null}
        {detail.applicableCategory ? <Text style={styles.meta}>{detail.applicableCategory}</Text> : null}
        {detail.programName ? <Text style={styles.meta}>{detail.programName}</Text> : null}
      </Card>

      <Card style={styles.card}>
        {createdAt ? <Text style={styles.meta}>Issued {createdAt}</Text> : null}
        {expiresAt ? <Text style={styles.meta}>{status === 'expired' ? 'Expired' : 'Expires'} {expiresAt}</Text> : null}
        {redeemedAt ? <Text style={styles.meta}>Redeemed {redeemedAt}</Text> : null}
      </Card>
    </View>
  );
}

function effectiveVoucherStatus(status: string, expiresAt: string | null) {
  if (!['issued', 'pending', 'claiming'].includes(status) || !expiresAt) return status;
  const expiryMs = Date.parse(expiresAt);
  return Number.isFinite(expiryMs) && expiryMs <= Date.now() ? 'expired' : status;
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
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.teal,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryLabel: {
    color: colors.white,
    fontFamily: fontFamily.sansBold,
    fontSize: typography.body,
    fontWeight: '700',
  },
});
