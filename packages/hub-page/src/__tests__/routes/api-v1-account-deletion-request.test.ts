import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  /** challenge id -> row */
  challenges: new Map<
    string,
    { hubUserId: string; expiresAt: number; consumed: boolean; attempts: number }
  >(),
  /** user id -> open request row */
  requests: new Map<
    string,
    { id: string; status: string; requested_at: string; target_completion_at: string }
  >(),
  /** token -> the user id Supabase resolves it to, or null for an invalid code */
  otps: new Map<string, string | null>(),
  policyVersion: "2026-10-10.1",
  signOutCalls: 0,
  nextRequestId: 1,
  accepting: true,
}));

vi.mock("@/lib/auth/requestActor", () => {
  class MockUnauthorizedError extends Error {
    readonly status = 401;
    readonly code = "UNAUTHORIZED";
  }
  return {
    UnauthorizedError: MockUnauthorizedError,
    requireActorAllowingDeletionPending: async () => {
      if (!state.actor) throw new MockUnauthorizedError("Unauthorized");
      return state.actor;
    },
  };
});

vi.mock("@/lib/akiba/accountDeletionAvailability", () => ({
  deletionAvailability: () =>
    state.accepting
      ? { acceptingRequests: true }
      : { acceptingRequests: false, reason: "retention_inventory_unapproved", unapprovedRowIds: ["reward_ledger"] },
  isProcessingEnabled: () => state.accepting,
  isSubmissionEnabled: () => state.accepting,
}));

vi.mock("@/lib/akiba/accountDeletionPolicy", () => ({
  DELETION_POLICY_VERSION: "2026-10-10.1",
  PROCESSING_TARGET_DAYS: 14,
  CHALLENGE_TTL_SECONDS: 600,
  CHALLENGE_MAX_ATTEMPTS: 5,
  PENDING_DELETION_STATUSES: ["requested", "processing", "legal_hold", "failed"],
}));

vi.mock("@/lib/akiba/accountDeletionContact", () => ({
  encryptCompletionContact: () => ({ ciphertext: "\\xdeadbeef", keyVersion: "v1" }),
}));

vi.mock("@/lib/akiba/accountDeletionGuard", () => {
  class MockDeletionLookupUnavailableError extends Error {}
  return {
    DeletionLookupUnavailableError: MockDeletionLookupUnavailableError,
    findOpenDeletionRequest: async (userId: string) => state.requests.get(userId) ?? null,
  };
});

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({
    supabase: { url: "https://test.supabase.co", anonKey: "anon-key", serviceKey: "service-key" },
    siteUrl: "http://localhost:3003",
  }),
}));

// Stands in for the standalone verification client. signOut is counted so the
// test can assert §7.3 step 6 — the session this verification creates is
// always discarded, success or failure.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      verifyOtp: async ({ token }: { token: string }) => {
        const resolved = state.otps.get(token);
        if (resolved === undefined || resolved === null) {
          return { data: { user: null }, error: new Error("invalid otp") };
        }
        return { data: { user: { id: resolved } }, error: null };
      },
      signOut: async () => {
        state.signOutCalls += 1;
        return { error: null };
      },
      signInWithOtp: async () => ({ error: null }),
    },
  }),
}));

