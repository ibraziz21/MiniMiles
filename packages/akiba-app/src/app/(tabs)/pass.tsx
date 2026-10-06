// GET /api/v1/me/pass — stable pass ID only. The rotating presentation
// token (preferred while online, per the migration plan's offline-pass
// model) depends on POST /api/v1/me/pass/token, which doesn't exist yet.
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'react-native-qrcode-svg';

import {
  ActivityIndicator,
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
import { ProfileButton } from '@/components/profile-button';
import type { MobilePass } from '@/contracts';

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: MobilePass };

// Same brand color/correction level as the web QR (src/lib/akiba/passQr.ts).
const QR_DARK = '#0D3349';
const QR_LIGHT = '#FFFFFF';

export default function PassScreen() {
  const { accessToken } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const client = createApiClient({ accessToken });
      const data = await client.getPass();
      setState({ status: 'ready', data });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
    }
  }, [accessToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    load();
  }, [load]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.scrollContent}
      style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.screenHeader}>
          <Text style={styles.screenTitle}>Pass</Text>
          <ProfileButton />
        </View>

        {state.status === 'loading' ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.teal} />
          </View>
        ) : state.status === 'error' ? (
          <Card style={styles.card}>
            <Text style={styles.title}>Pass</Text>
            <Text style={styles.body}>{state.message}</Text>
            <Button onPress={retry} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Button>
          </Card>
        ) : (
          <Card style={styles.card}>
            <Text style={styles.title}>{state.data.displayName}</Text>
            <Text style={styles.body}>{state.data.email}</Text>
            <View style={styles.qrWrap}>
              <QRCode value={state.data.qrPayload} size={220} color={QR_DARK} backgroundColor={QR_LIGHT} ecl="M" />
            </View>
            <Text style={styles.hint}>Show this at participating merchants to earn AkibaMiles.</Text>
          </Card>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.paper,
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  content: {
    alignSelf: 'center',
    gap: spacing.md,
    maxWidth: 520,
    width: '100%',
  },
  centered: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  screenHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  screenTitle: {
    color: colors.ink,
    fontFamily: fontFamily.sterlingSemiBold,
    fontSize: 28,
    lineHeight: 34,
  },
  card: {
    alignItems: 'center',
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
  qrWrap: {
    backgroundColor: colors.tint,
    borderRadius: radius.md,
    marginVertical: spacing.lg,
    padding: spacing.lg,
  },
  hint: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
    textAlign: 'center',
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
