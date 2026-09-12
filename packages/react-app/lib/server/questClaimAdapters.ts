// lib/server/questClaimAdapters.ts
//
// Adapter contract for the generic self-claim engine
// (docs/all-quests-self-claim-spec.md §5.2). Each claim family implements one
// of these; the engine (lib/server/questClaimEngine.ts) never contains
// family-specific eligibility logic itself.
//
// resolveIdentity is cheap and side-effect-free — it lets an existing intent
// be found and retried without rerunning (possibly flaky/rate-limited)
// eligibility checks. verifyEligibility runs only when no intent exists yet.

export type SelfClaimSession = {
  walletAddress: string;
  issuedAt: number;
  authProvider?: "wallet" | "minipay";
};

export type QuestIdentity = {
  questId: string;
  scopeKey: string;
  claimNonce: bigint;
  deadline: bigint;
};

export type QuestEligibilityResult = {
  basePoints: number;
  finalizerKind: string;
  finalizerPayload: Record<string, unknown>;
  eligibilityRef?: string;
};

export type QuestEligibilityCheck =
  | { ok: true; result: QuestEligibilityResult }
  | { ok: false; status: number; code?: string; message: string };

export type QuestClaimAdapter = {
  /** Registry key used for rollout gating and metrics — e.g. "daily_transfer". */
  family: string;
  /** Server-resolved questId + scopeKey + nonce/deadline. Never derived from client input. */
  resolveIdentity(session: SelfClaimSession): Promise<QuestIdentity>;
  /** Runs only when no intent exists yet for (wallet, questId, scopeKey). */
  verifyEligibility(session: SelfClaimSession, identity: QuestIdentity): Promise<QuestEligibilityCheck>;
  /**
   * Optional: the idempotency key this family's legacy sponsored path uses in
   * minipoint_mint_jobs, so voucher issuance can refuse to run while a
   * sponsored mint for the same logical completion may still land
   * (all-quests-self-claim-spec.md §5.3 step 8, §10).
   */
  legacyIdempotencyKey?(identity: QuestIdentity, userAddress: string): string;
  /**
   * Set for instance/lifetime-scoped families (e.g. an earned-streak reward
   * with a short signed-voucher lifetime) whose claim opportunity does not
   * actually close when the *signature* expires — only daily/weekly scoped
   * quests should leave this unset (all-quests-self-claim-spec.md §3: "an
   * expired unsubmitted voucher may be reissued with a later deadline using
   * the same intent, nonce, amount, and finalizer"). When true, the engine
   * refreshes the deadline and re-signs instead of reporting "expired".
   */
  canRefreshDeadline?: boolean;
};
