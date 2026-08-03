/**
 * Route-level unit tests for POST /api/internal/process-internal-event-jobs —
 * the scheduled worker that guarantees a Platform outage can't lose a
 * pass_activated/voucher_redeemed/purchase_reversed event (the same
 * durability guarantee process-reward-jobs gives purchase events).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { InternalEventResult } from "@/lib/akiba/internal-events";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}));

let mockResult: InternalEventResult = { ok: true };
vi.mock("@/lib/akiba/internal-events", () => ({
  sendInternalEvent: vi.fn(async () => mockResult),
}));

const { POST, GET } = await import("@/app/api/internal/process-internal-event-jobs/route");

function makeRequest(secret?: string): Request {
  return new Request("http://localhost/api/internal/process-internal-event-jobs", {
    method: "POST",
    headers: secret ? { "x-webhook-secret": secret } : {},
  });
}

function makeCronRequest(bearer?: string): Request {
  return new Request("http://localhost/api/internal/process-internal-event-jobs", {
    method: "GET",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

const ORIGINAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

describe("POST /api/internal/process-internal-event-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_WEBHOOK_SECRET = "test-secret";
    mockResult = { ok: true };
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

  it("claims a batch and releases every job that succeeds", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_internal_event_jobs") {
        return Promise.resolve({
          data: [
            { id: "job-1", event_type: "pass_activated", idempotency_key: "pass:user-1", identities: [], occurred_at: "2026-01-01T00:00:00Z", metadata: {}, attempts: 1 },
            { id: "job-2", event_type: "voucher_redeemed", idempotency_key: "vredeem:v-1", identities: [], occurred_at: "2026-01-01T00:00:00Z", metadata: {}, attempts: 1 },
          ],
          error: null,
        });
      }
      if (name === "complete_internal_event_job") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await POST(makeRequest("test-secret"));
    const json = await res.json() as { claimed: number; released: number; retried: number };

    expect(res.status).toBe(200);
    expect(json.claimed).toBe(2);
    expect(json.released).toBe(2);
    expect(json.retried).toBe(0);
    expect(mockRpc).toHaveBeenCalledWith("complete_internal_event_job", expect.objectContaining({ p_job_id: "job-1", p_ok: true }));
    expect(mockRpc).toHaveBeenCalledWith("complete_internal_event_job", expect.objectContaining({ p_job_id: "job-2", p_ok: true }));
  });

  it("re-arms (retries) a job that fails instead of dropping it", async () => {
    mockResult = { ok: false, error: "Platform unavailable" };
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_internal_event_jobs") {
        return Promise.resolve({
          data: [{ id: "job-1", event_type: "pass_activated", idempotency_key: "pass:user-1", identities: [], occurred_at: "2026-01-01T00:00:00Z", metadata: {}, attempts: 1 }],
          error: null,
        });
      }
      if (name === "complete_internal_event_job") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await POST(makeRequest("test-secret"));
    const json = await res.json() as { released: number; retried: number };

    expect(json.released).toBe(0);
    expect(json.retried).toBe(1);
    expect(mockRpc).toHaveBeenCalledWith("complete_internal_event_job", expect.objectContaining({
      p_job_id: "job-1", p_ok: false, p_retryable: true, p_error_detail: "Platform unavailable",
    }));
  });

  it("returns an empty result when there is nothing to claim", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_internal_event_jobs") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await POST(makeRequest("test-secret"));
    const json = await res.json() as { claimed: number };
    expect(res.status).toBe(200);
    expect(json.claimed).toBe(0);

    const { sendInternalEvent } = await import("@/lib/akiba/internal-events");
    expect(vi.mocked(sendInternalEvent)).not.toHaveBeenCalled();
  });

  it("returns 500 if claim_internal_event_jobs itself fails", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_internal_event_jobs") return Promise.resolve({ data: null, error: { message: "db error" } });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await POST(makeRequest("test-secret"));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/internal/process-internal-event-jobs (Vercel Cron)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    mockResult = { ok: true };
  });

  it("rejects requests without the correct bearer token", async () => {
    const res = await GET(makeCronRequest("wrong"));
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("processes the batch when the bearer token matches CRON_SECRET", async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_internal_event_jobs") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const res = await GET(makeCronRequest("cron-secret"));
    const json = await res.json() as { ok: boolean };
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });
});
