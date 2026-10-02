/**
 * Route-level unit tests for POST /api/internal/process-discovery-projection-jobs —
 * the shadow-mode worker that keeps merchant_discovery_public_snapshots
 * fresh (hardening spec §5.4). The entire claim-compute-complete cycle is
 * one Postgres RPC; this route is just the authenticated trigger.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}));

const { POST, GET } = await import("@/app/api/internal/process-discovery-projection-jobs/route");

function makeRequest(secret?: string): Request {
  return new Request("http://localhost/api/internal/process-discovery-projection-jobs", {
    method: "POST",
    headers: secret ? { "x-webhook-secret": secret } : {},
  });
}

function makeCronRequest(bearer?: string): Request {
  return new Request("http://localhost/api/internal/process-discovery-projection-jobs", {
    method: "GET",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

const ORIGINAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

describe("POST /api/internal/process-discovery-projection-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_WEBHOOK_SECRET = "test-secret";
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

  it("delegates the whole claim/compute/complete cycle to one RPC call", async () => {
    mockRpc.mockResolvedValue({ data: [{ claimed: 3, succeeded: 3, failed: 0 }], error: null });

    const res = await POST(makeRequest("test-secret"));
    const json = await res.json() as { ok: boolean; claimed: number; succeeded: number; failed: number };

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, claimed: 3, succeeded: 3, failed: 0 });
    expect(mockRpc).toHaveBeenCalledWith("process_pending_merchant_discovery_projection_jobs", { p_limit: 25 });
  });

  it("returns 500 when the RPC itself fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db error" } });

    const res = await POST(makeRequest("test-secret"));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/internal/process-discovery-projection-jobs (Vercel Cron)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
  });

  it("rejects requests without the correct bearer token", async () => {
    const res = await GET(makeCronRequest("wrong"));
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("processes the batch when the bearer token matches CRON_SECRET", async () => {
    mockRpc.mockResolvedValue({ data: [{ claimed: 0, succeeded: 0, failed: 0 }], error: null });

    const res = await GET(makeCronRequest("cron-secret"));
    const json = await res.json() as { ok: boolean };
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });
});
