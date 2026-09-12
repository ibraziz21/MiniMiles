import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetChainId = vi.fn();
const mockGetCode = vi.fn();
const mockReadContract = vi.fn();

vi.mock("@/lib/celoClient", () => ({
  celoClient: {
    getChainId: () => mockGetChainId(),
    getCode: (...a: any[]) => mockGetCode(...a),
    readContract: (...a: any[]) => mockReadContract(...a),
  },
}));

const mockGetVoucherSignerAddress = vi.fn();
vi.mock("@/lib/server/dailyClaimSigner", () => ({
  getVoucherSignerAddress: () => mockGetVoucherSignerAddress(),
}));

const CLAIMER_ADDRESS = "0xa9e6adb52e74151553c140615a09119d501c75ce";
const MILES_TOKEN = "0xab93400000751fc17918940C202A66066885d628";
const SIGNER_ADDRESS = "0x7d63d39d88eb0d8754111c706136f5bd7ae84403";

// The module caches its result for CACHE_TTL_MS, so each scenario needs a
// fresh module instance loaded after its env/mocks are set up (mirrors the
// module-load-time pattern already used for questReward.ts and
// dailyClaimSigner.ts in this test suite).
async function loadWithEnv(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return import("@/lib/server/dailyClaimConfig");
}

beforeEach(() => {
  mockGetChainId.mockReset().mockResolvedValue(42220);
  mockGetCode.mockReset().mockResolvedValue("0x6001600155");
  mockGetVoucherSignerAddress.mockReset().mockReturnValue(SIGNER_ADDRESS);
  mockReadContract.mockReset().mockImplementation(({ functionName }: { functionName: string }) => {
    if (functionName === "milesToken") return Promise.resolve(MILES_TOKEN);
    if (functionName === "signer") return Promise.resolve(SIGNER_ADDRESS);
    if (functionName === "minters") return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  delete process.env.DAILY_QUEST_CLAIMER_ADDRESS;
  delete process.env.MINIPOINTS_V2_ADDRESS;
});

describe("validateDailyClaimConfig", () => {
  it("passes when every on-chain invariant matches configuration", async () => {
    const { validateDailyClaimConfig } = await loadWithEnv({
      DAILY_QUEST_CLAIMER_ADDRESS: CLAIMER_ADDRESS,
      MINIPOINTS_V2_ADDRESS: MILES_TOKEN,
    });

    const result = await validateDailyClaimConfig();
    expect(result).toEqual({ ok: true, claimerAddress: CLAIMER_ADDRESS });
  });

  it("fails closed on a malformed claimer address without ever touching the chain", async () => {
    const { validateDailyClaimConfig } = await loadWithEnv({
      DAILY_QUEST_CLAIMER_ADDRESS: "not-an-address",
      MINIPOINTS_V2_ADDRESS: MILES_TOKEN,
    });

    const result = await validateDailyClaimConfig();
    expect(result.ok).toBe(false);
    expect(mockGetChainId).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC is on the wrong chain", async () => {
    mockGetChainId.mockResolvedValue(8453); // Base, not Celo
    const { validateDailyClaimConfig } = await loadWithEnv({
      DAILY_QUEST_CLAIMER_ADDRESS: CLAIMER_ADDRESS,
      MINIPOINTS_V2_ADDRESS: MILES_TOKEN,
    });

    const result = await validateDailyClaimConfig();
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: expect.stringMatching(/chainId/i) }));
  });

  it("fails closed when there is no contract code at the claimer address", async () => {
    mockGetCode.mockResolvedValue("0x");
    const { validateDailyClaimConfig } = await loadWithEnv({
      DAILY_QUEST_CLAIMER_ADDRESS: CLAIMER_ADDRESS,
      MINIPOINTS_V2_ADDRESS: MILES_TOKEN,
    });

    const result = await validateDailyClaimConfig();
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: expect.stringMatching(/no contract code/i) }));
  });

  it("fails closed when the claimer's milesToken() does not match configured AkibaMiles V2", async () => {
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "milesToken") return Promise.resolve("0x000000000000000000000000000000000000ff");
      if (functionName === "signer") return Promise.resolve(SIGNER_ADDRESS);
      return Promise.resolve(true);
    });
    const { validateDailyClaimConfig } = await loadWithEnv({
      DAILY_QUEST_CLAIMER_ADDRESS: CLAIMER_ADDRESS,
      MINIPOINTS_V2_ADDRESS: MILES_TOKEN,
    });

    const result = await validateDailyClaimConfig();
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: expect.stringMatching(/milesToken/) }));
  });

  it("fails closed when the claimer's signer() does not match the voucher signing key", async () => {
    mockGetVoucherSignerAddress.mockReturnValue("0x0000000000000000000000000000000000dEaD");
    const { validateDailyClaimConfig } = await loadWithEnv({
      DAILY_QUEST_CLAIMER_ADDRESS: CLAIMER_ADDRESS,
      MINIPOINTS_V2_ADDRESS: MILES_TOKEN,
    });

    const result = await validateDailyClaimConfig();
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: expect.stringMatching(/signer/i) }));
  });

  it("fails closed when the claimer is not a registered minter", async () => {
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "milesToken") return Promise.resolve(MILES_TOKEN);
      if (functionName === "signer") return Promise.resolve(SIGNER_ADDRESS);
      if (functionName === "minters") return Promise.resolve(false);
      return Promise.resolve(undefined);
    });
    const { validateDailyClaimConfig } = await loadWithEnv({
      DAILY_QUEST_CLAIMER_ADDRESS: CLAIMER_ADDRESS,
      MINIPOINTS_V2_ADDRESS: MILES_TOKEN,
    });

    const result = await validateDailyClaimConfig();
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: expect.stringMatching(/minter/i) }));
  });

  it("fails closed (never throws) when the RPC call itself errors", async () => {
    mockGetChainId.mockRejectedValue(new Error("RPC unreachable"));
    const { validateDailyClaimConfig } = await loadWithEnv({
      DAILY_QUEST_CLAIMER_ADDRESS: CLAIMER_ADDRESS,
      MINIPOINTS_V2_ADDRESS: MILES_TOKEN,
    });

    const result = await validateDailyClaimConfig();
    expect(result.ok).toBe(false);
  });

  it("caches a passing result so repeated calls don't re-hit the RPC", async () => {
    const { validateDailyClaimConfig } = await loadWithEnv({
      DAILY_QUEST_CLAIMER_ADDRESS: CLAIMER_ADDRESS,
      MINIPOINTS_V2_ADDRESS: MILES_TOKEN,
    });

    await validateDailyClaimConfig();
    await validateDailyClaimConfig();
    expect(mockGetChainId).toHaveBeenCalledTimes(1);
  });
});
