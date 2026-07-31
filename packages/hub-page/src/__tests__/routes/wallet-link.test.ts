/**
 * Route tests for the verified wallet-linking flow
 * (production-readiness-security-spec.md §3.2, §3.6):
 *   POST /api/me/wallets/challenge
 *   POST /api/me/wallets/verify
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const state = vi.hoisted(() => ({
  user: { id: "hub-user-1", email: "a@b.com" } as { id: string; email: string | null } | null,
  challengeRow: null as Record<string, unknown> | null,
  linkRpcResult: [{ ok: true, error_code: null, address: "", ecosystem: "minipay" }] as unknown[],
  insertedChallenge: null as Record<string, unknown> | null,
  rateLimitOk: true,
  walletLinkingEnabled: true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

vi.mock("@/lib/rateLimit", () => ({
  checkAllRateLimits: async () => state.rateLimitOk,
}));

vi.mock("@/lib/featureFlags.server", () => ({
  walletLinkingFlag: () => ({ enabled: state.walletLinkingEnabled, reason: state.walletLinkingEnabled ? null : "disabled" }),
}));

vi.mock("@/lib/akiba/internal-events", () => ({
  reemitPassActivated: vi.fn(async () => {}),
}));

vi.mock("@/lib/akiba/legacyUsersBridge", () => ({
  bridgeLegacyUsersRow: vi.fn(async () => ({ ok: true, incidentRecorded: false })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "wallet_link_challenges") {
        return {
          update: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }),
          }),
          insert: (row: Record<string, unknown>) => {
            state.insertedChallenge = row;
            return {
              select: () => ({
                single: async () => ({ data: { id: "challenge-1" }, error: null }),
              }),
            };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.challengeRow, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (name: string) => {
      if (name === "link_verified_wallet") {
        return { data: state.linkRpcResult, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  }),
}));

function makeRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.user = { id: "hub-user-1", email: "a@b.com" };
  state.challengeRow = null;
  state.insertedChallenge = null;
  state.rateLimitOk = true;
  state.walletLinkingEnabled = true;
  state.linkRpcResult = [{ ok: true, error_code: null, address: "", ecosystem: "minipay" }];
});

describe("POST /api/me/wallets/challenge", () => {
  it("returns 401 when unauthenticated", async () => {
    state.user = null;
    const { POST } = await import("@/app/api/me/wallets/challenge/route");
    const res = await POST(makeRequest("/api/me/wallets/challenge", { ecosystem: "minipay", address: "0x" + "1".repeat(40), chainId: 42220 }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when the flag is disabled", async () => {
    state.walletLinkingEnabled = false;
    const { POST } = await import("@/app/api/me/wallets/challenge/route");
    const res = await POST(makeRequest("/api/me/wallets/challenge", { ecosystem: "minipay", address: "0x" + "1".repeat(40), chainId: 42220 }));
    expect(res.status).toBe(503);
  });

  it("returns 429 when rate limited", async () => {
    state.rateLimitOk = false;
    const { POST } = await import("@/app/api/me/wallets/challenge/route");
    const res = await POST(makeRequest("/api/me/wallets/challenge", { ecosystem: "minipay", address: "0x" + "1".repeat(40), chainId: 42220 }));
    expect(res.status).toBe(429);
  });

  it("returns 400 for an invalid ecosystem", async () => {
    const { POST } = await import("@/app/api/me/wallets/challenge/route");
    const res = await POST(makeRequest("/api/me/wallets/challenge", { ecosystem: "solana", address: "0x" + "1".repeat(40), chainId: 42220 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed address", async () => {
    const { POST } = await import("@/app/api/me/wallets/challenge/route");
    const res = await POST(makeRequest("/api/me/wallets/challenge", { ecosystem: "minipay", address: "not-an-address", chainId: 42220 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a chain ID that doesn't belong to the ecosystem", async () => {
    const { POST } = await import("@/app/api/me/wallets/challenge/route");
    const res = await POST(makeRequest("/api/me/wallets/challenge", { ecosystem: "minipay", address: "0x" + "1".repeat(40), chainId: 8453 }));
    expect(res.status).toBe(400);
  });

  it("creates a challenge and returns a message binding the user, address, and purpose", async () => {
    const { POST } = await import("@/app/api/me/wallets/challenge/route");
    const address = "0x" + "a".repeat(40);
    const res = await POST(makeRequest("/api/me/wallets/challenge", { ecosystem: "minipay", address, chainId: 42220 }));
    expect(res.status).toBe(200);
    const json = await res.json() as { challengeId: string; message: string };
    expect(json.challengeId).toBe("challenge-1");
    expect(json.message).toContain("Akiba Hub wallet link");
    expect(json.message).toContain(address);
    expect(json.message).toContain("Purpose: link_wallet");
    expect(state.insertedChallenge?.hub_user_id).toBe("hub-user-1");
    expect(state.insertedChallenge?.address).toBe(address);
  });
});

describe("POST /api/me/wallets/verify", () => {
  async function buildValidChallenge() {
    const account = privateKeyToAccount(generatePrivateKey());
    const address = account.address.toLowerCase();

    // Build the challenge the same way the challenge route would, then sign it.
    const { buildChallengeMessage, generateNonce, hashChallengeSecret } = await import("@/lib/wallet-link");
    const nonce = generateNonce();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 5 * 60 * 1000);
    const message = buildChallengeMessage({
      domain: "localhost:3003",
      hubUserId: "hub-user-1",
      address,
      ecosystem: "minipay",
      chainId: 42220,
      nonce,
      issuedAt: createdAt,
      expiresAt,
    });
    const signature = await account.signMessage({ message });

    state.challengeRow = {
      id: "challenge-1",
      hub_user_id: "hub-user-1",
      ecosystem: "minipay",
      address,
      nonce,
      nonce_hash: hashChallengeSecret(nonce),
      chain_id: 42220,
      expires_at: expiresAt.toISOString(),
      consumed_at: null,
      created_at: createdAt.toISOString(),
    };
    state.linkRpcResult = [{ ok: true, error_code: null, address, ecosystem: "minipay" }];

    return { signature, address };
  }

  it("returns 401 when unauthenticated", async () => {
    state.user = null;
    const { POST } = await import("@/app/api/me/wallets/verify/route");
    const res = await POST(makeRequest("/api/me/wallets/verify", { challengeId: "x", signature: "0xdead" }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the challenge doesn't exist", async () => {
    state.challengeRow = null;
    const { POST } = await import("@/app/api/me/wallets/verify/route");
    const res = await POST(makeRequest("/api/me/wallets/verify", { challengeId: "missing", signature: "0xdead" }));
    expect(res.status).toBe(404);
  });

  it("returns 409 for an already-consumed challenge", async () => {
    await buildValidChallenge();
    (state.challengeRow as Record<string, unknown>).consumed_at = new Date().toISOString();
    const { POST } = await import("@/app/api/me/wallets/verify/route");
    const res = await POST(makeRequest("/api/me/wallets/verify", { challengeId: "challenge-1", signature: "0xdead" }));
    expect(res.status).toBe(409);
  });

  it("returns 409 for an expired challenge", async () => {
    await buildValidChallenge();
    (state.challengeRow as Record<string, unknown>).expires_at = new Date(Date.now() - 1000).toISOString();
    const { POST } = await import("@/app/api/me/wallets/verify/route");
    const res = await POST(makeRequest("/api/me/wallets/verify", { challengeId: "challenge-1", signature: "0xdead" }));
    expect(res.status).toBe(409);
  });

  it("rejects a signature from the wrong wallet", async () => {
    await buildValidChallenge();
    const otherAccount = privateKeyToAccount(generatePrivateKey());
    const badSignature = await otherAccount.signMessage({ message: "some other message" });
    const { POST } = await import("@/app/api/me/wallets/verify/route");
    const res = await POST(makeRequest("/api/me/wallets/verify", { challengeId: "challenge-1", signature: badSignature }));
    expect(res.status).toBe(400);
  });

  it("links the wallet on a valid signature and returns the verified address", async () => {
    const { signature, address } = await buildValidChallenge();
    const { POST } = await import("@/app/api/me/wallets/verify/route");
    const res = await POST(makeRequest("/api/me/wallets/verify", { challengeId: "challenge-1", signature }));
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; address: string; ecosystem: string };
    expect(json.ok).toBe(true);
    expect(json.address).toBe(address);
    expect(json.ecosystem).toBe("minipay");
  });

  it("rejects a challenge that belongs to a different user", async () => {
    await buildValidChallenge();
    (state.challengeRow as Record<string, unknown>).hub_user_id = "some-other-user";
    const { POST } = await import("@/app/api/me/wallets/verify/route");
    const res = await POST(makeRequest("/api/me/wallets/verify", { challengeId: "challenge-1", signature: "0xdead" }));
    expect(res.status).toBe(404);
  });
});
