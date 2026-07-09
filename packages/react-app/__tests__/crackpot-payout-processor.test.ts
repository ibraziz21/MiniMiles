import { describe, it, expect, vi, beforeEach } from "vitest";
import { celo } from "viem/chains";
import { drainCrackPotPayoutQueue } from "@/lib/server/crackpotPayoutProcessor";

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

describe("drainCrackPotPayoutQueue", () => {
  beforeEach(() => {
    mockLeaseNextPayoutJob.mockReset();
    mockProcessPayoutJob.mockReset();
    mockRotateActiveCycle.mockReset();
  });

  it("rotates the won Miles version after a successful payout", async () => {
    mockLeaseNextPayoutJob
      .mockResolvedValueOnce(BASE_JOB)
      .mockResolvedValueOnce(null);
    mockProcessPayoutJob.mockResolvedValueOnce({ status: "succeeded" });
    mockRotateActiveCycle.mockResolvedValueOnce({
      id: "cycle-next",
      contract_cycle_id: 78,
      status: "active",
    });

    const result = await drainCrackPotPayoutQueue({
      limit: 1,
      leaseOwner: "test-worker",
    });

    expect(result.processed).toEqual([{ id: "job-1", status: "succeeded" }]);
    expect(mockRotateActiveCycle).toHaveBeenCalledWith("miles", celo.id);
    expect(result.rotations).toEqual([
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
    mockLeaseNextPayoutJob
      .mockResolvedValueOnce(BASE_JOB)
      .mockResolvedValueOnce(null);
    mockProcessPayoutJob.mockResolvedValueOnce({ status: "failed" });

    const result = await drainCrackPotPayoutQueue();

    expect(result.processed).toEqual([{ id: "job-1", status: "failed" }]);
    expect(mockRotateActiveCycle).not.toHaveBeenCalled();
    expect(result.rotations).toEqual([]);
  });
});
