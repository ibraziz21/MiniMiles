import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
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
import type { MobilePass, PassPresentation } from '@/contracts';

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: MobilePass };

type PresentationState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PassPresentation };

// Same brand color/correction level as the web QR (src/lib/akiba/passQr.ts).
const QR_DARK = '#0D3349';
const QR_LIGHT = '#FFFFFF';

export default function PassScreen() {
  const { accessToken } = useAuth();
  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  const [presentation, setPresentation] = useState<PresentationState>({ status: 'loading' });
  const presentationRequest = useRef<Promise<void> | null>(null);

  const load = useCallback(async () => {
    try {
      const client = createApiClient({ accessToken });
      const data = await client.getPass();
      setState({ status: 'ready', data });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });
    }
  }, [accessToken]);

  const refreshPresentation = useCallback(() => {
    if (presentationRequest.current) return presentationRequest.current;

    const request = (async () => {
      try {
        const data = await createApiClient({ accessToken }).getPassPresentation();
        setPresentation({ status: 'ready', data });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Live Pass is temporarily unavailable';
        setPresentation((current) => {
          if (current.status === 'ready' && Date.parse(current.data.expiresAt) > Date.now()) return current;
          return { status: 'error', message };
        });
      } finally {
        presentationRequest.current = null;
      }
    })();

    presentationRequest.current = request;
    return request;
  }, [accessToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    void refreshPresentation();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void refreshPresentation();
    });
    return () => subscription.remove();
  }, [refreshPresentation]);

  useEffect(() => {
    if (presentation.status !== 'ready') return;
    const refreshAt = Date.parse(presentation.data.expiresAt) - 30_000;
    const delay = Math.max(1_000, refreshAt - Date.now());
    const timer = setTimeout(() => void refreshPresentation(), delay);
    return () => clearTimeout(timer);
  }, [presentation, refreshPresentation]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setPresentation({ status: 'loading' });
    void load();
    void refreshPresentation();
  }, [load, refreshPresentation]);

  const errorMessage = state.status === 'error'
    ? state.message
    : presentation.status === 'error'
      ? presentation.message
      : null;
  const loading = state.status === 'loading' || presentation.status === 'loading';

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

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.teal} />
          </View>
        ) : errorMessage ? (
          <Card style={styles.card}>
            <Text style={styles.title}>Pass</Text>
            <Text style={styles.body}>{errorMessage}</Text>
            <Button onPress={retry} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Button>
          </Card>
        ) : state.status === 'ready' && presentation.status === 'ready' ? (
          <Card style={styles.card}>
            <Text style={styles.title}>{state.data.displayName}</Text>
            <Text style={styles.body}>{state.data.email}</Text>
            <View style={styles.qrWrap}>
              <QRCode value={presentation.data.token} size={220} color={QR_DARK} backgroundColor={QR_LIGHT} ecl="M" />
            </View>
            <Text style={styles.liveLabel}>LIVE PASS</Text>
            <Text style={styles.hint}>Show this at participating merchants to earn AkibaMiles. It refreshes automatically.</Text>
          </Card>
        ) : null}
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
  liveLabel: {
    color: colors.teal,
    fontFamily: fontFamily.sansBold,
    fontSize: typography.caption,
    fontWeight: '700',
    letterSpacing: 1.2,
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
