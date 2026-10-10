import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { createApiClient } from '@/api';
import { track } from '@/analytics';
import { useAuth } from '@/auth';
import type { MobileConfig } from '@/contracts';
import {
  ConnectionErrorScreen,
  LaunchLoadingScreen,
  MaintenanceScreen,
  UpgradeRequiredScreen,
} from '@/components/launch-screens';

import { resolveLaunchGate } from './version';

type LoadState =
  | { status: 'loading' }
  | { status: 'failed' }
  // `loadedFor` records which access token this configuration was resolved
  // for. Feature flags are member-scoped, so configuration loaded for one
  // actor must not be treated as valid for another.
  | { status: 'loaded'; config: MobileConfig; loadedFor: string | null };

const AppConfigContext = createContext<MobileConfig | null>(null);

function installedVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

function nativePlatform(): 'ios' | 'android' {
  // The API client already refuses to run anywhere but iOS/Android; treat
  // anything else as iOS purely so the version gate has a key to read,
  // rather than duplicating that error here.
  return Platform.OS === 'android' ? 'android' : 'ios';
}

/**
 * Cold-start gate (AKIBA-MOB-001 §1): fetches `/api/v1/config` and renders
 * its children only once the launch sequence is clear to proceed.
 * Maintenance, a build below `minimumSupportedVersion`, and an unreachable
 * backend each render their own screen instead — so no tab, and no feature
 * flag read, can happen before configuration is applied.
 *
 * It sits inside AuthProvider on purpose. Session restore is a local
 * SecureStore read, so waiting for it costs nothing, and sending the
 * restored access token means a signed-in member's rollout-gated flags are
 * resolved for *them* — `/api/v1/config` returns anonymous defaults
 * (everything rollout-gated false) to an unauthenticated caller.
 */
export function AppConfigProvider({ children }: { children: ReactNode }) {
  const { accessToken, loading: authLoading } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async () => {
    try {
      const config = await createApiClient({ accessToken }).getConfig();
      setState({ status: 'loaded', config, loadedFor: accessToken ?? null });
    } catch (error) {
      track('bootstrap_failed', {
        stage: 'config',
        reason: error instanceof Error ? error.name : 'unknown',
      });
      setState({ status: 'failed' });
    }
  }, [accessToken]);

  useEffect(() => {
    if (authLoading) return;
    // Refetching when the token changes is what keeps member-scoped flags
    // correct across sign-in and sign-out within one app session. Bridging a
    // remote fetch into local state is exactly what this screen does; the
    // staleness gate below is what keeps the intermediate state from being
    // rendered.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [authLoading, load]);

  // Gate on *staleness*, not just on the first load. When the token changes
  // mid-session the already-loaded configuration belongs to the previous
  // actor, and §1 requires flags to be applied before tabs render — so the
  // gate closes again until the refetch lands, rather than letting the
  // subtree render against the wrong actor's flags for a frame or a
  // round trip.
  const staleForActor =
    state.status === 'loaded' && state.loadedFor !== (accessToken ?? null);

  if (authLoading || state.status === 'loading' || staleForActor) {
    return <LaunchLoadingScreen />;
  }

  if (state.status === 'failed') {
    return (
      <ConnectionErrorScreen
        onRetry={() => {
          setReloading(true);
          setState({ status: 'loading' });
          load().finally(() => setReloading(false));
        }}
        retrying={reloading}
      />
    );
  }

  const gate = resolveLaunchGate({
    config: state.config,
    platform: nativePlatform(),
    installedVersion: installedVersion(),
  });

  if (gate === 'maintenance') return <MaintenanceScreen />;
  if (gate === 'upgrade_required') return <UpgradeRequired config={state.config} />;

  return <AppConfigContext.Provider value={state.config}>{children}</AppConfigContext.Provider>;
}

function UpgradeRequired({ config }: { config: MobileConfig }) {
  useEffect(() => {
    track('upgrade_required', {
      platform: Platform.OS,
      installed: installedVersion(),
      minimum: config.minimumSupportedVersion[nativePlatform()],
    });
  }, [config]);

  return <UpgradeRequiredScreen config={config} />;
}

/**
 * The resolved remote configuration. Only callable below
 * AppConfigProvider's gate, which is exactly where every screen lives —
 * so this returns a value rather than a maybe-loaded state.
 */
export function useAppConfig(): MobileConfig {
  const config = useContext(AppConfigContext);
  if (!config) {
    throw new Error('useAppConfig must be used within AppConfigProvider');
  }
  return config;
}

/** Convenience reader for the common `features.x` case. */
export function useFeatureFlags() {
  return useAppConfig().features;
}
