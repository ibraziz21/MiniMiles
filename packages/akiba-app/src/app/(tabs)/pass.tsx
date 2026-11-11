import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import {
  ActivityIndicator,
  Badge,
  Icon,
  PrimaryButton,
  Card,
  ScrollView,
  StyleSheet,
  Text,
  View,
  colors,
  fontFamily,
  radius,
  spacing,
} from '@/design-system';
import { useAuth } from '@/auth';
import { createApiClient } from '@/api';
import { MilesBalanceButton } from '@/components/miles-balance-button';
import type { MobilePass, PassPresentation } from '@/contracts';
import { isScreenshotModeEnabled } from '@/fixtures/screenshot-commerce';

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
  const { width } = useWindowDimensions();
  const qrSize = Math.min(272, width - 116);
  const screenshotMode = isScreenshotModeEnabled();
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
        if (!(Date.parse(data.expiresAt) > Date.now())) {
          throw new Error('Could not load a live Pass. Try again.');
        }
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
      if (status === 'active') {
        setPresentation((current) =>
          current.status === 'ready' && Date.parse(current.data.expiresAt) <= Date.now()
            ? { status: 'loading' }
            : current,
        );
        void refreshPresentation();
      }
    });
    return () => subscription.remove();
  }, [refreshPresentation]);

  useEffect(() => {
    if (presentation.status !== 'ready') return;
    const expiresAt = Date.parse(presentation.data.expiresAt);
    const refreshTimer = setTimeout(() => void refreshPresentation(), Math.max(1_000, expiresAt - 30_000 - Date.now()));
    const expiryTimer = setTimeout(() => {
      setPresentation((current) => current === presentation ? { status: 'loading' } : current);
      void refreshPresentation();
    }, Math.max(0, expiresAt - Date.now()));
    return () => {
      clearTimeout(refreshTimer);
      clearTimeout(expiryTimer);
    };
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
          <MilesBalanceButton />
        </View>

        <Card style={styles.card}>
          <View style={styles.identity}>
            <View style={styles.mark}><Icon name="award" size={22} color={colors.tealDark} /></View>
            <View style={styles.identityCopy}>
              <Text style={styles.eyebrow}>Akiba Pass</Text>
              {state.status === 'ready' ? (
                <Text style={styles.memberName}>{screenshotMode ? 'Amani Kamau' : state.data.displayName}</Text>
              ) : null}
            </View>
            {!loading && !errorMessage && presentation.status === 'ready' ? (
              <Badge label={screenshotMode ? 'Sample' : 'Live'} tone={screenshotMode ? 'muted' : 'teal'} />
            ) : null}
          </View>

          <Text accessibilityRole="header" style={styles.instruction}>Show your Pass to earn AkibaMiles</Text>
          <Text style={styles.hint}>Ask the cashier to scan it when you pay at a participating place.</Text>

          {errorMessage ? (
            <View style={styles.feedback}>
              <Icon name="info" size={26} color={colors.tealDark} />
              <Text accessibilityRole="alert" style={styles.hint}>{errorMessage}</Text>
              <PrimaryButton label="Try again" onPress={retry} />
            </View>
          ) : loading ? (
            <View style={styles.feedback}>
              <ActivityIndicator color={colors.teal} />
              <Text accessibilityLiveRegion="polite" style={styles.hint}>Getting your live Pass ready…</Text>
            </View>
          ) : presentation.status === 'ready' ? (
            <>
              <View style={styles.qrWell}>
                <View style={styles.qrWrap} accessible accessibilityLabel={screenshotMode ? 'Sample Pass QR for preview only' : 'Akiba Pass QR for earning AkibaMiles'}>
                  <QRCode value={screenshotMode ? 'AKIBA-SCREENSHOT-SAMPLE-NOT-VALID-FOR-REDEMPTION' : presentation.data.token} size={qrSize} color={QR_DARK} backgroundColor={QR_LIGHT} ecl="M" />
                </View>
              </View>
              <Text style={styles.refresh}>{screenshotMode ? 'Sample QR for preview only' : 'Your QR refreshes automatically'}</Text>
            </>
          ) : null}
        </Card>
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
  screenHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  screenTitle: {
    color: colors.ink,
    fontFamily: fontFamily.sterlingSemiBold,
    fontSize: 28,
    lineHeight: 34,
  },
  card: { gap: 12 },
  identity: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  mark: { alignItems: 'center', backgroundColor: colors.tint, borderRadius: 12, height: 44, justifyContent: 'center', width: 44 },
  identityCopy: { flex: 1, gap: 2 },
  eyebrow: { color: colors.tealDark, fontFamily: fontFamily.sansSemiBold, fontSize: 12 },
  memberName: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 16 },
  instruction: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 24, lineHeight: 29 },
  hint: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20 },
  qrWell: { alignItems: 'center', backgroundColor: colors.tint, borderRadius: radius.lg, paddingVertical: 16 },
  qrWrap: { backgroundColor: QR_LIGHT, padding: 8 },
  refresh: { color: colors.tealDark, fontFamily: fontFamily.sansMedium, fontSize: 13, textAlign: 'center' },
  feedback: { alignItems: 'center', backgroundColor: colors.tint, borderRadius: radius.lg, gap: 12, justifyContent: 'center', minHeight: 144, padding: 16 },
});
