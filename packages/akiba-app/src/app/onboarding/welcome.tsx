// Onboarding step 1 (AKIBA-MOB-001 §3.1) — what Akiba is, in three lines.
// No data is requested here and no permission is asked for: location is
// only prompted later, when a member actually taps "Near me" on the
// Merchants tab.
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { OnboardingStepScreen } from '@/components/onboarding-step';
import { useMember } from '@/member';
import { ONBOARDING_ROUTES } from '@/onboarding';
import { IconChip, Text, View, colors, fontFamily, spacing, typography } from '@/design-system';

const PROMISES = [
  {
    icon: 'map-pin' as const,
    title: 'Discover trusted places',
    body: 'Browse shops, cafés and services that Akiba members actually visit.',
  },
  {
    icon: 'award' as const,
    title: 'Earn AkibaMiles',
    body: 'Show your Akiba Pass when you pay and collect Miles on what you already spend.',
  },
  {
    icon: 'tag' as const,
    title: 'Use rewards where you shop',
    body: 'Turn Miles into vouchers you redeem with participating merchants.',
  },
];

export default function OnboardingWelcomeScreen() {
  const { state } = useMember();
  const hasProfile = state.status === 'ready' && !!state.bootstrap.user.username;

  return (
    <OnboardingStepScreen
      intro="Akiba Pass turns everyday spending at local merchants into rewards you can actually use."
      onPrimary={() => router.push(hasProfile ? ONBOARDING_ROUTES.pass : ONBOARDING_ROUTES.profile)}
      primaryLabel="Get started"
      step="welcome"
      title="Welcome to Akiba">
      <View style={styles.list}>
        {PROMISES.map((promise) => (
          <View accessible accessibilityLabel={`${promise.title}. ${promise.body}`} key={promise.title} style={styles.row}>
            <IconChip name={promise.icon} />
            <View style={styles.copy}>
              <Text style={styles.rowTitle}>{promise.title}</Text>
              <Text style={styles.rowBody}>{promise.body}</Text>
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
