// Route group for first-run onboarding (AKIBA-MOB-001 §3). Lives at
// /onboarding/* rather than in a parenthesised group so its step names
// can't collide with the tabs' own /pass and /profile routes.
import { useEffect, useRef } from 'react';
import { Redirect, Stack, usePathname } from 'expo-router';

import { track } from '@/analytics';
import { useAuth } from '@/auth';
import { ConnectionErrorScreen, LaunchLoadingScreen } from '@/components/launch-screens';
import { useMember } from '@/member';

export default function OnboardingLayout() {
  const { session, loading } = useAuth();
  const { state, reload } = useMember();
  const pathname = usePathname();

  // `completed` mirrors server-confirmed completion so the unmount handler
  // can tell "finished" from "walked away" — both unmount this layout.
  const completed = useRef(false);
  const lastStep = useRef<string | null>(null);

  useEffect(() => {
    if (state.status === 'ready' && state.bootstrap.onboarding.complete) {
      completed.current = true;
    }
  }, [state]);

  useEffect(() => {
    const step = pathname.split('/').filter(Boolean).pop();
    if (step && step !== 'onboarding') lastStep.current = step;
  }, [pathname]);

  useEffect(
    () => () => {
      if (!completed.current) {
        track('onboarding_abandoned', { lastStep: lastStep.current ?? 'unknown' });
      }
    },
    [],
  );

  if (loading) return null;
  if (!session || state.status === 'anonymous') return <Redirect href="/sign-in" />;
  if (state.status === 'loading') return <LaunchLoadingScreen message="Getting your account ready…" />;
  if (state.status === 'error') {
    return (
      <ConnectionErrorScreen
        message="We couldn’t load your account. Check your connection and try again."
        onRetry={reload}
        title="Almost there"
      />
    );
  }
  if (state.bootstrap.onboarding.complete) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
