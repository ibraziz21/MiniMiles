import { Stack } from 'expo-router';

// The catalogue and voucher detail screens use compact content headers
// inside the shared top-safe-area shell.
export default function VouchersStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
