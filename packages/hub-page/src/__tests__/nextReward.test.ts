import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data: unknown; error: any };

function makeChain(result: MockResult | (() => MockResult)) {
  const resolve = () => (typeof result === "function" ? result() : result);
  const chain: Record<string, any> = {};
  for (const method of ["select", "eq", "not", "in", "order", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(resolve()));
  chain.then = (resolvePromise: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(resolve()).then(resolvePromise, reject);
  return chain;
}

const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

const mockGetVoucherSpendableBalance = vi.fn();
vi.mock("@/lib/akiba/voucherSpendableBalance", () => ({
  getVoucherSpendableBalance: (...args: unknown[]) => mockGetVoucherSpendableBalance(...args),
}));

vi.mock("@/lib/akiba/hubProfile", () => ({
  resolveHubProfile: () => Promise.resolve({ activeRow: null, walletAddress: null, displayName: "You", needsPicker: false, rows: [] }),
}));

vi.mock("@/lib/merchants/enrich", () => ({
  getPurchaseAffinity: () => Promise.resolve(new Set<string>()),
}));

const mockIsHubQuestsEnabledFor = vi.fn();
vi.mock("@/lib/akiba/hubQuestRollout", () => ({
  isHubQuestsEnabledFor: (...args: unknown[]) => mockIsHubQuestsEnabledFor(...args),
}));

const mockIsGamesEnabledFor = vi.fn();
vi.mock("@/lib/games/gamesRollout", () => ({
  isGamesEnabledFor: (...args: unknown[]) => mockIsGamesEnabledFor(...args),
}));

const mockGetHubQuestStatuses = vi.fn();
vi.mock("@/lib/akiba/questStatus", () => ({
  getHubQuestStatuses: (...args: unknown[]) => mockGetHubQuestStatuses(...args),
}));

const mockResolveHubQuestCanonical = vi.fn();
const mockGamesBackendStatus = vi.fn();
vi.mock("@/lib/akiba/canonicalPartnerQuests", () => ({
  resolveHubQuestCanonical: (...args: unknown[]) => mockResolveHubQuestCanonical(...args),
}));
vi.mock("@/lib/games/backendClient", () => ({
  gamesBackend: { status: (...args: unknown[]) => mockGamesBackendStatus(...args) },
}));

import {
  computeProgress,
  selectRewardCandidate,
  getNextRewardSummary,
  getNextRewardWays,
  type RewardCandidate,
} from "@/lib/akiba/nextReward";

function candidate(overrides: Partial<RewardCandidate> = {}): RewardCandidate {
  return {
    templateId: "tmpl-1",
    merchantId: "merchant-1",
    merchantSlug: "merchant-1",
    merchantName: "Alpha Store",
    merchantLogoUrl: null,
    operatingModel: "physical",
    countryCode: null,
    title: "10% off",
    benefitLabel: "10% off",
    milesCost: 1000,
    expiresAt: null,
    gapMiles: 0,
    affordable: false,
    countryMatch: false,
    hasPurchaseAffinity: false,
    ...overrides,
  };
}

describe("computeProgress", () => {
  it("zero balance", () => {
    expect(computeProgress(0, 2000)).toEqual({ gapMiles: 2000, percent: 0, affordable: false });
  });

  it("partial progress", () => {
    expect(computeProgress(180, 2000)).toEqual({ gapMiles: 1820, percent: 9, affordable: false });
  });

  it("exact target balance", () => {
    expect(computeProgress(2000, 2000)).toEqual({ gapMiles: 0, percent: 100, affordable: true });
  });

  it("balance above target caps percent at 100 and does not go negative on gap", () => {
    expect(computeProgress(5000, 2000)).toEqual({ gapMiles: 0, percent: 100, affordable: true });
  });

  it("large values", () => {
    expect(computeProgress(123_456, 250_000)).toEqual({ gapMiles: 126_544, percent: 49, affordable: false });
  });
});

describe("selectRewardCandidate", () => {
  it("returns null for an empty candidate list", () => {
    expect(selectRewardCandidate([], { memberCountryName: null })).toBeNull();
  });

  it("an affordable candidate always wins over locked candidates, regardless of gap size", () => {
    const affordable = candidate({ templateId: "affordable", milesCost: 5000, gapMiles: 0, affordable: true });
    const cheaperButLocked = candidate({ templateId: "locked", milesCost: 100, gapMiles: 50, affordable: false });
    const result = selectRewardCandidate([cheaperButLocked, affordable], { memberCountryName: null });
    expect(result?.candidate.templateId).toBe("affordable");
    expect(result?.recommendationLabel).toBe("available_now");
    expect(result?.explanation).toBe("Available with your current balance");
  });

  it("the lowest remaining gap wins within the relevant pool", () => {
    const near = candidate({ templateId: "near", gapMiles: 50 });
    const far = candidate({ templateId: "far", gapMiles: 500 });
    const result = selectRewardCandidate([far, near], { memberCountryName: null });
    expect(result?.candidate.templateId).toBe("near");
  });

  it("purchase affinity breaks an equal-gap tie and is labelled recommended_for_you", () => {
    const withAffinity = candidate({ templateId: "affinity", gapMiles: 100, hasPurchaseAffinity: true, merchantName: "Zeta" });
    const without = candidate({ templateId: "plain", gapMiles: 100, merchantName: "Alpha" });
    const result = selectRewardCandidate([without, withAffinity], { memberCountryName: null });
    expect(result?.candidate.templateId).toBe("affinity");
    expect(result?.recommendationLabel).toBe("recommended_for_you");
    expect(result?.explanation).toBe("You have shopped here before");
  });

  it("country match breaks a remaining equal-gap tie when there is no affinity match", () => {
    const countryMatch = candidate({ templateId: "country", gapMiles: 100, countryMatch: true, merchantName: "Zeta" });
    const noMatch = candidate({ templateId: "plain", gapMiles: 100, merchantName: "Alpha" });
    const result = selectRewardCandidate([noMatch, countryMatch], { memberCountryName: "Kenya" });
    expect(result?.candidate.templateId).toBe("country");
    expect(result?.recommendationLabel).toBe("recommended_for_you");
    expect(result?.explanation).toBe("Available from a merchant in Kenya");
  });

  it("an online candidate stays eligible via relevance without claiming a false country match", () => {
    const online = candidate({ templateId: "online", gapMiles: 100, operatingModel: "online", merchantName: "Zeta" });
    const plain = candidate({ templateId: "plain", gapMiles: 100, merchantName: "Alpha" });
    const result = selectRewardCandidate([plain, online], { memberCountryName: null });
    expect(result?.candidate.templateId).toBe("online");
    expect(result?.candidate.countryMatch).toBe(false);
    expect(result?.explanation).toBe("Available online");
  });

  it("falls back to ranking every candidate when the relevant subset is empty, and labels it easiest_to_unlock", () => {
    const cheapest = candidate({ templateId: "cheapest", gapMiles: 50, merchantName: "Beta" });
    const other = candidate({ templateId: "other", gapMiles: 500, merchantName: "Alpha" });
    const result = selectRewardCandidate([other, cheapest], { memberCountryName: null });
    expect(result?.candidate.templateId).toBe("cheapest");
    expect(result?.recommendationLabel).toBe("easiest_to_unlock");
  });

  it("deterministic tie-breakers (expiresAt, name, id) return the same target on repeat calls", () => {
    const a = candidate({ templateId: "b-template", merchantName: "Same Store", gapMiles: 100, expiresAt: null });
    const b = candidate({ templateId: "a-template", merchantName: "Same Store", gapMiles: 100, expiresAt: null });
    const first = selectRewardCandidate([a, b], { memberCountryName: null });
    const second = selectRewardCandidate([b, a], { memberCountryName: null });
    expect(first?.candidate.templateId).toBe("a-template");
    expect(second?.candidate.templateId).toBe("a-template");
  });

  it("an earlier expiry wins over a later/no expiry at an equal gap", () => {
    const soon = candidate({ templateId: "soon", gapMiles: 100, expiresAt: "2026-01-01T00:00:00.000Z" });
    const never = candidate({ templateId: "never", gapMiles: 100, expiresAt: null });
    const result = selectRewardCandidate([never, soon], { memberCountryName: null });
    expect(result?.candidate.templateId).toBe("soon");
  });

  it("does NOT label recommended_for_you just because the winner happens to have affinity — only when affinity/country actually changed the pick", () => {
    // The affinity candidate already wins purely on gap size; a baseline
    // ranking (ignoring affinity/country) would pick the same candidate, so
    // affinity is incidental here and must not be credited for the pick.
    const winsOnGapAlone = candidate({
      templateId: "winner",
      gapMiles: 10,
      hasPurchaseAffinity: true,
      merchantName: "Zeta",
    });
    const loser = candidate({ templateId: "loser", gapMiles: 999, merchantName: "Alpha" });
    const result = selectRewardCandidate([loser, winsOnGapAlone], { memberCountryName: null });
    expect(result?.candidate.templateId).toBe("winner");
    expect(result?.recommendationLabel).toBe("easiest_to_unlock");
    expect(result?.explanation).toBe("Easiest available reward to unlock");
  });

  it("excludes candidates that were never made eligible in the first place (caller's job, but the pool must not add any back)", () => {
    // selectRewardCandidate trusts its input pool completely — a candidate
    // list of exactly one item still resolves.
    const only = candidate({ templateId: "only" });
    const result = selectRewardCandidate([only], { memberCountryName: null });
    expect(result?.candidate.templateId).toBe("only");
  });
});

describe("getNextRewardSummary", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockGetVoucherSpendableBalance.mockReset();
  });

  it("a spendable-balance failure produces balance_unavailable, not a fabricated zero", async () => {
    mockGetVoucherSpendableBalance.mockResolvedValue({ ok: true, balance: null, ledgerBalance: 0, chainBalance: null, chainStatus: "chain_unavailable", walletAddress: "0xabc" });
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await getNextRewardSummary({ hubUserId: "user-1", email: "a@example.com" });
    expect(result).toEqual({ state: "balance_unavailable" });
  });

  it("an availability/inventory query error produces inventory_unavailable, never no_eligible_reward", async () => {
    mockGetVoucherSpendableBalance.mockResolvedValue({ ok: true, balance: 100, ledgerBalance: 100, chainBalance: 0, chainStatus: "no_wallet", walletAddress: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "hub_user_profiles") return makeChain({ data: null, error: null });
      // spend_voucher_templates query fails
      return makeChain({ data: null, error: { message: "db down" } });
    });

    const result = await getNextRewardSummary({ hubUserId: "user-1", email: "a@example.com" });
    expect(result).toEqual({ state: "inventory_unavailable", balance: 100 });
  });

  it("a genuinely empty eligible-inventory result produces no_eligible_reward", async () => {
    mockGetVoucherSpendableBalance.mockResolvedValue({ ok: true, balance: 100, ledgerBalance: 100, chainBalance: 0, chainStatus: "no_wallet", walletAddress: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "hub_user_profiles") return makeChain({ data: null, error: null });
      return makeChain({ data: [], error: null });
    });
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await getNextRewardSummary({ hubUserId: "user-1", email: "a@example.com" });
    expect(result).toEqual({ state: "no_eligible_reward", balance: 100 });
  });
});

