import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  credit: vi.fn(),
  reverse: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: state.rpc,
    from: (table: string) => ({
      select: () => {
        if (table === "hub_referrals") {
          return { in: async () => ({ data: [{ id: "ref-1", program_version_id: "program-old" }], error: null }) };
        }
        if (table === "referral_program_versions") {
          return { in: async () => ({ data: [{ id: "program-old", version: 7 }], error: null }) };
        }
        if (table === "hub_user_passes") {
          return { eq: () => ({ maybeSingle: async () => ({ data: { email: "referrer@test.com" }, error: null }) }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    }),
  }),
}));

vi.mock("@/lib/akiba/referral-rewards", () => ({
  creditReferralReward: state.credit,
  reverseReferralReward: state.reverse,
}));

vi.mock("@/lib/akiba/identities", () => ({
  buildIdentities: async () => [{ type: "email", value: "referrer@test.com" }],
}));

const { POST } = await import("@/app/api/internal/process-referral-reward-jobs/route");

beforeEach(() => {
  process.env.INTERNAL_WEBHOOK_SECRET = "worker-secret";
  state.rpc.mockReset();
  state.credit.mockReset();
  state.reverse.mockReset();

  state.rpc.mockImplementation(async (fn: string) => {
    if (fn === "claim_referral_reward_jobs") {
      return {
        data: [{
          id: "job-1",
          referral_id: "ref-1",
          milestone: "signup",
          recipient_user_id: "user-1",
          amount_miles: 50,
          idempotency_key: "referral-key",
          attempts: 1,
        }],
        error: null,
      };
    }
    if (fn === "claim_referral_reversal_jobs") return { data: [], error: null };
    return { data: true, error: null };
  });
  state.credit.mockResolvedValue({ ok: true, ledgerReference: "ledger-1", amountMiles: 50 });
});

describe("referral reward worker", () => {
  it("sends the program version bound to the referral, not the currently active version", async () => {
    const response = await POST(new Request("https://pass.test/api/internal/process-referral-reward-jobs", {
      method: "POST",
      headers: { "x-webhook-secret": "worker-secret" },
    }));

    expect(response.status).toBe(200);
    expect(state.credit).toHaveBeenCalledWith(expect.objectContaining({
      referralId: "ref-1",
      programVersion: 7,
    }));
    expect(state.rpc).toHaveBeenCalledWith("complete_referral_reward_job", expect.objectContaining({
      p_job_id: "job-1",
      p_ok: true,
      p_platform_reference: "ledger-1",
    }));
  });
});
