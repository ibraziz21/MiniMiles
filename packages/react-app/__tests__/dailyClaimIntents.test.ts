import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, pad, toBytes } from "viem";

const CLAIMER_ADDRESS = "0xa9e6adb52e74151553c140615a09119d501c75ce";
const USER_ADDRESS = "0x000000000000000000000000000000000000aabb";
const INTENT_ID = "11111111-1111-4111-8111-111111111111";

const mockReadContract = vi.fn();
const mockGetTransactionReceipt = vi.fn();
vi.mock("@/lib/celoClient", () => ({
  celoClient: {
    readContract: (...args: any[]) => mockReadContract(...args),
    getTransactionReceipt: (...args: any[]) => mockGetTransactionReceipt(...args),
  },
}));

vi.mock("@/lib/server/dailyClaimConfig", () => ({
  getClaimerAddress: () => CLAIMER_ADDRESS,
}));

const mockUpsert = vi.fn();
const mockUpdateSingle = vi.fn();
const mockSelectMaybeSingle = vi.fn();
const mockSweepQuery = vi.fn();
const mockInsertSingle = vi.fn();
const mockRpc = vi.fn();
const mockUpdateFilters: Array<[operator: "eq" | "is", column: string, value: unknown]> = [];

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    rpc: (fn: string, args: any) => mockRpc(fn, args),
    from: (table: string) => {
      if (table === "daily_engagements") {
        return { upsert: (row: any, opts: any) => mockUpsert(row, opts) };
      }
      // One chainable object serves every read shape used against
      // daily_quest_claim_intents: getIntentForDay/getIntentById terminate
      // on maybeSingle(), sweepStaleClaimIntents terminates on limit().
      const selectChain: any = {
        eq: () => selectChain,
        in: () => selectChain,
        gte: () => selectChain,
        lt: () => selectChain,
        order: () => selectChain,
        maybeSingle: () => mockSelectMaybeSingle(),
        limit: () => mockSweepQuery(),
      };
      return {
        select: () => selectChain,
        insert: (row: any) => ({
          select: () => ({
            single: () => mockInsertSingle(row),
          }),
        }),
        update: (patch: any) => {
          const updateChain: any = {
            eq: (column: string, value: unknown) => {
              mockUpdateFilters.push(["eq", column, value]);
              return updateChain;
            },
            is: (column: string, value: unknown) => {
              mockUpdateFilters.push(["is", column, value]);
              return updateChain;
            },
            select: () => ({
              single: () => mockUpdateSingle(patch),
              maybeSingle: () => mockUpdateSingle(patch),
            }),
          };
          return updateChain;
        },
      };
    },
  },
}));

const {
  reconcileIntent,
  isClaimedOnchain,
  getIntentById,
  sweepStaleClaimIntents,
  createIntent,
  createGenericIntent,
  getIntentForScope,
  getIntentForDay,
  refreshIntentDeadline,
} = await import(
  "@/lib/server/dailyClaimIntents"
);
type ClaimIntentRow = Awaited<ReturnType<typeof reconcileIntent>>;

// viem 2.21 doesn't export encodeEventLog — build the QuestClaimed log by hand
// (decodeEventLog, used by the code under test, is a real, unmocked import).
const QUEST_CLAIMED_TOPIC0 = keccak256(toBytes("QuestClaimed(address,uint256,uint256)"));

function baseIntent(overrides: Partial<ClaimIntentRow> = {}): ClaimIntentRow {
  const claimDate = (overrides.claim_date as string | undefined) ?? "2026-09-12";
  const dayNonce = (overrides.day_nonce as string | undefined) ?? "20708";
  return {
    id: INTENT_ID,
    user_address: USER_ADDRESS,
    quest_id: "quest-1",
    claim_date: claimDate,
    day_nonce: dayNonce,
    scope_key: claimDate,
    claim_nonce: dayNonce,
    claim_family: "daily_checkin",
    base_points: 10,
    points_awarded: 10,
    amount_wei: (10n * 10n ** 18n).toString(),
    vault_boost: { applied: false, multiplier: 1, minBalanceUsdt: 0 },
    deadline: String(Math.floor(Date.now() / 1000) + 86400),
    status: "submitted",
    tx_hash: "0x" + "1".repeat(64),
    last_error: null,
    finalizer_kind: "daily_engagement",
    // Tracks claim_date/scope_key by default — a test overriding those
    // without also overriding finalizer_payload should still see a
    // self-consistent fixture rather than a stale payload.
    finalizer_payload: { questId: "quest-1", claimDate },
    eligibility_ref: null,
    chain_confirmed_at: null,
    legacy_job_id: null,
    // Fresh by default (well inside the staleness window) so tests that
    // aren't specifically about the dropped-tx path don't accidentally trip
    // it just because wall-clock time has moved on since this was written.
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    confirmed_at: null,
    ...overrides,
  };
}

