/**
 * Route-level unit tests for POST /api/shop/orders/[id]/confirm
 *
 * The route now delegates the actual status change to the
 * advance_order_status RPC (order-lifecycle-completion-spec.md backbone)
 * instead of updating merchant_transactions.status directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PurchaseEventResult } from "@/lib/akiba/purchase-events";

type Chain = {
  select: (cols: string) => Chain;
  eq: (col: string, val: unknown) => Chain;
  limit: (n: number) => Chain;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  update: (row: unknown) => Chain;
  then: (resolve: (v: { data: unknown; error: null }) => unknown) => unknown;
};

let fromImpl: (table: string) => Chain;
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (t: string) => fromImpl(t), rpc: mockRpc }),
}));

let mockPurchaseEventResult: PurchaseEventResult = { ok: true, rewardIssued: false, milesAwarded: 0 };
vi.mock("@/lib/akiba/purchase-events", () => ({
  sendPurchaseEvent: vi.fn(async () => mockPurchaseEventResult),
}));

const mockEmitQuestActions = vi.fn(async (_list: unknown) => {});
vi.mock("@/lib/akiba/quest-events", () => ({
  emitQuestActions: (list: unknown) => mockEmitQuestActions(list),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-uuid", email: "test@example.com" } },
      }),
    },
  }),
}));

const { POST } = await import("@/app/api/shop/orders/[id]/confirm/route");

function makeChain(data: unknown): Chain {
  const chain: Chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data, error: null }),
    update: () => chain,
    then: (resolve) => Promise.resolve({ data, error: null }).then(resolve),
  };
  return chain;
}

// hub_user_wallets is queried without a terminal .maybeSingle()/.single() —
// getOwnedAddresses awaits the query directly and expects an array of rows.
function makeListChain(rows: unknown[]): Chain {
  const chain: Chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    update: () => chain,
    then: (resolve) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return chain;
}

function makeRequest(): Request {
  return new Request("http://localhost/api/shop/orders/order-1/confirm", { method: "POST" });
}

const WALLET = { address: "0xbuyerprimary" };

describe("POST /api/shop/orders/[id]/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPurchaseEventResult = { ok: true, rewardIssued: false, milesAwarded: 0 };
  });

  it("returns 404 when the order does not exist", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions") return makeChain(null);
      return makeChain(null);
    };

    const res = await POST(makeRequest(), { params: { id: "order-1" } });
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 403 when the order belongs to another user", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions")
        return makeChain({ id: "order-1", status: "delivered", user_address: "0xsomeoneelse" });
      return makeChain(null);
    };

    const res = await POST(makeRequest(), { params: { id: "order-1" } });
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 409 when the order is not in delivered state", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions")
        return makeChain({ id: "order-1", status: "placed", user_address: WALLET.address });
      return makeChain(null);
    };

    const res = await POST(makeRequest(), { params: { id: "order-1" } });
    expect(res.status).toBe(409);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls advance_order_status with actor=customer and returns 500 on rejection", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions")
        return makeChain({ id: "order-1", status: "delivered", user_address: WALLET.address });
      return makeChain(null);
    };
    mockRpc.mockResolvedValue({ data: [{ ok: false, error_code: "INVALID_TRANSITION" }], error: null });

    const res = await POST(makeRequest(), { params: { id: "order-1" } });
    const json = await res.json() as { error: string };

    expect(mockRpc).toHaveBeenCalledWith("advance_order_status", expect.objectContaining({
      p_order_id: "order-1",
      p_to_status: "received",
      p_actor: "customer",
    }));
    expect(res.status).toBe(500);
    expect(json.error).toBe("INVALID_TRANSITION");
  });

  it("returns ok on a successful transition", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions")
        return makeChain({ id: "order-1", status: "delivered", user_address: WALLET.address });
      return makeChain(null);
    };
    mockRpc.mockResolvedValue({ data: [{ ok: true, error_code: "" }], error: null });

    const res = await POST(makeRequest(), { params: { id: "order-1" } });
    const json = await res.json() as { ok: boolean };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  // Reward accrue/release (order-lifecycle-completion-spec.md §6): confirming
  // receipt also cascades received -> completed and releases the reward
  // stored at purchase time.
  it("advances to completed and releases the accrued reward after confirming receipt", async () => {
    const rewardPayload = {
      merchantId: "merchant-uuid",
      externalPurchaseId: "0xtxhash",
      idempotencyKey: "hub-purchase-order-1",
      recipient: { type: "wallet", value: "0xbuyerprimary" },
      amount: 5,
      currency: "CUSD",
      sourceApp: "hub",
      occurredAt: new Date().toISOString(),
      metadata: { hubUserId: "user-uuid", orderId: "order-1", walletAddress: "0xbuyerprimary" },
    };

    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions")
        return makeChain({ id: "order-1", status: "delivered", user_address: WALLET.address });
      if (table === "reward_jobs")
        return makeChain({ id: "job-1", payload: rewardPayload, status: "eligible" });
      return makeChain(null);
    };
    mockRpc.mockResolvedValue({ data: [{ ok: true, error_code: "" }], error: null });
    mockPurchaseEventResult = { ok: true, rewardIssued: true, milesAwarded: 150, reason: "launch reward" };

    const res = await POST(makeRequest(), { params: { id: "order-1" } });
    const json = await res.json() as { ok: boolean; reward: { issued: boolean; miles: number } };

    expect(mockRpc).toHaveBeenCalledWith("advance_order_status", expect.objectContaining({
      p_order_id: "order-1", p_to_status: "received", p_actor: "customer",
    }));
    expect(mockRpc).toHaveBeenCalledWith("advance_order_status", expect.objectContaining({
      p_order_id: "order-1", p_to_status: "completed", p_actor: "system",
    }));

    const { sendPurchaseEvent } = await import("@/lib/akiba/purchase-events");
    expect(vi.mocked(sendPurchaseEvent)).toHaveBeenCalledWith(rewardPayload);

    expect(mockRpc).toHaveBeenCalledWith("complete_reward_job", expect.objectContaining({
      p_job_id: "job-1", p_ok: true,
    }));

    expect(mockEmitQuestActions).toHaveBeenCalledWith([
      expect.objectContaining({ actionName: "purchase_completed", userId: "user-uuid", idempotencyKey: "quest-purchase_completed-order-1" }),
    ]);

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.reward.issued).toBe(true);
    expect(json.reward.miles).toBe(150);
  });

  it("does nothing when the reward job isn't eligible yet (no crash, no release)", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions")
        return makeChain({ id: "order-1", status: "delivered", user_address: WALLET.address });
      if (table === "reward_jobs")
        return makeChain({ id: "job-1", payload: {}, status: "voided" });
      return makeChain(null);
    };
    mockRpc.mockResolvedValue({ data: [{ ok: true, error_code: "" }], error: null });

    const res = await POST(makeRequest(), { params: { id: "order-1" } });
    const json = await res.json() as { ok: boolean; reward: { pending: boolean } };

    const { sendPurchaseEvent } = await import("@/lib/akiba/purchase-events");
    expect(vi.mocked(sendPurchaseEvent)).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalledWith("complete_reward_job", expect.anything());

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.reward.pending).toBe(false);
  });
});
