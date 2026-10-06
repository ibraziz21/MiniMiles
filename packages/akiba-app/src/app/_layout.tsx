import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';

import { AuthProvider } from '@/auth';

// Holds the native splash screen (configured in app.json) until DM Sans's
// weights resolve — the fontFamily tokens (design-system/tokens.ts) assume
// these exact family names are already registered by the time any screen
// mounts, so nothing downstream needs to react to a later font-load event.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    FTSterlingRegular: require('../../assets/fonts/FTSterlingTrial-Regular.otf'),
    FTSterlingMedium: require('../../assets/fonts/FTSterlingTrial-Medium.otf'),
    FTSterlingSemiBold: require('../../assets/fonts/FTSterlingTrial-Semi-Bold.otf'),
    FTSterlingBold: require('../../assets/fonts/FTSterlingTrial-Bold.otf'),
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

  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}
