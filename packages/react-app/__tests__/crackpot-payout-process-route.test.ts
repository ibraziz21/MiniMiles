import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockDrainPayoutQueue = vi.fn<(...args: any[]) => Promise<any>>();

vi.mock("@/lib/server/crackpotPayoutProcessor", () => ({
  drainCrackPotPayoutQueue: (...args: any[]) => mockDrainPayoutQueue(...args),
}));

async function loadRoute() {
  vi.resetModules();
  const mod = await import("@/app/api/crackpot/payout/process/route");
  return mod.GET;
}

describe("GET /api/crackpot/payout/process", () => {
  beforeEach(() => {
    mockDrainPayoutQueue.mockReset();
    mockDrainPayoutQueue.mockResolvedValue({
      processed: [],
      processedCount: 0,
      rotations: [],
    });
    process.env.CRACKPOT_SETTLEMENT_SECRET = "settlement-secret";
  });

  afterEach(() => {
    delete process.env.CRACKPOT_SETTLEMENT_SECRET;
  });

  it("rejects unauthorized callers", async () => {
    const GET = await loadRoute();

    const res = await GET(new Request("http://localhost/api/crackpot/payout/process"));

    expect(res.status).toBe(401);
    expect(mockDrainPayoutQueue).not.toHaveBeenCalled();
  });

  it("rotates the won Miles version after a successful payout", async () => {
    const GET = await loadRoute();
    mockDrainPayoutQueue.mockResolvedValueOnce({
      processed: [{ id: "job-1", status: "succeeded" }],
      processedCount: 1,
      rotations: [
        {
          version: "miles",
          ok: true,
          cycleId: "cycle-next",
          contractCycleId: 78,
          status: "active",
        },
      ],
    });

    const res = await GET(new Request("http://localhost/api/crackpot/payout/process", {
      headers: { authorization: "Bearer settlement-secret" },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.processed).toEqual([{ id: "job-1", status: "succeeded" }]);
    expect(mockDrainPayoutQueue).toHaveBeenCalledWith({
      limit: 1,
      leaseOwner: "crackpot-payout-route",
    });
    expect(body.rotations).toEqual([
      {
        version: "miles",
        ok: true,
        cycleId: "cycle-next",
        contractCycleId: 78,
        status: "active",
      },
    ]);
  });

  it("does not rotate after a retryable payout failure", async () => {
    const GET = await loadRoute();
    mockDrainPayoutQueue.mockResolvedValueOnce({
      processed: [{ id: "job-1", status: "failed" }],
      processedCount: 1,
      rotations: [],
    });

    const res = await GET(new Request("http://localhost/api/crackpot/payout/process", {
      headers: { authorization: "Bearer settlement-secret" },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.processed).toEqual([{ id: "job-1", status: "failed" }]);
    expect(body.rotations).toEqual([]);
  });
});
