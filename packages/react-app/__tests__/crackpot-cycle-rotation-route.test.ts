import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRotateActiveCycle = vi.fn<(...args: any[]) => Promise<any>>();

vi.mock("@/lib/server/crackpotCycleSync", () => ({
  rotateActiveCycle: (...args: any[]) => mockRotateActiveCycle(...args),
}));

vi.mock("@/lib/server/crackpotComingSoon", () => ({
  isCrackPotLive: () => process.env.CRACKPOT_PAUSED !== "true",
  crackPotComingSoonResponse: () =>
    Response.json({ error: "crackpot_paused" }, { status: 503 }),
}));

function makeCycle(version: "miles" | "usdt", id: string) {
  return {
    id,
    version,
    theme: "bank-vault",
    status: "active",
    pot_balance: version === "usdt" ? 200 : 200,
    pot_cap: version === "usdt" ? 5000 : 10000,
    seed_amount: version === "usdt" ? 200 : 200,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    winner_address: null,
    winner_guesses: null,
    winner_tx_hash: null,
    payout_amount: null,
    cracked_at: null,
    commitment_algorithm: "CRACKPOT_SECRET_V1",
    secret_revealed_at: null,
    created_at: new Date().toISOString(),
    chain_id: 42220,
    contract_cycle_id: version === "usdt" ? 12 : 11,
    contract_version: version === "usdt" ? 1 : 0,
    secret_commitment: "0x" + "ab".repeat(32),
  };
}

describe("GET /api/crackpot/cycle/expire", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.CRACKPOT_PAUSED = "false";
    process.env.ADMIN_QUEUE_SECRET = "admin-secret";
    const mod = await import("@/app/api/crackpot/cycle/expire/route");
    GET = mod.GET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unauthorized callers", async () => {
    const res = await GET(new Request("http://localhost/api/crackpot/cycle/expire"));

    expect(res.status).toBe(401);
    expect(mockRotateActiveCycle).not.toHaveBeenCalled();
  });

  it("rotates both Miles and USDT by default", async () => {
    mockRotateActiveCycle
      .mockResolvedValueOnce(makeCycle("miles", "cycle-miles"))
      .mockResolvedValueOnce(makeCycle("usdt", "cycle-usdt"));

    const res = await GET(new Request("http://localhost/api/crackpot/cycle/expire", {
      headers: { authorization: "Bearer admin-secret" },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockRotateActiveCycle).toHaveBeenNthCalledWith(1, "miles");
    expect(mockRotateActiveCycle).toHaveBeenNthCalledWith(2, "usdt");
    expect(body.results.map((r: any) => r.version)).toEqual(["miles", "usdt"]);
  });

  it("returns 500 when a requested rotation fails", async () => {
    mockRotateActiveCycle.mockRejectedValueOnce(new Error("insufficient free USDT for seed"));

    const res = await GET(new Request("http://localhost/api/crackpot/cycle/expire?version=usdt", {
      headers: { authorization: "Bearer admin-secret" },
    }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.results[0]).toMatchObject({
      version: "usdt",
      ok: false,
      error: "insufficient free USDT for seed",
    });
  });
});
