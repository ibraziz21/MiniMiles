import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────

function makeChain(result: { data: any; error: any; count?: number }) {
  const chain: any = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    upsert: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (res: any) => Promise.resolve(result).then(res),
  };
  return chain;
}

const mockFrom = vi.fn();
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { from: mockFrom },
}));

// ── Auth mock ─────────────────────────────────────────────────────────────────

const mockRequireSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireSession: () => mockRequireSession(),
}));

// ── Chain mock ────────────────────────────────────────────────────────────────

const mockVerifyPayment = vi.fn();
vi.mock("@/lib/celoClient", () => ({
  celoClient: {
    getTransactionReceipt: (...args: any[]) => mockVerifyPayment(...args),
  },
}));

vi.mock("@/lib/blacklist", () => ({
  isBlacklisted: vi.fn().mockResolvedValue(false),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    parseUnits: actual.parseUnits,
    decodeEventLog: vi.fn().mockReturnValue({
      eventName: "Transfer",
      args: {
        from: "0xuser000000000000000000000000000000000000",
        to: "0xfee0000000000000000000000000000000000000",
        value: BigInt("13000000"), // 13 USDT at 6 decimals
      },
    }),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION = { walletAddress: "0xuser000000000000000000000000000000000000" };

const PRODUCT = {
  id: 1,
  name: "Test Widget",
  price_cusd: "10.00",
  category: "electronics",
  merchant_id: "merchant-uuid",
  active: true,
};

const RECEIPT = {
  status: "success",
  logs: [
    {
      address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
      data: "0x",
      topics: [],
    },
  ],
};

function makeBody(overrides: Record<string, any> = {}) {
  return {
    product_id: 1,
    voucher_code: null,
    recipient_name: "Test User",
    phone: "0712345678",
    city: "Nairobi",
    location_details: "Gate 4",
    delivery_fee_tx_hash: "0xdeadbeefdeadbeef",
    currency: "USDT",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/Spend/orders", () => {
  let handler: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Set required env vars
    process.env.DELIVERY_FEE_ADDRESS = "0xfee0000000000000000000000000000000000000";
    process.env.USDT_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
    const mod = await import("../app/api/Spend/orders/route");
    handler = mod.POST;
  });

  it("returns 401 when no session", async () => {
    mockRequireSession.mockResolvedValueOnce(null);
    const req = new Request("http://localhost/api/Spend/orders", {
      method: "POST",
      body: JSON.stringify(makeBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    mockRequireSession.mockResolvedValueOnce(SESSION);
    const req = new Request("http://localhost/api/Spend/orders", {
      method: "POST",
      body: JSON.stringify({ product_id: 1 }), // missing city, phone, etc.
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for unsupported currency", async () => {
    mockRequireSession.mockResolvedValueOnce(SESSION);
    const req = new Request("http://localhost/api/Spend/orders", {
      method: "POST",
      body: JSON.stringify(makeBody({ currency: "BTC" })),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  it("returns 409 when tx hash already used", async () => {
    mockRequireSession.mockResolvedValueOnce(SESSION);
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ data: { id: "existing-order" }, error: null }); // payment_ref exists
      return makeChain({ data: null, error: null });
    });

    const req = new Request("http://localhost/api/Spend/orders", {
      method: "POST",
      body: JSON.stringify(makeBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already used/i);
  });

  it("returns 409 when voucher is not in issued state (race lost)", async () => {
    mockRequireSession.mockResolvedValueOnce(SESSION);
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ data: null, error: null }); // no existing tx
      if (callCount === 2) return makeChain({ data: PRODUCT, error: null }); // product
      if (callCount === 3) return makeChain({ data: null, error: null }); // partner settings
      // voucher atomic claim returns null — another request claimed it first
      if (callCount === 4) return makeChain({ data: null, error: null });
      // status check shows it's "claiming"
      if (callCount === 5) return makeChain({ data: { status: "claiming" }, error: null });
      return makeChain({ data: null, error: null });
    });

    const req = new Request("http://localhost/api/Spend/orders", {
      method: "POST",
      body: JSON.stringify(makeBody({ voucher_code: "TESTCODE1" })),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
  });

  it("returns 422 when payment verification fails", async () => {
    mockRequireSession.mockResolvedValueOnce(SESSION);
    mockVerifyPayment.mockResolvedValueOnce({ status: "reverted", logs: [] });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ data: null, error: null }); // no existing tx
      if (callCount === 2) return makeChain({ data: PRODUCT, error: null }); // product
      if (callCount === 3) return makeChain({ data: null, error: null }); // partner settings
      if (callCount === 4) return makeChain({ data: null, error: null }); // users upsert
      if (callCount === 5) return makeChain({ data: null, error: null }); // users select
      return makeChain({ data: null, error: null });
    });

    const req = new Request("http://localhost/api/Spend/orders", {
      method: "POST",
      body: JSON.stringify(makeBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
  });

  it("returns 201 and order on success", async () => {
    mockRequireSession.mockResolvedValueOnce(SESSION);
    mockVerifyPayment.mockResolvedValueOnce(RECEIPT);

    const ORDER = { id: "order-uuid", status: "placed", paid_kes: 1690 };
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ data: null, error: null }); // no existing tx
      if (callCount === 2) return makeChain({ data: PRODUCT, error: null }); // product
      if (callCount === 3) return makeChain({ data: null, error: null }); // partner settings
      if (callCount === 4) return makeChain({ data: null, error: null }); // users upsert
      if (callCount === 5) return makeChain({ data: { username: "testuser" }, error: null }); // users select
      if (callCount === 6) return makeChain({ data: ORDER, error: null }); // order insert
      return makeChain({ data: null, error: null });
    });

    const req = new Request("http://localhost/api/Spend/orders", {
      method: "POST",
      body: JSON.stringify(makeBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.order.id).toBe("order-uuid");
    expect(json.order.status).toBe("placed");
  });
});
