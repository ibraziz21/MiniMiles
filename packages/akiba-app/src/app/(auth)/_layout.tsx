import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/auth';

export default function AuthLayout() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Redirect href="/" />;

  // Sign-in is declared first so it is the group's initial route. A device
  // that hasn't seen the intro is redirected there by sign-in itself.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="intro" />
      <Stack.Screen name="verify" />
    </Stack>
  );
}