describe("getNextRewardWays", () => {
  beforeEach(() => {
    mockIsHubQuestsEnabledFor.mockReset();
    mockIsGamesEnabledFor.mockReset();
    mockGetHubQuestStatuses.mockReset();
    mockResolveHubQuestCanonical.mockReset();
    mockGamesBackendStatus.mockReset();
  });

  it("never calls quest evidence or the games backend when both rollouts are disabled", async () => {
    mockIsHubQuestsEnabledFor.mockReturnValue(false);
    mockIsGamesEnabledFor.mockReturnValue(false);

    const ways = await getNextRewardWays({ hubUserId: "user-1", email: "a@example.com" });

    expect(mockGetHubQuestStatuses).not.toHaveBeenCalled();
    expect(mockResolveHubQuestCanonical).not.toHaveBeenCalled();
    expect(mockGamesBackendStatus).not.toHaveBeenCalled();
    expect(ways).toEqual([
      { kind: "shopping", label: "Shop with Akiba merchants", certainty: "variable", href: "/merchants" },
    ]);
  });

  it("routes an eligible quest to /quests (where the Claim button lives) and a needs_action quest to its own actionHref", async () => {
    mockIsHubQuestsEnabledFor.mockReturnValue(true);
    mockIsGamesEnabledFor.mockReturnValue(false);
    mockGetHubQuestStatuses.mockResolvedValue([
      { key: "pass_activated", title: "Get your Akiba Pass", state: "eligible", miles: 20, actionHref: "/pass" },
      { key: "profile_country_set", title: "Tell us where you shop", state: "needs_action", miles: 50, actionHref: "/me" },
    ]);

    const ways = await getNextRewardWays({ hubUserId: "user-1", email: "a@example.com" });

    expect(ways[0]).toMatchObject({ kind: "quest", key: "pass_activated", href: "/quests" });
    expect(ways[1]).toMatchObject({ kind: "quest", key: "profile_country_set", href: "/me" });
  });

  it("excludes the circular voucher_redeemed quest even when eligible", async () => {
    mockIsHubQuestsEnabledFor.mockReturnValue(true);
    mockIsGamesEnabledFor.mockReturnValue(false);
    mockGetHubQuestStatuses.mockResolvedValue([
      { key: "voucher_redeemed", title: "Use your first voucher", state: "eligible", miles: 100, actionHref: "/vouchers" },
    ]);

    const ways = await getNextRewardWays({ hubUserId: "user-1", email: "a@example.com" });
    expect(ways.some((w) => w.kind === "quest" && w.key === "voucher_redeemed")).toBe(false);
  });

  it("omits completed and service_unavailable quests", async () => {
    mockIsHubQuestsEnabledFor.mockReturnValue(true);
    mockIsGamesEnabledFor.mockReturnValue(false);
    mockGetHubQuestStatuses.mockResolvedValue([
      { key: "a", title: "Done already", state: "completed", miles: 10, actionHref: "/a" },
      { key: "b", title: "Broken", state: "service_unavailable", miles: 10, actionHref: "/b" },
    ]);

    const ways = await getNextRewardWays({ hubUserId: "user-1", email: "a@example.com" });
    expect(ways).toEqual([
      { kind: "shopping", label: "Shop with Akiba merchants", certainty: "variable", href: "/merchants" },
    ]);
  });

  it("game potential sums remaining plays across both game types using the shared reward ceiling, and is omitted when the backend is unreachable", async () => {
    mockIsHubQuestsEnabledFor.mockReturnValue(false);
    mockIsGamesEnabledFor.mockReturnValue(true);
    mockResolveHubQuestCanonical.mockResolvedValue("canonical-1");
    mockGamesBackendStatus.mockImplementation((_identity: unknown, gameType: string) =>
      gameType === "rule_tap"
        ? Promise.resolve({ canonicalId: "canonical-1", playsToday: 0, playsRemaining: 5, nextResetAt: "", bestScoreToday: null })
        : Promise.resolve({ canonicalId: "canonical-1", playsToday: 0, playsRemaining: 5, nextResetAt: "", bestScoreToday: null })
    );

    const ways = await getNextRewardWays({ hubUserId: "user-1", email: "a@example.com" });
    expect(ways[0]).toMatchObject({ kind: "game", potentialMiles: 120, certainty: "up_to", href: "/games" });
  });

  it("mastery-v1: uses gameMilesAvailableToday per game, not playsRemaining * legacy ceiling", async () => {
    mockIsHubQuestsEnabledFor.mockReturnValue(false);
    mockIsGamesEnabledFor.mockReturnValue(true);
    mockResolveHubQuestCanonical.mockResolvedValue("canonical-1");
    mockGamesBackendStatus.mockImplementation((_identity: unknown, gameType: string) =>
      Promise.resolve({
        canonicalId: "canonical-1",
        playsToday: 0,
        playsRemaining: 5,
        nextResetAt: "",
        bestScoreToday: null,
        economyVersion: "mastery-v1",
        gameMilesAvailableToday: gameType === "rule_tap" ? 3 : 2,
        monthlyGameMilesRemaining: 40,
      })
    );

    const ways = await getNextRewardWays({ hubUserId: "user-1", email: "a@example.com" });
    // 3 (rule_tap) + 2 (memory_flip) = 5 — nowhere near playsRemaining(5) * 12 * 2 = 120.
    expect(ways[0]).toMatchObject({ kind: "game", potentialMiles: 5, certainty: "up_to", href: "/games" });
  });

  it("mastery-v1: caps the combined total by the shared monthly allowance, not just the per-game daily ceiling", async () => {
    mockIsHubQuestsEnabledFor.mockReturnValue(false);
    mockIsGamesEnabledFor.mockReturnValue(true);
    mockResolveHubQuestCanonical.mockResolvedValue("canonical-1");
    mockGamesBackendStatus.mockImplementation(() =>
      Promise.resolve({
        canonicalId: "canonical-1",
        playsToday: 0,
        playsRemaining: 5,
        nextResetAt: "",
        bestScoreToday: null,
        economyVersion: "mastery-v1",
        gameMilesAvailableToday: 3, // 3 + 3 = 6 desired across both games
        monthlyGameMilesRemaining: 2, // but only 2 Miles remain this month
      })
    );

    const ways = await getNextRewardWays({ hubUserId: "user-1", email: "a@example.com" });
    expect(ways[0]).toMatchObject({ kind: "game", potentialMiles: 2 });
  });

  it("mastery-v1: omits the game row once the monthly allowance is fully spent", async () => {
    mockIsHubQuestsEnabledFor.mockReturnValue(false);
    mockIsGamesEnabledFor.mockReturnValue(true);
    mockResolveHubQuestCanonical.mockResolvedValue("canonical-1");
    mockGamesBackendStatus.mockImplementation(() =>
      Promise.resolve({
        canonicalId: "canonical-1",
        playsToday: 0,
        playsRemaining: 5,
        nextResetAt: "",
        bestScoreToday: null,
        economyVersion: "mastery-v1",
        gameMilesAvailableToday: 3,
        monthlyGameMilesRemaining: 0,
      })
    );

    const ways = await getNextRewardWays({ hubUserId: "user-1", email: "a@example.com" });
    expect(ways.some((w) => w.kind === "game")).toBe(false);
  });

  it("omits the game row when every game-status call fails", async () => {
    mockIsHubQuestsEnabledFor.mockReturnValue(false);
    mockIsGamesEnabledFor.mockReturnValue(true);
    mockResolveHubQuestCanonical.mockResolvedValue("canonical-1");
    mockGamesBackendStatus.mockRejectedValue(new Error("backend down"));

    const ways = await getNextRewardWays({ hubUserId: "user-1", email: "a@example.com" });
    expect(ways.some((w) => w.kind === "game")).toBe(false);
  });

  it("caps the list at 3 rows, ordered eligible quests, then needs_action quests, then game, then shopping", async () => {
    mockIsHubQuestsEnabledFor.mockReturnValue(true);
    mockIsGamesEnabledFor.mockReturnValue(true);
    mockGetHubQuestStatuses.mockResolvedValue([
      { key: "q1", title: "Eligible one", state: "eligible", miles: 20, actionHref: "/a" },
      { key: "q2", title: "Eligible two", state: "eligible", miles: 30, actionHref: "/b" },
      { key: "q3", title: "Needs action", state: "needs_action", miles: 40, actionHref: "/c" },
    ]);
    mockResolveHubQuestCanonical.mockResolvedValue("canonical-1");
    mockGamesBackendStatus.mockResolvedValue({ canonicalId: "canonical-1", playsToday: 0, playsRemaining: 1, nextResetAt: "", bestScoreToday: null });

    const ways = await getNextRewardWays({ hubUserId: "user-1", email: "a@example.com" });
    expect(ways).toHaveLength(3);
    expect(ways.map((w) => (w.kind === "quest" ? w.key : w.kind))).toEqual(["q1", "q2", "q3"]);
  });
});
