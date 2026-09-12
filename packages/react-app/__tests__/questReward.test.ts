import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockMaybeSingle = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => mockMaybeSingle(),
        }),
      }),
    }),
  },
}));

// VAULT_QUEST_REWARD_MULTIPLIER / VAULT_QUEST_BOOST_MIN_BALANCE are read once
// at module load, so each test needs its own fresh module instance loaded
// after the env vars for that scenario are set.
async function loadWithEnv(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return import("@/lib/server/questReward");
}

beforeEach(() => {
  mockMaybeSingle.mockReset();
});

afterEach(() => {
  delete process.env.VAULT_QUEST_REWARD_MULTIPLIER;
  delete process.env.VAULT_QUEST_BOOST_MIN_BALANCE;
});

describe("computeQuestReward", () => {
  it("does not boost when the vault balance is below the minimum", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { balance_usdt: "5" }, error: null });
    const { computeQuestReward } = await loadWithEnv({
      VAULT_QUEST_REWARD_MULTIPLIER: "1.5",
      VAULT_QUEST_BOOST_MIN_BALANCE: "10",
    });

    const reward = await computeQuestReward("0xabc", 10);

    expect(reward.basePoints).toBe(10);
    expect(reward.awardedPoints).toBe(10);
    expect(reward.vaultBoost).toEqual({
      applied: false,
      multiplier: 1.5,
      balanceUsdt: "5",
      minBalanceUsdt: 10,
    });
  });

  it("applies the multiplier and rounds up when balance clears the minimum", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { balance_usdt: "25" }, error: null });
    const { computeQuestReward } = await loadWithEnv({
      VAULT_QUEST_REWARD_MULTIPLIER: "1.5",
      VAULT_QUEST_BOOST_MIN_BALANCE: "10",
    });

    const reward = await computeQuestReward("0xabc", 10);

    expect(reward.awardedPoints).toBe(15); // ceil(10 * 1.5)
    expect(reward.vaultBoost.applied).toBe(true);
  });

  it("freezes the reward independent of later balance changes (retry never recomputes)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { balance_usdt: "25" }, error: null });
    const { computeQuestReward } = await loadWithEnv({
      VAULT_QUEST_REWARD_MULTIPLIER: "1.5",
      VAULT_QUEST_BOOST_MIN_BALANCE: "10",
    });

    const first = await computeQuestReward("0xabc", 10);
    expect(first.awardedPoints).toBe(15);

    // A caller that stores `first` and never calls computeQuestReward again
    // (as the intent-based voucher route does on retry) is unaffected by a
    // subsequent balance drop — this test documents that computeQuestReward
    // itself is a pure point-in-time calculation, and freezing is the
    // caller's responsibility (only a newly created intent may call it).
    mockMaybeSingle.mockResolvedValueOnce({ data: { balance_usdt: "0" }, error: null });
    const second = await computeQuestReward("0xabc", 10);
    expect(second.awardedPoints).toBe(10);
    expect(first.awardedPoints).toBe(15);
  });

  it("skips the vault lookup entirely when the multiplier is disabled", async () => {
    const { computeQuestReward } = await loadWithEnv({ VAULT_QUEST_REWARD_MULTIPLIER: "1" });

    const reward = await computeQuestReward("0xabc", 10);

    expect(mockMaybeSingle).not.toHaveBeenCalled();
    expect(reward.awardedPoints).toBe(10);
    expect(reward.vaultBoost.applied).toBe(false);
  });

  it("treats a failed vault lookup as no boost rather than throwing", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: "db down" } });
    const { computeQuestReward } = await loadWithEnv({ VAULT_QUEST_REWARD_MULTIPLIER: "1.5" });

    const reward = await computeQuestReward("0xabc", 10);

    expect(reward.awardedPoints).toBe(10);
    expect(reward.vaultBoost.applied).toBe(false);
  });
});
