import { defineConfig } from 'vitest/config';
import path from 'path';

// Unit tests for the app's pure logic — launch gating, auth error mapping,
// onboarding step resolution, analytics scrubbing. Deliberately node-only
// and component-free: anything importing react-native or an expo-* module
// needs a native runtime, so that behaviour is covered by the on-device E2E
// pass instead of a simulated renderer that would prove less.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
