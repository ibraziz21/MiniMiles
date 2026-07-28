import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MERCHANT_QUEST_PROOF_DEAL_OPENED,
  QUEST_BROWSE_DEALS,
} from "@/lib/merchantDiscoveryQuests";

const mockRequireSession = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireSession: () => mockRequireSession(),
}));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

function makeChain(result: { data: any; error: any }) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    upsert: vi.fn(() => Promise.resolve(result)),
    maybeSingle: () => Promise.resolve(result),
  };
  return chain;
}

describe("POST /api/merchant-quests/proof", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue({
      walletAddress: "0xabcdef",
      issuedAt: Date.now(),
    });
    process.env.MERCHANT_QUESTS_ENABLED = "true";
    process.env.MERCHANT_QUESTS_ROLLOUT_PERCENT = "100";
  });

  afterEach(() => {
    delete process.env.MERCHANT_QUESTS_ENABLED;
    delete process.env.MERCHANT_QUESTS_ROLLOUT_PERCENT;
    delete process.env.MERCHANT_QUESTS_ALLOWLIST;
  });

  it("requires an authenticated wallet session", async () => {
    mockRequireSession.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/merchant-quests/proof/route");
    const response = await POST(
      new Request("http://localhost/api/merchant-quests/proof", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("validates the deal and records proof against the session wallet", async () => {
    const dealChain = makeChain({ data: { id: "deal-1" }, error: null });
    const proofChain = makeChain({ data: null, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "spend_voucher_templates" ? dealChain : proofChain,
    );

    const { POST } = await import("@/app/api/merchant-quests/proof/route");
    const response = await POST(
      new Request("http://localhost/api/merchant-quests/proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questId: QUEST_BROWSE_DEALS,
          actionType: MERCHANT_QUEST_PROOF_DEAL_OPENED,
          referenceId: "deal-1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(proofChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_address: "0xabcdef",
        partner_quest_id: QUEST_BROWSE_DEALS,
        action_ref: "deal-1",
      }),
      expect.objectContaining({ ignoreDuplicates: true }),
    );
    expect(proofChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "proof_recorded",
        user_address: "0xabcdef",
        partner_quest_id: QUEST_BROWSE_DEALS,
      }),
      expect.objectContaining({
        onConflict: "event_key",
        ignoreDuplicates: true,
      }),
    );
  });

  it("does not record proof for a wallet outside the rollout", async () => {
    process.env.MERCHANT_QUESTS_ENABLED = "false";
    const { POST } = await import("@/app/api/merchant-quests/proof/route");

    const response = await POST(
      new Request("http://localhost/api/merchant-quests/proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questId: QUEST_BROWSE_DEALS,
          actionType: MERCHANT_QUEST_PROOF_DEAL_OPENED,
          referenceId: "deal-1",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
