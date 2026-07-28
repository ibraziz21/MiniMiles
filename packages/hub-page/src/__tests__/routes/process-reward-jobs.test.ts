/**
 * Route-level unit tests for POST /api/internal/process-reward-jobs —
 * the scheduled worker that guarantees a Platform outage can't lose a
 * reward (order-lifecycle-completion-spec.md §6 gate).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { PurchaseEventResult } from "@/lib/akiba/purchase-events";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}));

let mockPurchaseEventResult: PurchaseEventResult = { ok: true, rewardIssued: false, milesAwarded: 0 };
vi.mock("@/lib/akiba/purchase-events", () => ({
  sendPurchaseEvent: vi.fn(async () => mockPurchaseEventResult),
}));

const mockEmitQuestActions = vi.fn(async (_list: unknown) => {});
vi.mock("@/lib/akiba/quest-events", () => ({
  emitQuestActions: (list: unknown) => mockEmitQuestActions(list),
}));

const { POST, GET } = await import("@/app/api/internal/process-reward-jobs/route");

function makeRequest(secret?: string): Request {
  return new Request("http://localhost/api/internal/process-reward-jobs", {
    method: "POST",
    headers: secret ? { "x-webhook-secret": secret } : {},
  });
}

function makeCronRequest(bearer?: string): Request {
  return new Request("http://localhost/api/internal/process-reward-jobs", {
    method: "GET",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

const ORIGINAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

describe("POST /api/internal/process-reward-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_WEBHOOK_SECRET = "test-secret";
    mockPurchaseEventResult = { ok: true, rewardIssued: true, milesAwarded: 100 };
  });

  afterAll(() => {
    process.env.INTERNAL_WEBHOOK_SECRET = ORIGINAL_SECRET;
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  });

  it("rejects requests without the correct secret", async () => {
    const res = await POST(makeRequest("wrong"));
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("claims a batch, releases every eligible job that succeeds, and emits purchase_completed for each", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_reward_jobs") {
        return Promise.resolve({
          data: [
            { id: "job-1", order_id: "order-1", payload: { amount: 5, metadata: { hubUserId: "user-1", orderId: "order-1", walletAddress: "0xabc" } } },
            { id: "job-2", order_id: "order-2", payload: { amount: 10, metadata: { hubUserId: "user-2", orderId: "order-2" } } },
          ],
          error: null,
        });
      }
      if (name === "complete_reward_job") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await POST(makeRequest("test-secret"));
    const json = await res.json() as { ok: boolean; claimed: number; released: number; retried: number };

    expect(res.status).toBe(200);
    expect(json.claimed).toBe(2);
    expect(json.released).toBe(2);
    expect(json.retried).toBe(0);
    expect(mockRpc).toHaveBeenCalledWith("complete_reward_job", expect.objectContaining({ p_job_id: "job-1", p_ok: true }));
    expect(mockRpc).toHaveBeenCalledWith("complete_reward_job", expect.objectContaining({ p_job_id: "job-2", p_ok: true }));

    expect(mockEmitQuestActions).toHaveBeenCalledWith([
      expect.objectContaining({ actionName: "purchase_completed", userId: "user-1", idempotencyKey: "quest-purchase_completed-order-1" }),
    ]);
    expect(mockEmitQuestActions).toHaveBeenCalledWith([
      expect.objectContaining({ actionName: "purchase_completed", userId: "user-2", idempotencyKey: "quest-purchase_completed-order-2" }),
    ]);
  });

  it("does not emit purchase_completed for a job that fails and gets retried", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_reward_jobs") {
        return Promise.resolve({
          data: [{ id: "job-1", order_id: "order-1", payload: { amount: 5, metadata: { hubUserId: "user-1", orderId: "order-1" } } }],
          error: null,
        });
      }
      if (name === "complete_reward_job") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    mockPurchaseEventResult = { ok: false, rewardIssued: false, milesAwarded: 0, error: "Platform unavailable" };

    const res = await POST(makeRequest("test-secret"));
    const json = await res.json() as { released: number; retried: number };

    expect(res.status).toBe(200);
    expect(json.released).toBe(0);
    expect(json.retried).toBe(1);
    expect(mockEmitQuestActions).not.toHaveBeenCalled();
  });

  it("re-arms (retries) jobs that fail instead of dropping them, and keeps processing the rest of the batch", async () => {
    let call = 0;
    const { sendPurchaseEvent } = await import("@/lib/akiba/purchase-events");
    vi.mocked(sendPurchaseEvent).mockImplementation(async () => {
      call++;
      if (call === 1) return { ok: false, rewardIssued: false, milesAwarded: 0, error: "Platform unavailable" };
      return { ok: true, rewardIssued: true, milesAwarded: 100 };
    });

    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_reward_jobs") {
        return Promise.resolve({
          data: [
            { id: "job-1", order_id: "order-1", payload: {} },
            { id: "job-2", order_id: "order-2", payload: {} },
          ],
          error: null,
        });
      }
      if (name === "complete_reward_job") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await POST(makeRequest("test-secret"));
    const json = await res.json() as { released: number; retried: number };

    expect(res.status).toBe(200);
    expect(json.released).toBe(1);
    expect(json.retried).toBe(1);
    expect(mockRpc).toHaveBeenCalledWith("complete_reward_job", expect.objectContaining({
      p_job_id: "job-1", p_ok: false, p_error: "Platform unavailable",
    }));
    expect(mockRpc).toHaveBeenCalledWith("complete_reward_job", expect.objectContaining({ p_job_id: "job-2", p_ok: true }));
  });

  it("returns an empty result when there is nothing eligible to claim", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_reward_jobs") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await POST(makeRequest("test-secret"));
    const json = await res.json() as { claimed: number };
    expect(res.status).toBe(200);
    expect(json.claimed).toBe(0);

    const { sendPurchaseEvent } = await import("@/lib/akiba/purchase-events");
    expect(vi.mocked(sendPurchaseEvent)).not.toHaveBeenCalled();
  });

  it("returns 500 if claim_reward_jobs itself fails", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_reward_jobs") return Promise.resolve({ data: null, error: { message: "db error" } });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await POST(makeRequest("test-secret"));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/internal/process-reward-jobs (Vercel Cron)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    mockPurchaseEventResult = { ok: true, rewardIssued: true, milesAwarded: 100 };
  });

  it("rejects requests without the correct bearer token", async () => {
    const res = await GET(makeCronRequest("wrong"));
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects requests when CRON_SECRET isn't configured on this instance", async () => {
    process.env.CRON_SECRET = "";
    const res = await GET(makeCronRequest("cron-secret"));
    expect(res.status).toBe(401);
  });

  it("processes the batch when the bearer token matches CRON_SECRET", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_reward_jobs") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await GET(makeCronRequest("cron-secret"));
    const json = await res.json() as { ok: boolean };
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });
});
