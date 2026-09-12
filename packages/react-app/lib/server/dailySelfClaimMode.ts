// lib/server/dailySelfClaimMode.ts
//
// Rollout gate for self-claim, generalized to every interactive quest family
// (docs/all-quests-self-claim-spec.md §10), evolved from the daily-check-in-
// only gate (docs/daily-checkin-self-claim-spec.md §8). Mirrors the allowlist
// convention already used by lib/server/merchantQuestRollout.ts.
//
// Policy precedence per family:
//   1. If the family is listed in QUEST_SELF_CLAIM_FAMILIES, the generic
//      QUEST_SELF_CLAIM_MODE/QUEST_SELF_CLAIM_ALLOWLIST policy applies.
//   2. Otherwise, for the daily_checkin family only, DAILY_SELF_CLAIM_MODE/
//      DAILY_SELF_CLAIM_ALLOWLIST remain a compatibility fallback until daily
//      check-in is migrated onto the generic policy (a startup warning is
//      logged the first time this fallback is used, without ever logging
//      wallet addresses).
//   3. Any other family absent from QUEST_SELF_CLAIM_FAMILIES is "off" — it
//      keeps its current sponsored behavior, unchanged.

export type SelfClaimMode = "off" | "allowlist" | "on";

type Env = { [key: string]: string | undefined };

function parseMode(raw: string | undefined): SelfClaimMode {
  const v = (raw ?? "off").trim().toLowerCase();
  return v === "on" || v === "allowlist" ? v : "off";
}

function parseCsvSet(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

let _warnedDeprecatedDailyVar = false;

function resolveFamilyPolicy(
  family: string,
  env: Env,
): { mode: SelfClaimMode; allowlistEnv: string | undefined } {
  const families = parseCsvSet(env.QUEST_SELF_CLAIM_FAMILIES);
  if (families.has(family.toLowerCase())) {
    return { mode: parseMode(env.QUEST_SELF_CLAIM_MODE), allowlistEnv: env.QUEST_SELF_CLAIM_ALLOWLIST };
  }

  if (family === "daily_checkin" && env.DAILY_SELF_CLAIM_MODE !== undefined) {
    if (!_warnedDeprecatedDailyVar) {
      _warnedDeprecatedDailyVar = true;
      console.warn(
        "[dailySelfClaimMode] DAILY_SELF_CLAIM_MODE is deprecated — migrate daily_checkin onto " +
          "QUEST_SELF_CLAIM_MODE/QUEST_SELF_CLAIM_FAMILIES. Using the deprecated setting for now.",
      );
    }
    return { mode: parseMode(env.DAILY_SELF_CLAIM_MODE), allowlistEnv: env.DAILY_SELF_CLAIM_ALLOWLIST };
  }

  return { mode: "off", allowlistEnv: undefined };
}

export function getFamilySelfClaimMode(family: string, env: Env = process.env): SelfClaimMode {
  return resolveFamilyPolicy(family, env).mode;
}

/** Whether this wallet should use the self-claim (voucher) path for `family` right now. */
export function isSelfClaimEnabledForWallet(
  family: string,
  userAddress: string,
  env: Env = process.env,
): boolean {
  const { mode, allowlistEnv } = resolveFamilyPolicy(family, env);
  if (mode === "off") return false;
  if (mode === "on") return true;
  return parseCsvSet(allowlistEnv).has(userAddress.trim().toLowerCase());
}
