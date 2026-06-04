import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────
// Mirrors the Supabase query builder API (from/rpc).

type MockResult = { data: any; error: any; count?: number };

function makeChain(result: MockResult | (() => MockResult)) {
  const resolve = () => (typeof result === "function" ? result() : result);
  const chain: any = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    upsert: () => chain,
    delete: () => chain,
    eq: () => chain,
    neq: () => chain,
    gt: () => chain,
    lt: () => chain,
    gte: () => chain,
    in: () => chain,
    single: () => Promise.resolve(resolve()),
    maybeSingle: () => Promise.resolve(resolve()),
    then: (res: any) => Promise.resolve(resolve()).then(res),
  };
  return chain;
}

const mockFrom = vi.fn();
const mockRpc  = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

// ── Other mocks ───────────────────────────────────────────────────────────────
const mockBurn = vi.fn();
vi.mock("@/lib/minipoints", () => ({
  safeBurnMiniPoints: (...args: any[]) => mockBurn(...args),
}));

const mockIsBlacklisted = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/blacklist", () => ({
  isBlacklisted: (...args: any[]) => mockIsBlacklisted(...args),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, verifyMessage: vi.fn().mockResolvedValue(true) };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeValidBody() {
  return {
    merchant_id:    "merchant-uuid",
    template_id:    "template-uuid",
    user_address:   "0xaabbccddee0011223344556677889900aabbccdd",
    timestamp:      Math.floor(Date.now() / 1000),
    nonce:          "unique-nonce-" + Math.random(),
    signature:      "0xdeadbeef",
    idempotency_key: null,
  };
}

