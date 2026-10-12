// Deletion receipt (AKIBA-MOB-002 §5.5).
//
// Deliberately a root-level route, outside the authenticated `(tabs)` group:
// the session is cleared the moment this screen mounts, and a receipt living
// inside a guarded group would be redirected away by its own sign-out before
// the member could read their reference.
//
// The only state that travels here is the opaque request reference and the
// processing target — no email, balance, token, or user id — which is what
// §5.5 means by retaining only the non-sensitive reference.
import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth';
import {
  Icon,
  PrimaryButton,
  ScrollView,
  Text,
  View,
  colors,
  fontFamily,
  radius,
  spacing,
  typography,
} from '@/design-system';

function formatTarget(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function AccountDeletedScreen() {
  const { signOut } = useAuth();
  const params = useLocalSearchParams<{
    reference?: string;
    targetCompletionAt?: string;
    alreadyRequested?: string;
  }>();

  const [signedOut, setSignedOut] = useState(false);
  const cleared = useRef(false);
  const alreadyRequested = params.alreadyRequested === '1';
  const targetDate = formatTarget(params.targetCompletionAt);

  useEffect(() => {
    if (cleared.current) return;
    cleared.current = true;

    // Clearing the Supabase session also clears the SecureStore entries it
    // owns, since the client is configured with the SecureStore adapter.
    void signOut().finally(() => setSignedOut(true));
    AccessibilityInfo.announceForAccessibility(
      'Deletion request received. Your request reference is shown on screen.',
    );
  }, [signOut]);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.shell}>
      <ScrollView contentContainerStyle={styles.page} style={styles.screen}>
        <View style={styles.content}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.glyph}>
            <Icon color={colors.tealDark} name="check" size={28} />
          </View>

          <Text accessibilityRole="header" style={styles.title}>
            {alreadyRequested ? 'Your request is already in progress' : 'Deletion request received'}
          </Text>

          <Text style={styles.body}>
            {targetDate
              ? `We'll complete processing by ${targetDate} and email your account address when it's done.`
              : "We'll email your account address when processing is complete."}
          </Text>

          {params.reference ? (
            <View style={styles.referenceCard}>
              <Text style={styles.referenceLabel}>Your reference</Text>
              <Text accessibilityLabel={`Your reference is ${params.reference}`} selectable style={styles.reference}>
                {params.reference}
              </Text>
            </View>
          ) : null}

          <Text style={styles.body}>
            Keep this reference if you need to contact hello@akibamiles.com about your request. You
            can&apos;t cancel it from the app.
          </Text>

          <Text accessibilityLiveRegion="polite" style={styles.signOutNote}>
            {signedOut ? 'You have been signed out on this device.' : 'Signing you out…'}
          </Text>

          <PrimaryButton
            accessibilityHint="Returns to the sign-in screen"
            label="Done"
            onPress={() => router.replace('/sign-in')}
            style={styles.action}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.paper,
    flex: 1,
  },
  screen: {
    backgroundColor: colors.paper,
  },
  page: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  content: {
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.md,
    maxWidth: 440,
    width: '100%',
  },
  glyph: {
    alignItems: 'center',
    backgroundColor: colors.tint,
    borderCurve: 'continuous',
    borderRadius: 20,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  title: {
    color: colors.ink,
    fontFamily: fontFamily.sterlingSemiBold,
    fontSize: typography.title,
    textAlign: 'center',
  },
  body: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.small,
    lineHeight: 22,
    textAlign: 'center',
  },
  referenceCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.lg,
    width: '100%',
  },
  referenceLabel: {
    color: colors.muted,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.caption,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  reference: {
    color: colors.ink,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
    textAlign: 'center',
  },
  signOutNote: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.sm,
    minWidth: 200,
  },
});
