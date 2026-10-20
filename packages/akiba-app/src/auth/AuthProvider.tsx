import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';

// Imported from the module rather than the '@/push' barrel: the barrel also
// exports PushRegistrar, which imports this provider.
import { unregisterPushNotifications } from '@/push/register';

import { restoreSession } from './session';
import { supabase } from './supabase';

type AuthContextValue = {
  session: Session | null;
  accessToken: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * How long the server-side token revoke may take before signing out proceeds
 * locally anyway. Shorter than a normal request budget on purpose: the member
 * has asked to leave, and making them watch a spinner because the network is
 * stalled is the failure this guards against.
 */
const SIGN_OUT_NETWORK_BUDGET_MS = 4_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    restoreSession()
      .then((restored) => {
        if (active) setSession(restored);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    session,
    accessToken: session?.access_token ?? null,
    loading,
    signOut: async () => {
      // Release this install's push registration while the token is still
      // valid — otherwise the next member to sign in on this phone inherits
      // the previous one's notifications until their first send fails.
      // Best effort by design: a failure here must never block signing out,
      // and it is bounded by the API client's request timeout.
      const token = session?.access_token;
      if (token) await unregisterPushNotifications(token);

      // Signing out has to work on a stalled network. The global call
      // revokes the refresh token server-side, which is worth attempting,
      // but it is a network round trip and can hang — so it is raced against
      // a short budget rather than awaited indefinitely.
      try {
        await Promise.race([
          supabase.auth.signOut(),
          new Promise((resolve) => setTimeout(resolve, SIGN_OUT_NETWORK_BUDGET_MS)),
        ]);
      } catch {
        // A failed revoke is not a reason to leave the member signed in.
      }

      // Unconditional and local-only: clears the SecureStore session without
      // touching the network, so the member is signed out on this device even
      // if the revoke above timed out or failed. Idempotent when it already
      // succeeded.
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Nothing further to try; onAuthStateChange still fires on the
        // cleared session.
      }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return value;
}
