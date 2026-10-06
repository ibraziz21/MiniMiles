import { Redirect, Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth';
import { PassTabBar } from '@/components/pass-tab-bar';
import { colors } from '@/design-system';

export default function TabsLayout() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <SafeAreaView edges={['top']} style={styles.shell}>
      <Tabs screenOptions={{ headerShown: false }} tabBar={() => <PassTabBar />}>
        <Tabs.Screen name="index" options={{ title: 'Explore' }} />
        <Tabs.Screen name="merchants" options={{ title: 'Merchants' }} />
        <Tabs.Screen name="vouchers" options={{ title: 'Rewards' }} />
        <Tabs.Screen name="pass" options={{ title: 'Pass' }} />
        <Tabs.Screen name="gifts" options={{ title: 'Gifts' }} />
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
