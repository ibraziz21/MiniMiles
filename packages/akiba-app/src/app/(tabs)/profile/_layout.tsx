import { Stack } from 'expo-router';

// Profile and settings use their own compact content headers inside the
// shared top-safe-area shell.
export default function ProfileStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
