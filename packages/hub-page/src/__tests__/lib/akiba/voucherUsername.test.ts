import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpcResult: { data: null as unknown, error: null as { message: string } | null },
  profile: null as { username: string } | null,
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc, from: mockFrom }),
}));
vi.mock("@/lib/akiba/canonicalPartnerQuests", () => ({
  resolveHubQuestCanonical: async () => "canonical-1",
}));

const { resolveVoucherRecipientUsername, getActiveUsernameForHubUser } = await import(
  "@/lib/akiba/voucherUsername"
);

describe("resolveVoucherRecipientUsername", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockImplementation(() => Promise.resolve(state.rpcResult));
  });

  it("resolves a valid username to its hub_user_id", async () => {
    state.rpcResult = {
      data: [{ ok: true, error_code: null, username: "amina", username_normalized: "amina", hub_user_id: "hub-1", canonical_id: "canonical-1" }],
      error: null,
    };

    const result = await resolveVoucherRecipientUsername("@Amina");

    expect(mockRpc).toHaveBeenCalledWith("resolve_voucher_recipient_username", { p_username: "@Amina" });
    expect(result).toEqual({
      ok: true,
      username: "amina",
      usernameNormalized: "amina",
      hubUserId: "hub-1",
      canonicalId: "canonical-1",
    });
  });

  it("fails closed with USERNAME_NOT_FOUND when nothing matches", async () => {
    state.rpcResult = { data: [{ ok: false, error_code: "USERNAME_NOT_FOUND" }], error: null };

    const result = await resolveVoucherRecipientUsername("nobody");

    expect(result).toEqual({ ok: false, errorCode: "USERNAME_NOT_FOUND" });
  });

  it("fails closed with USERNAME_IDENTITY_UNAVAILABLE on an ambiguous/incomplete link", async () => {
    state.rpcResult = { data: [{ ok: false, error_code: "USERNAME_IDENTITY_UNAVAILABLE" }], error: null };

    const result = await resolveVoucherRecipientUsername("amina");

    expect(result).toEqual({ ok: false, errorCode: "USERNAME_IDENTITY_UNAVAILABLE" });
  });

  it("throws rather than silently resolving when the RPC itself errors", async () => {
    state.rpcResult = { data: null, error: { message: "db down" } };

    await expect(resolveVoucherRecipientUsername("amina")).rejects.toThrow(/db down/);
  });
});

describe("getActiveUsernameForHubUser", () => {
  beforeEach(() => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.profile, error: null }),
        }),
      }),
    }));
  });

  it("returns the member's current username when claimed", async () => {
    state.profile = { username: "amina" };

    const username = await getActiveUsernameForHubUser({ hubUserId: "hub-1", email: null });

    expect(username).toBe("amina");
  });

  it("returns null when the member hasn't claimed a username yet", async () => {
    state.profile = null;

    const username = await getActiveUsernameForHubUser({ hubUserId: "hub-1", email: null });

    expect(username).toBeNull();
  });
});