function questClaimedLog(overrides: { user?: string; dayNonce?: bigint; amount?: bigint } = {}) {
  const user = overrides.user ?? USER_ADDRESS;
  const dayNonce = overrides.dayNonce ?? 20708n;
  const amount = overrides.amount ?? 10n * 10n ** 18n;
  return {
    topics: [QUEST_CLAIMED_TOPIC0, pad(user as `0x${string}`)] as const,
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }],
      [dayNonce, amount],
    ),
  };
}

beforeEach(() => {
  mockReadContract.mockReset();
  mockGetTransactionReceipt.mockReset();
  mockUpsert.mockReset().mockResolvedValue({ error: null });
  mockSelectMaybeSingle.mockReset();
  mockSweepQuery.mockReset().mockResolvedValue({ data: [], error: null });
  mockInsertSingle.mockReset();
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
  mockUpdateFilters.length = 0;
  mockUpdateSingle.mockReset().mockImplementation((patch: any) =>
    Promise.resolve({ data: { ...baseIntent(), ...patch }, error: null }),
  );
});

describe("reconcileIntent", () => {
  it("resets to issued and clears the hash when the receipt reverted", async () => {
    const intent = baseIntent();
    mockGetTransactionReceipt.mockResolvedValue({
      status: "reverted",
      to: CLAIMER_ADDRESS,
      from: USER_ADDRESS,
      logs: [],
    });

    const result = await reconcileIntent(intent);

    expect(result.status).toBe("issued");
    expect(mockUpdateSingle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "issued", tx_hash: null }),
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("does not move a concurrently confirmed intent backwards when a stale revert result loses the update race", async () => {
    const intent = baseIntent();
    const confirmed = baseIntent({ status: "confirmed", confirmed_at: new Date().toISOString() });
    mockGetTransactionReceipt.mockResolvedValue({
      status: "reverted",
      to: CLAIMER_ADDRESS,
      from: USER_ADDRESS,
      logs: [],
    });
    mockUpdateSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSelectMaybeSingle.mockResolvedValueOnce({ data: confirmed, error: null });

    const result = await reconcileIntent(intent);

    expect(result.status).toBe("confirmed");
    expect(result.confirmed_at).toBe(confirmed.confirmed_at);
    expect(mockUpdateFilters).toContainEqual(["eq", "status", "submitted"]);
    expect(mockUpdateFilters).toContainEqual(["eq", "tx_hash", intent.tx_hash]);
  });

  it("does not move a concurrently confirmed intent backwards when a stale pending result loses the update race", async () => {
    const intent = baseIntent({
      status: "issued",
      tx_hash: null,
      deadline: String(Math.floor(Date.now() / 1000) + 3600),
    });
    const confirmed = baseIntent({ status: "confirmed", confirmed_at: new Date().toISOString() });
    mockGetTransactionReceipt.mockRejectedValue(new Error("not found"));
    mockUpdateSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSelectMaybeSingle.mockResolvedValueOnce({ data: confirmed, error: null });

    const result = await reconcileIntent(intent, { incomingTxHash: "0x" + "2".repeat(64) });

    expect(result.status).toBe("confirmed");
    expect(mockUpdateFilters).toContainEqual(["eq", "status", "issued"]);
    expect(mockUpdateFilters).toContainEqual(["is", "tx_hash", null]);
  });

  it("confirms exactly once when the receipt matches every field", async () => {
    const intent = baseIntent();
    const log = questClaimedLog();
    mockGetTransactionReceipt.mockResolvedValue({
      status: "success",
      to: CLAIMER_ADDRESS,
      from: USER_ADDRESS,
      logs: [{ address: CLAIMER_ADDRESS, data: log.data, topics: log.topics }],
    });

    const result = await reconcileIntent(intent);

    expect(result.status).toBe("confirmed");
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_address: USER_ADDRESS,
        quest_id: "quest-1",
        claimed_at: "2026-09-12",
        points_awarded: 10,
        source: "onchain",
        tx_hash: intent.tx_hash,
      }),
      expect.objectContaining({ onConflict: "user_address,quest_id,claimed_at" }),
    );
    expect(mockUpdateSingle).toHaveBeenCalledWith(expect.objectContaining({ status: "confirmed" }));
  });

  it("is a no-op on a second reconcile once already confirmed", async () => {
    const intent = baseIntent({ status: "confirmed" });
    const result = await reconcileIntent(intent);
    expect(result).toBe(intent);
    expect(mockGetTransactionReceipt).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("does not confirm when the event amount does not match the frozen intent", async () => {
    const intent = baseIntent();
    const log = questClaimedLog({ amount: 999n * 10n ** 18n });
    mockGetTransactionReceipt.mockResolvedValue({
      status: "success",
      to: CLAIMER_ADDRESS,
      from: USER_ADDRESS,
      logs: [{ address: CLAIMER_ADDRESS, data: log.data, topics: log.topics }],
    });

    const result = await reconcileIntent(intent);

    expect(result.status).toBe("issued");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("does not confirm when the transaction destination is not the claimer", async () => {
    const intent = baseIntent();
    mockGetTransactionReceipt.mockResolvedValue({
      status: "success",
      to: "0x0000000000000000000000000000000000dead",
      from: USER_ADDRESS,
      logs: [],
    });

    const result = await reconcileIntent(intent);
    expect(result.status).toBe("issued");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("does not confirm when the transaction sender is not the authenticated wallet", async () => {
    const intent = baseIntent();
    mockGetTransactionReceipt.mockResolvedValue({
      status: "success",
      to: CLAIMER_ADDRESS,
      from: "0x0000000000000000000000000000000000dead",
      logs: [],
    });

    const result = await reconcileIntent(intent);
    expect(result.status).toBe("issued");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("keeps polling (stays submitted) while the receipt is not yet available", async () => {
    const intent = baseIntent();
    mockGetTransactionReceipt.mockRejectedValue(new Error("not found"));

    const result = await reconcileIntent(intent);

    expect(result).toBe(intent); // already submitted with this exact hash — no DB write needed
    expect(mockUpdateSingle).not.toHaveBeenCalled();
  });

  it("resets a dropped transaction to issued once it has been submitted past the staleness window", async () => {
    const intent = baseIntent({ updated_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
    mockGetTransactionReceipt.mockRejectedValue(new Error("not found"));
    mockReadContract.mockResolvedValue(false); // claimed() also says no

    const result = await reconcileIntent(intent);

    expect(result.status).toBe("issued");
    expect(mockUpdateSingle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "issued", tx_hash: null }),
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("recovers via claimed() instead of dropping a stale-but-actually-successful transaction", async () => {
    const intent = baseIntent({ updated_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
    mockGetTransactionReceipt.mockRejectedValue(new Error("lagging RPC node"));
    mockReadContract.mockResolvedValue(true); // claimed() says the mint actually succeeded

    const result = await reconcileIntent(intent);

    expect(result.status).toBe("confirmed");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "onchain_reconciled" }),
      expect.anything(),
    );
  });

  it("never treats an RPC failure as a definitive claimed()=false — leaves the intent submitted instead of resetting it", async () => {
    const intent = baseIntent({ updated_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
    mockGetTransactionReceipt.mockRejectedValue(new Error("not found"));
    mockReadContract.mockRejectedValue(new Error("RPC transport error"));

    const result = await reconcileIntent(intent);

    // An RPC outage during the staleness check must never be coerced into
    // "definitely not claimed" — that would invite the user to pay gas again
    // for a claim that may have already succeeded or is merely still pending.
    expect(result).toBe(intent);
    expect(mockUpdateSingle).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("does not prematurely give up on a receipt that is merely slow, not stale", async () => {
    const intent = baseIntent({ updated_at: new Date(Date.now() - 2 * 60 * 1000).toISOString() });
    mockGetTransactionReceipt.mockRejectedValue(new Error("not found"));

    const result = await reconcileIntent(intent);

    expect(result).toBe(intent);
    expect(mockUpdateSingle).not.toHaveBeenCalled();
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it("recovers a successful claim via claimed() when no hash was ever recorded (browser closed before confirm)", async () => {
    const intent = baseIntent({ status: "issued", tx_hash: null });
    mockReadContract.mockResolvedValue(true);

    const result = await reconcileIntent(intent);

    expect(result.status).toBe("confirmed");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "onchain_reconciled", tx_hash: null }),
      expect.anything(),
    );
  });

  it("leaves an unclaimed, un-broadcast intent untouched", async () => {
    const intent = baseIntent({ status: "issued", tx_hash: null });
    mockReadContract.mockResolvedValue(false);

    const result = await reconcileIntent(intent);

    expect(result).toBe(intent);
    expect(mockUpdateSingle).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("expires an issued intent once its deadline has passed and claimed() is authoritatively false", async () => {
    const intent = baseIntent({
      status: "issued",
      tx_hash: null,
      deadline: String(Math.floor(Date.now() / 1000) - 1),
    });
    mockReadContract.mockResolvedValue(false);

    const result = await reconcileIntent(intent);

    expect(result.status).toBe("expired");
    expect(mockUpdateSingle).toHaveBeenCalledWith(expect.objectContaining({ status: "expired" }));
  });

  it("expires rather than reissues a reverted intent whose voucher deadline has passed", async () => {
    const intent = baseIntent({ deadline: String(Math.floor(Date.now() / 1000) - 1) });
    mockGetTransactionReceipt.mockResolvedValue({
      status: "reverted",
      to: CLAIMER_ADDRESS,
      from: USER_ADDRESS,
      logs: [],
    });

    const result = await reconcileIntent(intent);

    expect(result.status).toBe("expired");
    expect(mockUpdateSingle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "expired", tx_hash: null }),
    );
  });

  it("retries only the domain finalizer — no RPC call at all — for an intent already at chain_confirmed", async () => {
    const intent = baseIntent({ status: "chain_confirmed", chain_confirmed_at: new Date().toISOString() });

    const result = await reconcileIntent(intent);

    expect(result.status).toBe("confirmed");
    expect(mockGetTransactionReceipt).not.toHaveBeenCalled();
    expect(mockReadContract).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("fails closed on an unknown finalizer kind rather than silently marking the quest confirmed", async () => {
    const intent = baseIntent({ status: "issued", tx_hash: null, finalizer_kind: "some_future_kind" });
    mockReadContract.mockResolvedValue(true);
    // Thread real state so the chain_confirmed CAS update doesn't lose the
    // overridden finalizer_kind to the mock's generic default baseIntent().
    let current: any = intent;
    mockUpdateSingle.mockImplementation((patch: any) => {
      current = { ...current, ...patch };
      return Promise.resolve({ data: current, error: null });
    });

    await expect(reconcileIntent(intent)).rejects.toThrow(/Unknown finalizer kind/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("isClaimedOnchain", () => {
  it("reads claimed(user, dayNonce) from the configured claimer", async () => {
    mockReadContract.mockResolvedValue(true);
    const result = await isClaimedOnchain(USER_ADDRESS, 20708n);
    expect(result).toBe(true);
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CLAIMER_ADDRESS,
        functionName: "claimed",
        args: [USER_ADDRESS, 20708n],
      }),
    );
  });
});

describe("getIntentById", () => {
  it("returns the intent when it belongs to the requesting wallet", async () => {
    const intent = baseIntent();
    mockSelectMaybeSingle.mockResolvedValue({ data: intent, error: null });

    const result = await getIntentById(intent.id, USER_ADDRESS);
    expect(result).toEqual(intent);
  });

  it("returns null instead of another wallet's intent — never leaks cross-wallet data by id", async () => {
    const intent = baseIntent({ user_address: "0x00000000000000000000000000000000000000cc" });
    mockSelectMaybeSingle.mockResolvedValue({ data: intent, error: null });

    const result = await getIntentById(intent.id, USER_ADDRESS);
    expect(result).toBeNull();
  });

  it("returns null when no such intent exists", async () => {
    mockSelectMaybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await getIntentById("missing-id", USER_ADDRESS);
    expect(result).toBeNull();
  });

  it("rejects a malformed UUID before querying Supabase", async () => {
    const result = await getIntentById("not-a-uuid", USER_ADDRESS);
    expect(result).toBeNull();
    expect(mockSelectMaybeSingle).not.toHaveBeenCalled();
  });
});

describe("sweepStaleClaimIntents", () => {
  it("reconciles a dangling prior-day intent found by the query", async () => {
    const stale = baseIntent({ id: "stale-1", status: "issued", tx_hash: null, claim_date: "2026-09-11" });
    mockSweepQuery.mockResolvedValue({ data: [stale], error: null });
    mockReadContract.mockResolvedValue(true); // claimed() says it actually succeeded

    // The default mockUpdateSingle fabricates a fresh generic baseIntent()
    // per call, losing this row's actual claim_date/finalizer_payload across
    // the chain_confirmed -> confirmed sequence — thread real state instead.
    let current: any = stale;
    mockUpdateSingle.mockImplementation((patch: any) => {
      current = { ...current, ...patch };
      return Promise.resolve({ data: current, error: null });
    });

    await sweepStaleClaimIntents({
      userAddress: USER_ADDRESS,
      questId: "quest-1",
      beforeClaimDate: "2026-09-12",
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "onchain_reconciled", claimed_at: "2026-09-11" }),
      expect.anything(),
    );
  });

  it("never throws when the sweep query itself errors", async () => {
    mockSweepQuery.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(
      sweepStaleClaimIntents({ userAddress: USER_ADDRESS, questId: "quest-1", beforeClaimDate: "2026-09-12" }),
    ).resolves.toBeUndefined();
  });

  it("never throws when reconciling one swept intent fails — other rows are unaffected", async () => {
    const bad = baseIntent({ id: "stale-bad", status: "issued", tx_hash: null, claim_date: "2026-09-10" });
    const good = baseIntent({ id: "stale-good", status: "issued", tx_hash: null, claim_date: "2026-09-11" });
    mockSweepQuery.mockResolvedValue({ data: [bad, good], error: null });
    mockReadContract.mockRejectedValueOnce(new Error("RPC blew up")).mockResolvedValueOnce(true);

    // "bad" throws before any DB write, so only "good"'s updates ever reach
    // this mock — seed it there instead of the generic default baseIntent().
    let current: any = good;
    mockUpdateSingle.mockImplementation((patch: any) => {
      current = { ...current, ...patch };
      return Promise.resolve({ data: current, error: null });
    });

    await expect(
      sweepStaleClaimIntents({ userAddress: USER_ADDRESS, questId: "quest-1", beforeClaimDate: "2026-09-12" }),
    ).resolves.toBeUndefined();

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ claimed_at: "2026-09-11" }),
      expect.anything(),
    );
  });

  it("does nothing when there is nothing to sweep", async () => {
    mockSweepQuery.mockResolvedValue({ data: [], error: null });
    await sweepStaleClaimIntents({ userAddress: USER_ADDRESS, questId: "quest-1", beforeClaimDate: "2026-09-12" });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockUpdateSingle).not.toHaveBeenCalled();
  });
});

describe("createIntent — concurrent first-request creation", () => {
  const opts = {
    userAddress: USER_ADDRESS,
    questId: "quest-1",
    claimDate: "2026-09-12",
    dayNonce: 20708n,
    deadline: 1789257599n,
    basePoints: 10,
    awardedPoints: 10,
    amountWei: 10n * 10n ** 18n,
    vaultBoost: { applied: false, multiplier: 1, minBalanceUsdt: 0 },
  };

  it("returns the freshly inserted row on an uncontested first request", async () => {
    const inserted = baseIntent({ id: "intent-fresh" });
    mockInsertSingle.mockResolvedValue({ data: inserted, error: null });

    const result = await createIntent(opts);
    expect(result).toEqual(inserted);
    expect(mockSelectMaybeSingle).not.toHaveBeenCalled();
  });

  it("reuses the winner's row instead of erroring when two requests race the unique (user, quest, date) constraint", async () => {
    // Supabase surfaces the losing insert as a 23505 unique-violation error
    // with no data — this is the concurrent "two taps at once" scenario the
    // unique index on (user_address, quest_id, claim_date) exists to prevent
    // a duplicate reward calculation for.
    mockInsertSingle.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });
    const winnerRow = baseIntent({ id: "intent-winner", points_awarded: 10, base_points: 10 });
    mockSelectMaybeSingle.mockResolvedValue({ data: winnerRow, error: null });

    const result = await createIntent(opts);

    // The loser must return the SAME frozen reward the winner got — never
    // recompute (decision 3).
    expect(result).toEqual(winnerRow);
  });

  it("propagates a non-duplicate insert error rather than masking it", async () => {
    mockInsertSingle.mockResolvedValue({ data: null, error: { code: "23503", message: "fk violation" } });
    await expect(createIntent(opts)).rejects.toMatchObject({ code: "23503" });
  });

  it("throws if the row can be neither inserted nor found after a reported duplicate (data-loss guard)", async () => {
    mockInsertSingle.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });
    mockSelectMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(createIntent(opts)).rejects.toThrow(/Failed to create or find/);
  });
});

describe("createGenericIntent — non-daily quest families", () => {
  it("inserts a row with a null claim_date/day_nonce and the family's own finalizer payload", async () => {
    const inserted = baseIntent({
      claim_family: "daily_transfer",
      scope_key: "2026-09-12",
      claim_nonce: "123456789",
      finalizer_kind: "daily_engagement",
      finalizer_payload: { questId: "quest-transfer", claimDate: "2026-09-12" },
      claim_date: null as any,
      day_nonce: null as any,
    });
    mockInsertSingle.mockResolvedValue({ data: inserted, error: null });

    const result = await createGenericIntent({
      userAddress: USER_ADDRESS,
      questId: "quest-transfer",
      scopeKey: "2026-09-12",
      claimNonce: 123456789n,
      claimFamily: "daily_transfer",
      deadline: 1789257599n,
      basePoints: 30,
      awardedPoints: 30,
      amountWei: 30n * 10n ** 18n,
      vaultBoost: { applied: false, multiplier: 1, minBalanceUsdt: 0 },
      finalizerKind: "daily_engagement",
      finalizerPayload: { questId: "quest-transfer", claimDate: "2026-09-12" },
    });

    expect(result).toEqual(inserted);
    expect(mockInsertSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        claim_family: "daily_transfer",
        scope_key: "2026-09-12",
        claim_nonce: "123456789",
        claim_date: null,
        day_nonce: null,
      }),
    );
  });

  it("reuses the winning row for a concurrent generic-family creation without recomputing the reward", async () => {
    mockInsertSingle.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });
    const winner = baseIntent({ claim_family: "daily_transfer", scope_key: "2026-09-12" });
    mockSelectMaybeSingle.mockResolvedValue({ data: winner, error: null });

    const result = await createGenericIntent({
      userAddress: USER_ADDRESS,
      questId: "quest-transfer",
      scopeKey: "2026-09-12",
      claimNonce: 123456789n,
      claimFamily: "daily_transfer",
      deadline: 1789257599n,
      basePoints: 30,
      awardedPoints: 30,
      amountWei: 30n * 10n ** 18n,
      vaultBoost: { applied: false, multiplier: 1, minBalanceUsdt: 0 },
      finalizerKind: "daily_engagement",
      finalizerPayload: { questId: "quest-transfer", claimDate: "2026-09-12" },
    });

    expect(result).toEqual(winner);
  });
});

describe("getIntentForScope / getIntentForDay", () => {
  it("getIntentForDay is exactly getIntentForScope for the daily_checkin family (scope_key === claim_date)", async () => {
    const intent = baseIntent();
    mockSelectMaybeSingle.mockResolvedValue({ data: intent, error: null });

    const byScope = await getIntentForScope(USER_ADDRESS, "quest-1", "2026-09-12");
    const byDay = await getIntentForDay(USER_ADDRESS, "quest-1", "2026-09-12");

    expect(byScope).toEqual(intent);
    expect(byDay).toEqual(intent);
  });
});

describe("reconcileIntent — streak_engagement finalizer", () => {
  it("calls the atomic advance_streak_and_engage RPC with the previous scope key, not a raw upsert", async () => {
    const intent = baseIntent({
      status: "issued",
      tx_hash: null,
      claim_family: "daily_balance_streak_10",
      finalizer_kind: "streak_engagement",
      finalizer_payload: { questId: "quest-1", scope: "daily", scopeKey: "2026-09-12", claimedAt: "2026-09-12" },
    });
    mockReadContract.mockResolvedValue(true); // claimed() confirms the mint
    let current: any = intent;
    mockUpdateSingle.mockImplementation((patch: any) => {
      current = { ...current, ...patch };
      return Promise.resolve({ data: current, error: null });
    });

    const result = await reconcileIntent(intent);

    expect(result.status).toBe("confirmed");
    expect(mockUpsert).not.toHaveBeenCalled(); // no direct daily_engagements write for this finalizer kind
    expect(mockRpc).toHaveBeenCalledWith(
      "advance_streak_and_engage",
      expect.objectContaining({
        p_user_address: USER_ADDRESS,
        p_quest_id: "quest-1",
        p_scope: "daily",
        p_scope_key: "2026-09-12",
        p_previous_scope_key: "2026-09-11",
        p_claimed_at: "2026-09-12",
        p_points_awarded: 10,
        p_source: "onchain_reconciled",
      }),
    );
  });

  it("derives the previous scope key correctly for a weekly-scoped streak", async () => {
    const intent = baseIntent({
      status: "issued",
      tx_hash: null,
      claim_family: "weekly_topup_streak",
      finalizer_kind: "streak_engagement",
      finalizer_payload: { questId: "quest-1", scope: "weekly", scopeKey: "2026-W02", claimedAt: "2026-W02" },
    });
    mockReadContract.mockResolvedValue(true);
    let current: any = intent;
    mockUpdateSingle.mockImplementation((patch: any) => {
      current = { ...current, ...patch };
      return Promise.resolve({ data: current, error: null });
    });

    await reconcileIntent(intent);

    expect(mockRpc).toHaveBeenCalledWith(
      "advance_streak_and_engage",
      expect.objectContaining({ p_scope_key: "2026-W02", p_previous_scope_key: "2026-W01" }),
    );
  });

  it("propagates an RPC error rather than silently marking the streak advanced", async () => {
    const intent = baseIntent({
      status: "issued",
      tx_hash: null,
      finalizer_kind: "streak_engagement",
      finalizer_payload: { questId: "quest-1", scope: "daily", scopeKey: "2026-09-12" },
    });
    mockReadContract.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ data: null, error: { message: "deadlock detected" } });
    let current: any = intent;
    mockUpdateSingle.mockImplementation((patch: any) => {
      current = { ...current, ...patch };
      return Promise.resolve({ data: current, error: null });
    });

    await expect(reconcileIntent(intent)).rejects.toMatchObject({ message: "deadlock detected" });
  });
});

describe("refreshIntentDeadline", () => {
  it("returns an expired intent to issued with a new deadline, same id/nonce/amount", async () => {
    const intent = baseIntent({ status: "expired", tx_hash: null, deadline: "1000" });
    let current: any = intent;
    mockUpdateSingle.mockImplementation((patch: any) => {
      current = { ...current, ...patch };
      return Promise.resolve({ data: current, error: null });
    });

    const result = await refreshIntentDeadline(intent, 2000n);

    expect(result.status).toBe("issued");
    expect(result.deadline).toBe("2000");
    expect(result.id).toBe(intent.id);
    expect(result.claim_nonce).toBe(intent.claim_nonce);
    expect(result.amount_wei).toBe(intent.amount_wei);
  });

  it("is a no-op on an already-confirmed intent", async () => {
    const intent = baseIntent({ status: "confirmed" });
    const result = await refreshIntentDeadline(intent, 9999n);
    expect(result).toBe(intent);
    expect(mockUpdateSingle).not.toHaveBeenCalled();
  });
});
