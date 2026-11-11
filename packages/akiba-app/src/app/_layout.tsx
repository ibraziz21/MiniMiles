import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';

import { useScreenTracking } from '@/analytics';
import { AuthProvider, useAuth } from '@/auth';
import { AppConfigProvider } from '@/config';
import { MemberProvider } from '@/member';

// Holds the native splash screen (configured in app.json) until DM Sans's
// weights resolve — the fontFamily tokens (design-system/tokens.ts) assume
// these exact family names are already registered by the time any screen
// mounts, so nothing downstream needs to react to a later font-load event.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  // Provider order is the launch sequence (AKIBA-MOB-001 §"Core flow"):
  // restore authentication locally, then load remote configuration with
  // whatever token that produced (so feature flags are member-scoped and
  // the maintenance/upgrade gates run before any screen mounts), then load
  // the member's bootstrap. MemberProvider is inside the config gate
  // deliberately — a maintenance window should show the maintenance screen,
  // not a failed bootstrap.
  return (
    <AuthProvider>
      <AppConfigProvider>
        <MemberProvider>
          <RootStack />
        </MemberProvider>
      </AppConfigProvider>
    </AuthProvider>
  );
}

// The (auth) group is protected rather than only redirecting from inside its
// layout: a plain redirect leaves the group's sign-in → verify history in the
// root stack, so signing out resumed on the stale "Enter your code" screen.
// Dropping the guard removes the group from history, so every sign-out
// starts again at sign-in.
function RootStack() {
  const { session } = useAuth();
  useScreenTracking();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
