/**
 * Launch-flow feature flags (production-readiness-security-spec.md §13,
 * Phase 0). One kill switch per flow named in the spec's rollout/rollback
 * checklist (§14): wallet linking, M-Pesa initiation, offline Pass,
 * Hub-native quest claims, claw voucher issuance.
 *
 * Each flag is `explicit toggle AND required production config present` —
 * a flow stays disabled even if someone flips the toggle on without its
 * config, and a flow already live can be turned off immediately without a
 * deploy. This is deliberately separate from the Hub-quests staged rollout
 * gate (hubQuestRollout.ts), which controls *who* sees an already-enabled
 * flow; this module controls whether the flow is enabled at all.
 *
 * Same env-injection pattern as merchantQuestRollout.ts / hubQuestRollout.ts
 * (accepts `env` so tests can override process.env per call instead of
 * relying on a cached snapshot).
 */

type FlagEnvironment = {
  [key: string]: string | undefined;
};

function isTruthy(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function isConfigured(...values: (string | undefined)[]): boolean {
  return values.every((v) => !!v?.trim());
}

export type FeatureFlagResult = {
  enabled: boolean;
  /** Why the flow is disabled, when it is — for operator-facing messaging/logs, never shown raw to end users. */
  reason: string | null;
};

function evaluate(toggleOn: boolean, configOk: boolean, missingConfigReason: string): FeatureFlagResult {
  if (!toggleOn) return { enabled: false, reason: "disabled by feature flag" };
  if (!configOk) return { enabled: false, reason: missingConfigReason };
  return { enabled: true, reason: null };
}

/** PR-01 — verified wallet linking (challenge/verify endpoints). Off by default until Workstream A ships. */
export function walletLinkingFlag(env: FlagEnvironment = process.env): FeatureFlagResult {
  return evaluate(
    isTruthy(env.WALLET_LINKING_ENABLED),
    isConfigured(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
    "Supabase service credentials missing"
  );
}

/** PR-02/03 — M-Pesa checkout initiation. */
export function mpesaInitiationFlag(env: FlagEnvironment = process.env): FeatureFlagResult {
  const isProduction = env.NODE_ENV === "production";
  const credsConfigured = isConfigured(
    env.MPESA_CONSUMER_KEY,
    env.MPESA_CONSUMER_SECRET,
    env.MPESA_SHORTCODE,
    env.MPESA_PASSKEY
  );
  const productionReady = !isProduction || isConfigured(env.MPESA_CALLBACK_SECRET);
  return evaluate(
    isTruthy(env.MPESA_INITIATION_ENABLED ?? "true"),
    credsConfigured && productionReady,
    !credsConfigured
      ? "M-Pesa consumer credentials missing"
      : "MPESA_CALLBACK_SECRET missing in production"
  );
}

/** Offline Pass presentation (service-worker/IndexedDB Pass fallback for shared/offline devices). */
export function offlinePassFlag(env: FlagEnvironment = process.env): FeatureFlagResult {
  return evaluate(
    isTruthy(env.OFFLINE_PASS_ENABLED ?? "true"),
    isConfigured(env.HUB_PASS_SECRET) || env.NODE_ENV !== "production",
    "HUB_PASS_SECRET missing in production"
  );
}

/** Hub-native quest claim submission (distinct from the staged-rollout cohort gate in hubQuestRollout.ts). */
export function hubQuestClaimsFlag(env: FlagEnvironment = process.env): FeatureFlagResult {
  return evaluate(
    isTruthy(env.HUB_QUEST_CLAIMS_ENABLED ?? "true"),
    isConfigured(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
    "Supabase service credentials missing"
  );
}

/** Claw-game voucher issuance (on-chain reward -> Hub voucher). */
export function clawVoucherIssuanceFlag(env: FlagEnvironment = process.env): FeatureFlagResult {
  return evaluate(
    isTruthy(env.CLAW_VOUCHER_ISSUANCE_ENABLED ?? "true"),
    isConfigured(env.MINIPOINTS_ADDRESS, env.CELO_RPC_URL),
    "Claw contract address or Celo RPC URL missing"
  );
}

export function getAllFeatureFlags(env: FlagEnvironment = process.env) {
  return {
    walletLinking: walletLinkingFlag(env),
    mpesaInitiation: mpesaInitiationFlag(env),
    offlinePass: offlinePassFlag(env),
    hubQuestClaims: hubQuestClaimsFlag(env),
    clawVoucherIssuance: clawVoucherIssuanceFlag(env),
  };
}