const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });

      if (name === "record_account_deletion_challenge_attempt") {
        const row = state.challenges.get(args.p_challenge_id as string);
        if (!row || row.hubUserId !== args.p_hub_user_id) {
          return { data: [{ ok: false, error_code: "challenge_not_found" }], error: null };
        }
        if (row.consumed) return { data: [{ ok: false, error_code: "challenge_consumed" }], error: null };
        if (row.expiresAt <= Date.now()) {
          return { data: [{ ok: false, error_code: "challenge_expired" }], error: null };
        }
        if (row.attempts >= (args.p_max_attempts as number)) {
          return { data: [{ ok: false, error_code: "challenge_attempts_exhausted" }], error: null };
        }
        row.attempts += 1;
        return { data: [{ ok: true, error_code: null, attempts_remaining: 4 }], error: null };
      }

      if (name === "create_account_deletion_request") {
        const userId = args.p_hub_user_id as string;
        const existing = state.requests.get(userId);
        if (existing) {
          return {
            data: [
              {
                ok: true,
                request_id: existing.id,
                status: existing.status,
                requested_at: existing.requested_at,
                target_completion_at: existing.target_completion_at,
                already_requested: true,
              },
            ],
            error: null,
          };
        }
        const challenge = state.challenges.get(args.p_challenge_id as string);
        if (!challenge || challenge.consumed) {
          return { data: [{ ok: false, error_code: "challenge_consumed" }], error: null };
        }
        challenge.consumed = true;
        const row = {
          id: `req-${state.nextRequestId++}`,
          status: "requested",
          requested_at: "2026-10-10T00:00:00.000Z",
          target_completion_at: "2026-10-24T00:00:00.000Z",
        };
        state.requests.set(userId, row);
        return {
          data: [
            {
              ok: true,
              request_id: row.id,
              status: row.status,
              requested_at: row.requested_at,
              target_completion_at: row.target_completion_at,
              already_requested: false,
            },
          ],
          error: null,
        };
      }

      throw new Error(`Unexpected rpc ${name}`);
    },
  }),
}));

// The real mutation guard runs — these tests prove its production behavior.
const { POST } = await import("@/app/api/v1/me/account-deletion-request/route");

type BodyInput = Record<string, unknown>;