// Successful RPC reservation result
const RPC_RESERVED = [
  { voucher_id: "v1", code: "ABCDE12345", qr_payload: "{}", status: "pending", miles_cost: 100 },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/Spend/vouchers/issue", () => {
  let handler: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../app/api/Spend/vouchers/issue/route");
    handler = mod.POST;
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it("returns 400 when required fields are missing", async () => {
    const req = new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify({ merchant_id: "x" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when address is blacklisted", async () => {
    mockIsBlacklisted.mockResolvedValueOnce(true);
    const req = new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify(makeValidBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when timestamp is expired", async () => {
    const body = { ...makeValidBody(), timestamp: Math.floor(Date.now() / 1000) - 700 };
    // No DB calls before timestamp check when no idempotency_key
    const req = new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/expired/i);
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────

  it("returns existing voucher when idempotency_key matches (200)", async () => {
    const existingVoucher = { id: "v1", code: "ABCD", qr_payload: "{}", status: "issued" };
    // idempotency_key present → first from() call is the idempotency select
    mockFrom.mockReturnValue(makeChain({ data: existingVoucher, error: null }));

    const body = { ...makeValidBody(), idempotency_key: "key-123" };
    const req = new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.voucher.id).toBe("v1");
    // Should not have touched the RPC or burned anything
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockBurn).not.toHaveBeenCalled();
  });

  // ── Nonce ───────────────────────────────────────────────────────────────────

  it("returns 400 when nonce is already used (unique violation on insert)", async () => {
    // No idempotency_key → call 1 = nonce insert
    mockFrom.mockImplementation(() =>
      makeChain({ data: null, error: { code: "23505", message: "duplicate" } }),
    );

    const req = new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify(makeValidBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/nonce/i);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ── RPC-based cap / cooldown / template errors ──────────────────────────────

  it("returns 404 when reserve_voucher_atomic raises TEMPLATE_INACTIVE", async () => {
    // call 1 = nonce insert (ok), then rpc raises TEMPLATE_INACTIVE
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "TEMPLATE_INACTIVE: template template-uuid is not active" },
    });

    const req = new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify(makeValidBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/template not found/i);
  });

  it("returns 409 when reserve_voucher_atomic raises CAP_EXCEEDED", async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "CAP_EXCEEDED: template template-uuid has reached its global cap of 10" },
    });

    const req = new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify(makeValidBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/supply exhausted/i);
  });

  it("returns 429 when reserve_voucher_atomic raises COOLDOWN_ACTIVE", async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "COOLDOWN_ACTIVE: user 0xaabb is in cooldown for template template-uuid" },
    });

    const req = new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify(makeValidBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/cooldown/i);
  });

  // ── Concurrent cap=1 race ──────────────────────────────────────────────────
  // Simulates two requests for the same template. The second one finds the RPC
  // returning CAP_EXCEEDED because the first request's pending row already counts.
  it("concurrent cap=1: second request gets 409 when first already reserved", async () => {
    mockBurn.mockResolvedValue("0xtxhash");

    // First request: nonce ok, rpc ok, burn ok, promote ok
    const firstNonceChain  = makeChain({ data: null, error: null });
    const firstPromoteChain = makeChain({ data: { id: "v1", code: "ABCDE12345", qr_payload: "{}", status: "issued" }, error: null });

    let firstFromCall = 0;
    const firstHandler = async () => {
      mockFrom.mockImplementation(() => {
        firstFromCall++;
        if (firstFromCall === 1) return firstNonceChain;  // nonce insert
        return firstPromoteChain;                          // promote
      });
      mockRpc.mockResolvedValueOnce({ data: RPC_RESERVED, error: null });
      return handler(new Request("http://localhost/api/Spend/vouchers/issue", {
        method: "POST",
        body: JSON.stringify({ ...makeValidBody(), nonce: "nonce-A" }),
        headers: { "Content-Type": "application/json" },
      }));
    };

    const r1 = await firstHandler();
    expect(r1.status).toBe(201);

    // Second request: nonce ok, rpc returns CAP_EXCEEDED
    let secondFromCall = 0;
    mockFrom.mockImplementation(() => {
      secondFromCall++;
      return makeChain({ data: null, error: null }); // nonce insert ok
    });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "CAP_EXCEEDED: template template-uuid has reached its global cap of 1" },
    });

    const r2 = await handler(new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify({ ...makeValidBody(), nonce: "nonce-B" }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(r2.status).toBe(409);
    const json = await r2.json();
    expect(json.error).toMatch(/supply exhausted/i);
  });

  // ── Burn failure ────────────────────────────────────────────────────────────

  it("returns 422 and voids pending row when burn fails", async () => {
    mockBurn.mockRejectedValueOnce(new Error("insufficient balance"));

    const voidUpdate = vi.fn().mockReturnValue(makeChain({ data: null, error: null }));
    let fromCall = 0;

    mockFrom.mockImplementation((_table: string) => {
      fromCall++;
      if (fromCall === 1) return makeChain({ data: null, error: null }); // nonce insert
      // void update — .update({status:"void"}).eq(...)
      const chain: any = {
        update: voidUpdate,
        eq: () => chain,
        then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
      };
      return chain;
    });

    mockRpc.mockResolvedValueOnce({ data: RPC_RESERVED, error: null });

    const req = new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify(makeValidBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(422);
    expect(voidUpdate).toHaveBeenCalledWith({ status: "void" });
  });

  // ── Promote failure (reconciliation path) ──────────────────────────────────

  it("returns 201 with pending status and persists burn_tx_hash when promote fails", async () => {
    mockBurn.mockResolvedValueOnce("0xburntxhash");

    let fromCall = 0;
    const reconcileUpdate = vi.fn().mockReturnValue(makeChain({ data: null, error: null }));

    mockFrom.mockImplementation((_table: string) => {
      fromCall++;
      if (fromCall === 1) return makeChain({ data: null, error: null }); // nonce insert
      // Promote call: .update({status:"issued", burn_tx_hash}).eq(...).select().single()
      // Simulate promote failure
      if (fromCall === 2) {
        const chain: any = {
          update: () => chain,
          eq: () => chain,
          select: () => chain,
          single: () => Promise.resolve({ data: null, error: { message: "DB error" } }),
          then: (res: any) => Promise.resolve({ data: null, error: { message: "DB error" } }).then(res),
        };
        return chain;
      }
      // Recovery update: .update({burn_tx_hash, recovery_state}).eq(status='pending')
      const chain: any = {
        update: reconcileUpdate,
        eq: () => chain,
        then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
      };
      return chain;
    });

    mockRpc.mockResolvedValueOnce({ data: RPC_RESERVED, error: null });

    const req = new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify(makeValidBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    // Should still return 201 so the user is not blocked
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.voucher.status).toBe("pending");
    // Reconciliation update must have been called
    expect(reconcileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        burn_tx_hash:   "0xburntxhash",
        recovery_state: "burn_confirmed_promote_failed",
      }),
    );
  });

  // ── Full success path ────────────────────────────────────────────────────────

  it("returns 201 with issued voucher on success", async () => {
    mockBurn.mockResolvedValueOnce("0xtxhash");

    let fromCall = 0;
    mockFrom.mockImplementation(() => {
      fromCall++;
      if (fromCall === 1) return makeChain({ data: null, error: null }); // nonce insert
      // promote to issued
      return makeChain({ data: { id: "v1", code: "ABCDE12345", qr_payload: "{}", status: "issued" }, error: null });
    });

    mockRpc.mockResolvedValueOnce({ data: RPC_RESERVED, error: null });

    const req = new Request("http://localhost/api/Spend/vouchers/issue", {
      method: "POST",
      body: JSON.stringify(makeValidBody()),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.voucher.status).toBe("issued");
    // RPC was called once with correct args
    expect(mockRpc).toHaveBeenCalledWith(
      "reserve_voucher_atomic",
      expect.objectContaining({
        p_template_id:   "template-uuid",
        p_merchant_id:   "merchant-uuid",
      }),
    );
  });
});
