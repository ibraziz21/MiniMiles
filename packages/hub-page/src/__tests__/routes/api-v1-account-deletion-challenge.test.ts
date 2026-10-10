import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  rateLimitOk: true,
  otpError: null as { message: string } | null,
  rpcError: null as { message: string } | null,
  balance: 1250,
  activeVouchers: 3,
  wallets: ["0xabc"] as string[],
  walletsShouldThrow: false,
  accepting: true,
}));

vi.mock("@/lib/auth/requestActor", () => {
  class MockUnauthorizedError extends Error {
    readonly status = 401;
    readonly code = "UNAUTHORIZED";
  }
  return {
    UnauthorizedError: MockUnauthorizedError,
    requireActor: async () => {
      if (!state.actor) throw new MockUnauthorizedError("Unauthorized");
      return state.actor;
    },
  };
});

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({
    supabase: { url: "https://test.supabase.co", anonKey: "anon-key", serviceKey: "service-key" },
    siteUrl: "http://localhost:3003",
  }),
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => state.rateLimitOk,
}));

const signInWithOtpSpy = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: async (args: unknown) => {
        signInWithOtpSpy(args);
        return { error: state.otpError };
      },
      verifyOtp: async () => ({ data: { user: null }, error: new Error("unused") }),
      signOut: async () => ({ error: null }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string) => {
      if (name !== "create_account_deletion_challenge") throw new Error(`Unexpected rpc ${name}`);
      if (state.rpcError) return { data: null, error: state.rpcError };
      return {
        data: [{ challenge_id: "chal-xyz", expires_at: "2026-10-10T00:10:00.000Z" }],
        error: null,
      };
    },
  }),
}));

vi.mock("@/lib/akiba/hubProfile", () => ({
  resolveHubProfile: async () => ({
    rows: [],
    activeRow: null,
    walletAddress: "0xabc",
    displayName: "Member",
    needsPicker: false,
  }),
}));

vi.mock("@/lib/akiba/balance", () => ({
  getUserBalance: async () => ({
    chainBalance: 0,
    ledgerBalance: state.balance,
    balance: state.balance,
    hasBalance: true,
  }),
}));

vi.mock("@/lib/akiba/myVouchers", () => ({
  getActiveVoucherSummary: async () => ({
    activeCount: state.activeVouchers,
    expiringSoonCount: 0,
  }),
  getLinkedWalletAddresses: async () => {
    if (state.walletsShouldThrow) throw new Error("wallet lookup failed");
    return state.wallets;
  },
}));

vi.mock("@/lib/akiba/accountDeletionAvailability", () => ({
  deletionAvailability: () =>
    state.accepting
      ? { acceptingRequests: true }
      : { acceptingRequests: false, reason: "submission_disabled" },
  isProcessingEnabled: () => state.accepting,
  isSubmissionEnabled: () => state.accepting,
}));

vi.mock("@/lib/akiba/accountDeletionGuard", () => {
  class MockDeletionLookupUnavailableError extends Error {}
  return {
    DeletionLookupUnavailableError: MockDeletionLookupUnavailableError,
    findOpenDeletionRequest: async () => null,
  };
});

vi.mock("@/lib/akiba/accountDeletionContact", () => ({
  encryptCompletionContact: () => null,
}));

const { POST } = await import("@/app/api/v1/me/account-deletion/challenge/route");
const { GET } = await import("@/app/api/v1/me/account-deletion-summary/route");

function challengeReq(contentType = "application/json") {
  return new Request("http://localhost/api/v1/me/account-deletion/challenge", {
    method: "POST",
    headers: { "content-type": contentType },
    body: "{}",
  });
}

function summaryReq() {
  return new Request("http://localhost/api/v1/me/account-deletion-summary");
}