function bearerReq(body: BodyInput, contentType = "application/json") {
  return new Request("http://localhost/api/v1/me/account-deletion-request", {
    method: "POST",
    headers: { "content-type": contentType, "x-akiba-platform": "ios" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: BodyInput = {}) {
  return {
    challengeId: "chal-1",
    otp: "123456",
    acknowledgement: true,
    policyVersion: state.policyVersion,
    ...overrides,
  };
}

describe("POST /api/v1/me/account-deletion-request", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    state.actor = { userId: "user-1", email: "a@example.com", authMode: "bearer" };
    state.challenges.clear();
    state.requests.clear();
    state.otps.clear();
    state.signOutCalls = 0;
    state.nextRequestId = 1;
    state.accepting = true;

    state.challenges.set("chal-1", {
      hubUserId: "user-1",
      expiresAt: Date.now() + 600_000,
      consumed: false,
      attempts: 0,
    });
    state.otps.set("123456", "user-1");
  });

  it("returns 401 when unauthenticated", async () => {
    state.actor = null;
    const res = await POST(bearerReq(validBody()));
    expect(res.status).toBe(401);
  });

  it("rejects a bearer mutation without a JSON content type", async () => {
    const res = await POST(bearerReq(validBody(), "text/plain"));
    expect(res.status).toBe(415);
  });

  it("accepts a verified request with 202 and a durable reference", async () => {
    const res = await POST(bearerReq(validBody()));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data).toMatchObject({
      requestId: "req-1",
      status: "requested",
      alreadyRequested: false,
    });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("records the platform the request came from", async () => {
    await POST(bearerReq(validBody()));
    const create = rpcCalls.find((call) => call.name === "create_account_deletion_request");
    expect(create?.args.p_source).toBe("native_ios");
  });

  it("discards the verification session it created, even on success", async () => {
    await POST(bearerReq(validBody()));
    expect(state.signOutCalls).toBe(1);
  });

  it("discards the verification session on a failed code too", async () => {
    state.otps.set("999999", null);
    await POST(bearerReq(validBody({ otp: "999999" })));
    expect(state.signOutCalls).toBe(1);
  });

  it("rejects a code that verifies as a different user", async () => {
    // A valid code for somebody else must never delete this actor's account.
    state.otps.set("222222", "other-user");
    const res = await POST(bearerReq(validBody({ otp: "222222" })));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("IDENTITY_MISMATCH");
    expect(rpcCalls.some((call) => call.name === "create_account_deletion_request")).toBe(false);
  });

  it("returns the original receipt for a repeat submission, without re-verifying a code", async () => {
    const first = await (await POST(bearerReq(validBody()))).json();

    rpcCalls.length = 0;
    const second = await POST(bearerReq(validBody({ otp: "000000" })));
    expect(second.status).toBe(202);
    const body = await second.json();

    expect(body.data.requestId).toBe(first.data.requestId);
    expect(body.data.requestedAt).toBe(first.data.requestedAt);
    expect(body.data.targetCompletionAt).toBe(first.data.targetCompletionAt);
    expect(body.data.alreadyRequested).toBe(true);
    // No attempt burned, no second request created: this is what makes a
    // dropped final response safe to retry (§7.3).
    expect(rpcCalls).toHaveLength(0);
  });

  it("burns a challenge attempt on a wrong code", async () => {
    state.otps.set("999999", null);
    const res = await POST(bearerReq(validBody({ otp: "999999" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("OTP_INVALID");
    expect(state.challenges.get("chal-1")?.attempts).toBe(1);
  });

  it("refuses a challenge belonging to another user", async () => {
    state.challenges.set("chal-other", {
      hubUserId: "user-2",
      expiresAt: Date.now() + 600_000,
      consumed: false,
      attempts: 0,
    });
    const res = await POST(bearerReq(validBody({ challengeId: "chal-other" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("CHALLENGE_NOT_FOUND");
  });

  it("refuses an expired challenge", async () => {
    state.challenges.set("chal-1", {
      hubUserId: "user-1",
      expiresAt: Date.now() - 1,
      consumed: false,
      attempts: 0,
    });
    const res = await POST(bearerReq(validBody()));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("CHALLENGE_EXPIRED");
  });

  it("refuses once the attempt budget is exhausted", async () => {
    state.challenges.set("chal-1", {
      hubUserId: "user-1",
      expiresAt: Date.now() + 600_000,
      consumed: false,
      attempts: 5,
    });
    const res = await POST(bearerReq(validBody()));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("CHALLENGE_ATTEMPTS_EXHAUSTED");
  });

  it("rejects a stale policy version before spending the member's code", async () => {
    const res = await POST(bearerReq(validBody({ policyVersion: "2020-01-01.1" })));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("POLICY_VERSION_MISMATCH");
    expect(state.challenges.get("chal-1")?.attempts).toBe(0);
  });

  it("requires the acknowledgement, and treats a missing one as a malformed body", async () => {
    const res = await POST(bearerReq(validBody({ acknowledgement: false })));
    expect(res.status).toBe(400);
    expect(state.challenges.get("chal-1")?.attempts).toBe(0);
  });

  it("rejects a malformed body before touching the challenge", async () => {
    const res = await POST(bearerReq({ otp: "123456" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_body");
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses to accept a request the workflow cannot carry out", async () => {
    // The original implementation returned 202 here while the worker was
    // disabled and the inventory unapproved — the pending-account guard then
    // locked the member out of an account nothing was going to process.
    state.accepting = false;
    const res = await POST(bearerReq(validBody()));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("DELETION_UNAVAILABLE");
    expect(body.error.message).toMatch(/hello@akibamiles\.com/);
    expect(rpcCalls.some((call) => call.name === "create_account_deletion_request")).toBe(false);
    expect(state.challenges.get("chal-1")?.attempts).toBe(0);
  });

  it("still returns an existing receipt after submission is switched off", async () => {
    // A member whose request was already accepted must be able to retry and
    // read it back, even if acceptance was disabled in between.
    const first = await (await POST(bearerReq(validBody()))).json();
    state.accepting = false;

    const res = await POST(bearerReq(validBody()));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data.requestId).toBe(first.data.requestId);
    expect(body.data.alreadyRequested).toBe(true);
  });

  it("never returns a raw provider message", async () => {
    state.otps.set("999999", null);
    const res = await POST(bearerReq(validBody({ otp: "999999" })));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("invalid otp");
    expect(text).not.toContain("a@example.com");
  });
});
