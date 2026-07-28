import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Covers the merchant-ux-spec.md §5 Step 4 / §14 gap this task closed:
// weekly_leaderboard_challenge must now be an accepted channel (migration
// 045_weekly_leaderboard_channel.sql), while a channel the merchant can't
// select must still be dropped before it reaches the RPC.

const state = vi.hoisted(() => ({
  session: {
    merchantUserId: "merchant-user-1",
    partnerId: "partner-1",
    role: "owner",
  } as Record<string, unknown> | null,
  rpcCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth", () => ({
  requireMerchantSession: async () => state.session,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "spend_voucher_templates") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: "template-1", partner_id: "partner-1" }, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      return { data: [{ ok: true, program_id: "program-1", error_code: "" }], error: null };
    },
  },
}));

const { POST } = await import("@/app/api/programs/route");

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/programs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const basePayload = {
  name: "Test voucher",
  template_id: "template-1",
  total_cap: 1000,
  funding_type: "free",
  funding_party_type: "none",
  reimbursement_rate: 0,
};

describe("POST /api/programs channel validation", () => {
  beforeEach(() => {
    state.session = { merchantUserId: "merchant-user-1", partnerId: "partner-1", role: "owner" };
    state.rpcCalls.length = 0;
  });

  it("forwards weekly_leaderboard_challenge to the RPC", async () => {
    const res = await POST(
      request({
        ...basePayload,
        channels: [
          { channel: "miles_purchase", cap: 900, active: true },
          { channel: "weekly_leaderboard_challenge", cap: 100, active: true },
        ],
      })
    );

    expect(res.status).toBe(201);
    expect(state.rpcCalls).toHaveLength(1);
    const forwardedChannels = state.rpcCalls[0].args.p_channels as Array<{ channel: string }>;
    expect(forwardedChannels.map((c) => c.channel)).toEqual(
      expect.arrayContaining(["miles_purchase", "weekly_leaderboard_challenge"])
    );
  });

  it("drops channels outside the known set before calling the RPC", async () => {
    const res = await POST(
      request({
        ...basePayload,
        channels: [
          { channel: "miles_purchase", cap: 900, active: true },
          { channel: "not_a_real_channel", cap: 100, active: true },
        ],
      })
    );

    expect(res.status).toBe(201);
    const forwardedChannels = state.rpcCalls[0].args.p_channels as Array<{ channel: string }>;
    expect(forwardedChannels.map((c) => c.channel)).toEqual(["miles_purchase"]);
  });
});
