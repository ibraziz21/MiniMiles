import { Stack } from 'expo-router';

// The directory uses its own compact content header; detail screens keep the
// same headerless stack so their branded hero and back control stay intact.
export default function MerchantsStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
