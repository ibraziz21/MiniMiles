import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiRequestError, createApiClient } from '@/api';
import { track } from '@/analytics';
import { setSessionNotice, useAuth } from '@/auth';
import type { MobileBootstrap } from '@/contracts';

type MemberState =
  | { status: 'anonymous' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; bootstrap: MobileBootstrap };

type MemberContextValue = {
  state: MemberState;
  reload: () => void;
  /**
   * Records onboarding completion server-side, then flips local state.
   * Throws when the write fails so the caller can keep the member on the
   * last step instead of dropping them into a half-onboarded app.
   */
  completeOnboarding: () => Promise<void>;
};

const MemberContext = createContext<MemberContextValue | null>(null);

/**
 * Loads `GET /api/v1/me/bootstrap` once per session and holds it for the
 * whole app (AKIBA-MOB-001 §1 "Load member bootstrap").
 *
 * One provider rather than a fetch in each guard means the onboarding gate
 * and the tabs read the same answer, and a 401 — an expired session that
 * local SecureStore still holds a stale token for — is handled in exactly
 * one place: sign out, which sends the member back to authentication
 * through the existing route guards rather than leaving them on a broken
 * screen.
 */
export function MemberProvider({ children }: { children: ReactNode }) {
  const { accessToken, loading: authLoading, signOut } = useAuth();
  const [state, setState] = useState<MemberState>({ status: 'loading' });

  const load = useCallback(async () => {
    if (!accessToken) {
      setState({ status: 'anonymous' });
      return;
    }
    try {
      const bootstrap = await createApiClient({ accessToken }).getBootstrap();
      setState({ status: 'ready', bootstrap });
    } catch (error) {
      if (error instanceof ApiRequestError && (error.status === 401 || error.status === 410)) {
        // 401 — stale token, the session is gone server-side.
        // 410 — the pending-account guard (AKIBA-MOB-002 §7.4): a deletion
        // request was accepted, possibly from another device, and this
        // session must not keep working. Either way, clearing it locally is
        // what returns the member safely to sign-in; the notice is what
        // stops that looking like a random logout.
        setSessionNotice(error.status === 410 ? 'account_deletion_pending' : 'session_expired');
        await signOut();
        setState({ status: 'anonymous' });
        return;
      }
      track('bootstrap_failed', {
        stage: 'member',
        reason: error instanceof ApiRequestError ? `http_${error.status}` : 'unknown',
      });
      setState({ status: 'error' });
    }
  }, [accessToken, signOut]);

  useEffect(() => {
    if (authLoading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(accessToken ? { status: 'loading' } : { status: 'anonymous' });
    load();
  }, [authLoading, accessToken, load]);

  const completeOnboarding = useCallback(async () => {
    if (!accessToken) throw new Error('completeOnboarding requires a signed-in member');
    const result = await createApiClient({ accessToken }).completeOnboarding();
    setState((current) =>
      current.status === 'ready'
        ? {
            status: 'ready',
            bootstrap: {
              ...current.bootstrap,
              onboarding: { ...current.bootstrap.onboarding, complete: result.complete },
            },
          }
        : current,
    );
  }, [accessToken]);

  const value = useMemo<MemberContextValue>(
    () => ({ state, reload: () => void load(), completeOnboarding }),
    [state, load, completeOnboarding],
  );

  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>;
}

export function useMember(): MemberContextValue {
  const value = useContext(MemberContext);
  if (!value) {
    throw new Error('useMember must be used within a MemberProvider');
  }
  return value;
}
