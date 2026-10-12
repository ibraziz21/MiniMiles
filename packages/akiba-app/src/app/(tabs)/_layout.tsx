import { Redirect, Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth';
import { ConnectionErrorScreen, LaunchLoadingScreen } from '@/components/launch-screens';
import { PassTabBar } from '@/components/pass-tab-bar';
import { useFeatureFlags } from '@/config';
import { useMember } from '@/member';
import { colors } from '@/design-system';

export default function TabsLayout() {
  const { session, loading } = useAuth();
  const { state, reload } = useMember();
  const { gifts } = useFeatureFlags();

  if (loading) return null;
  if (!session || state.status === 'anonymous') return <Redirect href="/sign-in" />;
  if (state.status === 'loading') return <LaunchLoadingScreen message="Loading your account…" />;
  if (state.status === 'error') {
    return (
      <ConnectionErrorScreen
        message="We couldn’t load your account. Check your connection and try again."
        onRetry={reload}
      />
    );
  }
  // Onboarding is gated here rather than inside each tab so no tab can ever
  // render first and then be yanked away (AKIBA-MOB-001 §4). /onboarding
  // resolves which step to resume at.
  if (!state.bootstrap.onboarding.complete) return <Redirect href="/onboarding" />;

  return (
    <SafeAreaView edges={['top']} style={styles.shell}>
      <Tabs screenOptions={{ headerShown: false }} tabBar={() => <PassTabBar showGifts={gifts} />}>
        <Tabs.Screen name="index" options={{ title: 'Explore' }} />
        <Tabs.Screen name="merchants" options={{ title: 'Merchants' }} />
        <Tabs.Screen name="vouchers" options={{ title: 'Rewards' }} />
        <Tabs.Screen name="pass" options={{ title: 'Pass' }} />
        <Tabs.Screen name="gifts" options={{ href: gifts ? undefined : null, title: 'Gifts' }} />
        <Tabs.Screen name="profile" options={{ href: null }} />
      </Tabs>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.paper,
    flex: 1,
  },
});
