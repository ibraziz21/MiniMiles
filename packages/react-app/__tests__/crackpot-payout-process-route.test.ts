import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { celo } from "viem/chains";

const mockLeaseNextPayoutJob = vi.fn<(...args: any[]) => Promise<any>>();
const mockProcessPayoutJob = vi.fn<(...args: any[]) => Promise<any>>();
const mockRotateActiveCycle = vi.fn<(...args: any[]) => Promise<any>>();

vi.mock("@/lib/server/crackpotPayoutWorker", () => ({
  leaseNextPayoutJob: (...args: any[]) => mockLeaseNextPayoutJob(...args),
  processPayoutJob: (...args: any[]) => mockProcessPayoutJob(...args),
}));

vi.mock("@/lib/server/crackpotCycleSync", () => ({
  rotateActiveCycle: (...args: any[]) => mockRotateActiveCycle(...args),
}));

const BASE_JOB = {
  id: "job-1",
  cycle_id: "cycle-1",
  chain_id: celo.id,
  contract_cycle_id: 77,
  contract_version: 0,
  winner_address: "0xaabbccdd00000000000000000000000000000001",
  winner_guesses: 2,
  idempotency_key: `crackpot:${celo.id}:0:77`,
  status: "queued",
  tx_hash: null,
  payout_amount: null,
  attempts: 0,
  last_error: null,
  leased_at: null,
  lease_owner: null,
  next_attempt_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

async function loadRoute() {
  vi.resetModules();
  const mod = await import("@/app/api/crackpot/payout/process/route");
  return mod.GET;
}

describe("GET /api/crackpot/payout/process", () => {
  beforeEach(() => {
    mockLeaseNextPayoutJob.mockReset();
    mockProcessPayoutJob.mockReset();
    mockRotateActiveCycle.mockReset();
    process.env.CRACKPOT_SETTLEMENT_SECRET = "settlement-secret";
  });

  afterEach(() => {
    delete process.env.CRACKPOT_SETTLEMENT_SECRET;
  });

  it("rejects unauthorized callers", async () => {
    const GET = await loadRoute();

    const res = await GET(new Request("http://localhost/api/crackpot/payout/process"));

    expect(res.status).toBe(401);
    expect(mockLeaseNextPayoutJob).not.toHaveBeenCalled();
  });

  it("rotates the won Miles version after a successful payout", async () => {
    const GET = await loadRoute();
    mockLeaseNextPayoutJob
      .mockResolvedValueOnce(BASE_JOB)
      .mockResolvedValueOnce(null);
    mockProcessPayoutJob.mockResolvedValueOnce({ status: "succeeded" });
    mockRotateActiveCycle.mockResolvedValueOnce({
      id: "cycle-next",
      contract_cycle_id: 78,
      status: "active",
    });

    const res = await GET(new Request("http://localhost/api/crackpot/payout/process", {
      headers: { authorization: "Bearer settlement-secret" },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.processed).toEqual([{ id: "job-1", status: "succeeded" }]);
    expect(mockRotateActiveCycle).toHaveBeenCalledWith("miles", celo.id);
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
    mockLeaseNextPayoutJob
      .mockResolvedValueOnce(BASE_JOB)
      .mockResolvedValueOnce(null);
    mockProcessPayoutJob.mockResolvedValueOnce({ status: "failed" });

    const res = await GET(new Request("http://localhost/api/crackpot/payout/process", {
      headers: { authorization: "Bearer settlement-secret" },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.processed).toEqual([{ id: "job-1", status: "failed" }]);
    expect(mockRotateActiveCycle).not.toHaveBeenCalled();
    expect(body.rotations).toEqual([]);
  });
});
