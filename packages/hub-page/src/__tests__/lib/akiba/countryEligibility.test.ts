import { beforeEach, describe, expect, it, vi } from "vitest";

type MockResult = { data: unknown; error: any };

function makeChain(result: MockResult | (() => MockResult)) {
  const resolve = () => (typeof result === "function" ? result() : result);
  const chain: Record<string, any> = {};
  for (const method of ["select", "eq"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(resolve()));
  return chain;
}

const state = vi.hoisted(() => ({
  hubProfileCountry: null as string | null,
  partnerCountry: null as string | null,
  legacyCountry: null as string | null,
}));

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

vi.mock("@/lib/akiba/hubProfile", () => ({
  resolveHubProfile: () =>
    Promise.resolve({
      activeRow: { country: state.legacyCountry },
      walletAddress: null,
      displayName: "You",
      needsPicker: false,
      rows: [],
    }),
}));

import { resolveMemberCountry, resolveMerchantCountry, evaluateCountryEligibility } from "@/lib/akiba/countryEligibility";

describe("evaluateCountryEligibility", () => {
  it("is eligible when both countries match", () => {
    expect(evaluateCountryEligibility("KE", "KE").eligible).toBe(true);
  });

  it("is ineligible when both countries are known and differ", () => {
    const result = evaluateCountryEligibility("KE", "UG");
    expect(result.eligible).toBe(false);
    expect(result.memberCountry).toBe("KE");
    expect(result.merchantCountry).toBe("UG");
  });

  it("fails open when the member's country is unknown", () => {
    expect(evaluateCountryEligibility(null, "UG").eligible).toBe(true);
  });

  it("fails open when the merchant's country is unknown", () => {
    expect(evaluateCountryEligibility("KE", null).eligible).toBe(true);
  });

  it("fails open when both are unknown", () => {
    expect(evaluateCountryEligibility(null, null).eligible).toBe(true);
  });

  it("normalizes the raw merchant country before comparing", () => {
    // normalizeCountry maps display names -> ISO; "Kenya" should match "KE".
    expect(evaluateCountryEligibility("KE", "Kenya").eligible).toBe(true);
  });
});

describe("resolveMemberCountry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.hubProfileCountry = null;
    state.legacyCountry = null;
    mockFrom.mockImplementation(() => makeChain({ data: { country: state.hubProfileCountry }, error: null }));
  });

  it("prefers hub_user_profiles.country over the legacy fallback", async () => {
    state.hubProfileCountry = "Kenya";
    state.legacyCountry = "Uganda";
    const result = await resolveMemberCountry({ hubUserId: "u1", email: null });
    expect(result.code).toBe("KE");
  });

  it("falls back to the legacy country when hub_user_profiles has none", async () => {
    state.hubProfileCountry = null;
    state.legacyCountry = "Uganda";
    const result = await resolveMemberCountry({ hubUserId: "u1", email: null });
    expect(result.code).toBe("UG");
  });

  it("uses the caller-supplied legacyCountry instead of resolving one, when provided", async () => {
    state.hubProfileCountry = null;
    const result = await resolveMemberCountry({ hubUserId: "u1", email: null, legacyCountry: "Rwanda" });
    expect(result.code).toBe("RW");
  });

  it("returns null when nothing is set", async () => {
    const result = await resolveMemberCountry({ hubUserId: "u1", email: null });
    expect(result.code).toBeNull();
  });
});

describe("resolveMerchantCountry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.partnerCountry = null;
    mockFrom.mockImplementation(() => makeChain({ data: { country: state.partnerCountry }, error: null }));
  });

  it("normalizes the partner's stored country", async () => {
    state.partnerCountry = "KE";
    expect(await resolveMerchantCountry("merchant-1")).toBe("KE");
  });

  it("returns null when the partner has no country set", async () => {
    state.partnerCountry = null;
    expect(await resolveMerchantCountry("merchant-1")).toBeNull();
  });
});