describe("POST /api/v1/me/account-deletion/challenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = { userId: "user-1", email: "member@example.com", authMode: "bearer" };
    state.rateLimitOk = true;
    state.otpError = null;
    state.rpcError = null;
    state.accepting = true;
  });

  it("returns 401 when unauthenticated", async () => {
    state.actor = null;
    expect((await POST(challengeReq())).status).toBe(401);
  });

  it("rejects a bearer mutation without a JSON content type", async () => {
    expect((await POST(challengeReq("text/plain"))).status).toBe(415);
  });

  it("issues a challenge with a masked email and a resend deadline", async () => {
    const res = await POST(challengeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.challengeId).toBe("chal-xyz");
    expect(body.data.maskedEmail).toBe("m•••••@example.com");
    expect(Date.parse(body.data.resendAvailableAt)).not.toBeNaN();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("never lets a deletion flow create an account", async () => {
    await POST(challengeReq());
    expect(signInWithOtpSpy).toHaveBeenCalledWith({
      email: "member@example.com",
      options: { shouldCreateUser: false },
    });
  });

  it("resolves the address from the actor, never from the request body", async () => {
    const res = await POST(
      new Request("http://localhost/api/v1/me/account-deletion/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "attacker@evil.example" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(signInWithOtpSpy).toHaveBeenCalledWith(
      expect.objectContaining({ email: "member@example.com" }),
    );
  });

  it("rate limits repeated challenge requests", async () => {
    state.rateLimitOk = false;
    const res = await POST(challengeReq());
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });

  it("maps a send failure to retryable copy without the provider message", async () => {
    state.otpError = { message: "SMTP relay refused mail for member@example.com" };
    const res = await POST(challengeReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "OTP_SEND_FAILED", retryable: true });
    expect(JSON.stringify(body)).not.toContain("SMTP");
    expect(JSON.stringify(body)).not.toContain("member@example.com");
  });

  it("sends no code while the workflow cannot accept a request", async () => {
    // Sending a verification code would walk the member up to a locked door.
    state.accepting = false;
    const res = await POST(challengeReq());
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("DELETION_UNAVAILABLE");
    expect(signInWithOtpSpy).not.toHaveBeenCalled();
  });

  it("refuses an account with no confirmed email", async () => {
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };
    const res = await POST(challengeReq());
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("ACCOUNT_HAS_NO_EMAIL");
  });
});

describe("GET /api/v1/me/account-deletion-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = { userId: "user-1", email: "member@example.com", authMode: "bearer" };
    state.balance = 1250;
    state.activeVouchers = 3;
    state.wallets = ["0xabc"];
    state.walletsShouldThrow = false;
    state.accepting = true;
  });

  it("returns 401 when unauthenticated", async () => {
    state.actor = null;
    expect((await GET(summaryReq())).status).toBe(401);
  });

  it("returns counts the confirmation screen needs, and nothing identifying", async () => {
    const res = await GET(summaryReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      maskedEmail: "m•••••@example.com",
      milesBalance: 1250,
      activeVoucherCount: 3,
      linkedWalletCount: 1,
      processingTargetDays: 14,
      onChainRecordsRemain: true,
      acceptingRequests: true,
    });
    // Counts only (§7.1): no wallet address, voucher code, or ledger row.
    expect(JSON.stringify(body.data)).not.toContain("0xabc");
  });

  it("states that on-chain records remain even for a member with no wallet", async () => {
    state.wallets = [];
    const body = await (await GET(summaryReq())).json();
    expect(body.data.linkedWalletCount).toBe(0);
    expect(body.data.onChainRecordsRemain).toBe(true);
  });

  it("tells the app up front when a request cannot be made", async () => {
    // Otherwise the member reads five disclosures and is then refused.
    state.accepting = false;
    const body = await (await GET(summaryReq())).json();
    expect(body.data.acceptingRequests).toBe(false);
  });

  it("fails the whole summary rather than reporting zero linked wallets", async () => {
    // The member is about to make an irreversible decision partly on this
    // count. A swallowed lookup failure would show "0 wallet links".
    state.walletsShouldThrow = true;
    const res = await GET(summaryReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatchObject({ retryable: true });
    expect(JSON.stringify(body)).not.toContain("wallet lookup failed");
  });

  it("is private, no-store", async () => {
    const res = await GET(summaryReq());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
