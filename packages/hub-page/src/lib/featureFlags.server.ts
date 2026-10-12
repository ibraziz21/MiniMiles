/**
 * Launch-flow feature flags (production-readiness-security-spec.md §13,
 * Phase 0). One kill switch per flow named in the spec's rollout/rollback
 * checklist (§14): wallet linking, offline Pass, and Hub-native quest
 * claims. Direct-commerce payment initiation is retired.
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

/**
 * Akiba-funded voucher discovery/eligibility/claim kill switch
 * (akiba-funded-voucher-launch-hardening-spec.md §3). Unlike the flags above,
 * this one is explicitly `false` by default everywhere (including non-prod)
 * — Phase 1 is a real-money vertical slice, so it needs a deliberate opt-in
 * rather than "on unless configured otherwise". Turning it off must stop new
 * claims without touching already-issued voucher redemption, which never
 * reads this flag.
 */
export function akibaFundedVouchersHubFlag(env: FlagEnvironment = process.env): FeatureFlagResult {
  return evaluate(
    isTruthy(env.AKIBA_FUNDED_VOUCHERS_HUB_ENABLED),
    isConfigured(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY),
    "Supabase service credentials missing"
  );
}

/**
 * Native-only destination switch for the Gifts tab
 * (AKIBA-MOB-001 §1 "Hide unfinished destinations such as Gifts through
 * feature flags"). Unlike the flags above this gates a *surface*, not a
 * flow, so it has no required production config to check — the tab is
 * nothing but a coming-soon placeholder until the gifting vertical ships,
 * and must stay off by default so a build can't accidentally expose it.
 */
export function nativeGiftsFlag(env: FlagEnvironment = process.env): FeatureFlagResult {
  if (!isTruthy(env.MOBILE_GIFTS_ENABLED)) return { enabled: false, reason: "disabled by feature flag" };
  return { enabled: true, reason: null };
}

export function getAllFeatureFlags(env: FlagEnvironment = process.env) {
  return {
    walletLinking: walletLinkingFlag(env),
    offlinePass: offlinePassFlag(env),
    hubQuestClaims: hubQuestClaimsFlag(env),
    akibaFundedVouchersHub: akibaFundedVouchersHubFlag(env),
    nativeGifts: nativeGiftsFlag(env),
  };
}
