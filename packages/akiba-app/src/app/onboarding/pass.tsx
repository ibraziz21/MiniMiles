// Onboarding step 3 (AKIBA-MOB-001 §3.3) — how the Pass and rewards work,
// then into the app. Deliberately explanatory only: the Pass QR itself
// (and its rotation/offline behaviour) is AKIBA-MOB-003, so this step
// makes no pass request and renders no code.
import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { track } from '@/analytics';
import { OnboardingStepScreen } from '@/components/onboarding-step';
import { useMember } from '@/member';
import { clearOnboardingStep } from '@/onboarding';
import { IconChip, Text, View, colors, fontFamily, spacing, typography } from '@/design-system';

const FACTS = [
  {
    icon: 'maximize' as const,
    title: 'Merchants scan your Pass',
    body: 'Open the Pass tab at the till and let the cashier scan it. Your Miles land straight away.',
  },
  {
    icon: 'tag' as const,
    title: 'Rewards live under Rewards',
    body: 'Vouchers you claim or buy with Miles are kept in the Rewards tab, ready to show when you pay.',
  },
  {
    icon: 'shield' as const,
    title: 'Nothing to top up',
    body: 'No balance to load and no card to carry — your Pass is all you need.',
  },
];

export default function OnboardingPassScreen() {
  const { state, completeOnboarding } = useMember();
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      await completeOnboarding();
      track('onboarding_completed');
      if (state.status === 'ready') {
        // Local resume state has done its job once the server records the
        // completion; leaving it behind would be harmless but stale.
        await clearOnboardingStep(state.bootstrap.user.id);
      }
      router.replace('/');
    } catch {
      // Never strand a member on the last step with no way forward: the
      // completion call is idempotent, so retrying is always safe.
      setError('We couldn’t save your progress. Check your connection and try again.');
      setFinishing(false);
    }
  }

  return (
    <OnboardingStepScreen
      error={error}
      intro="Your Akiba Pass is how merchants recognise you. Here’s what to expect the first time you use it."
      onPrimary={() => void finish()}
      primaryBusy={finishing}
      primaryBusyLabel="Finishing up…"
      primaryLabel="Explore Akiba"
      step="pass"
      title="Your Akiba Pass">
      <View style={styles.list}>
        {FACTS.map((fact) => (
          <View accessible accessibilityLabel={`${fact.title}. ${fact.body}`} key={fact.title} style={styles.row}>
            <IconChip name={fact.icon} />
            <View style={styles.copy}>
              <Text style={styles.rowTitle}>{fact.title}</Text>
              <Text style={styles.rowBody}>{fact.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </OnboardingStepScreen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.body,
  },
  rowBody: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.small,
    lineHeight: 21,
  },
});
