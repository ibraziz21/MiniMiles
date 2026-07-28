/**
 * Route-level unit tests for POST /api/shop/orders/[id]/dispute
 * ("I didn't receive this" — delivered -> disputed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Chain = {
  select: (cols: string) => Chain;
  eq: (col: string, val: unknown) => Chain;
  limit: (n: number) => Chain;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  then: (resolve: (v: { data: unknown; error: null }) => unknown) => unknown;
};

let fromImpl: (table: string) => Chain;
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (t: string) => fromImpl(t), rpc: mockRpc }),
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

const { POST } = await import("@/app/api/shop/orders/[id]/dispute/route");

function makeChain(data: unknown): Chain {
  const chain: Chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve) => Promise.resolve({ data, error: null }).then(resolve),
  };
  return chain;
}

function makeListChain(rows: unknown[]): Chain {
  const chain: Chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return chain;
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/shop/orders/order-1/dispute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const WALLET = { address: "0xbuyerprimary" };
const SECONDARY_WALLET = { address: "0xbuyersecondary" };

describe("POST /api/shop/orders/[id]/dispute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when no reason is given", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      return makeChain(null);
    };
    const res = await POST(makeRequest({}), { params: { id: "order-1" } });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 404 when the order does not exist", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions") return makeChain(null);
      return makeChain(null);
    };
    const res = await POST(makeRequest({ reason: "never arrived" }), { params: { id: "order-1" } });
    expect(res.status).toBe(404);
  });

  it("returns 403 when the order belongs to another user", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions")
        return makeChain({ id: "order-1", status: "delivered", user_address: "0xsomeoneelse" });
      return makeChain(null);
    };
    const res = await POST(makeRequest({ reason: "never arrived" }), { params: { id: "order-1" } });
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("allows the order to belong to a SECONDARY linked wallet, not just the first", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET, SECONDARY_WALLET]);
      if (table === "merchant_transactions")
        return makeChain({ id: "order-1", status: "delivered", user_address: SECONDARY_WALLET.address });
      return makeChain(null);
    };
    mockRpc.mockResolvedValue({ data: [{ ok: true, error_code: "" }], error: null });

    const res = await POST(makeRequest({ reason: "never arrived" }), { params: { id: "order-1" } });
    expect(res.status).toBe(200);
  });

  it("returns 409 when the order is not in delivered state", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions")
        return makeChain({ id: "order-1", status: "placed", user_address: WALLET.address });
      return makeChain(null);
    };
    const res = await POST(makeRequest({ reason: "never arrived" }), { params: { id: "order-1" } });
    expect(res.status).toBe(409);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls advance_order_status with actor=customer and to_status=disputed", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions")
        return makeChain({ id: "order-1", status: "delivered", user_address: WALLET.address });
      return makeChain(null);
    };
    mockRpc.mockResolvedValue({ data: [{ ok: true, error_code: "" }], error: null });

    const res = await POST(makeRequest({ reason: "damaged", detail: "box was crushed" }), { params: { id: "order-1" } });
    const json = await res.json() as { ok: boolean };

    expect(mockRpc).toHaveBeenCalledWith("advance_order_status", expect.objectContaining({
      p_order_id: "order-1",
      p_to_status: "disputed",
      p_actor: "customer",
      p_meta: expect.objectContaining({ reason: "damaged", detail: "box was crushed" }),
    }));
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it("returns 500 when the RPC rejects the transition", async () => {
    fromImpl = (table) => {
      if (table === "hub_user_wallets") return makeListChain([WALLET]);
      if (table === "merchant_transactions")
        return makeChain({ id: "order-1", status: "delivered", user_address: WALLET.address });
      return makeChain(null);
    };
    mockRpc.mockResolvedValue({ data: [{ ok: false, error_code: "INVALID_TRANSITION" }], error: null });

    const res = await POST(makeRequest({ reason: "damaged" }), { params: { id: "order-1" } });
    const json = await res.json() as { error: string };
    expect(res.status).toBe(500);
    expect(json.error).toBe("INVALID_TRANSITION");
  });
});
