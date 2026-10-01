import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockStorageFrom = vi.fn();
const mockRemove = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
    storage: { from: mockStorageFrom },
  }),
}));

// These tests exercise the abandoned-upload cleanup and claim path only; no
// image-processing job is returned, so sharp must never be invoked.
vi.mock("sharp", () => ({ default: vi.fn() }));

const { POST } = await import("@/app/api/internal/process-photo-jobs/route");

const ORIGINAL_SECRET = process.env.INTERNAL_WEBHOOK_SECRET;

function request(secret?: string): Request {
  return new Request("http://localhost/api/internal/process-photo-jobs", {
    method: "POST",
    headers: secret ? { "x-webhook-secret": secret } : {},
  });
}

function queryResult<T>(data: T, error: { message: string } | null = null) {
  return Promise.resolve({ data, error });
}

describe("POST /api/internal/process-photo-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_WEBHOOK_SECRET = "test-secret";
    mockStorageFrom.mockReturnValue({ remove: mockRemove });
    mockRemove.mockResolvedValue({ data: [], error: null });
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_photo_processing_jobs") return queryResult([]);
      return queryResult(null);
    });
  });

  afterAll(() => {
    process.env.INTERNAL_WEBHOOK_SECRET = ORIGINAL_SECRET;
  });

  it("rejects callers without the internal webhook secret", async () => {
    const response = await POST(request("wrong"));
    expect(response.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("withdraws stale upload intents before deleting their private objects", async () => {
    const stale = { id: "photo-1", private_source_key: "contribution/photo-1.jpg" };
    let selectCall = 0;
    const updates: Array<Record<string, unknown>> = [];

    mockFrom.mockImplementation(() => ({
      select: vi.fn(() => {
        selectCall++;
        const builder: Record<string, unknown> = {};
        builder.eq = vi.fn(() => builder);
        builder.lt = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);
        builder.limit = vi.fn(() => queryResult(selectCall === 1 ? [stale] : [stale]));
        return builder;
      }),
      update: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        const builder: any = {
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: null })),
        };
        builder.in = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.select = vi.fn(() => queryResult([stale]));
        return builder;
      }),
    }));

    const response = await POST(request("test-secret"));
    const body = (await response.json()) as { expiredUploads: number; claimed: number };

    expect(response.status).toBe(200);
    expect(body.expiredUploads).toBe(1);
    expect(body.claimed).toBe(0);
    expect(updates[0]).toMatchObject({
      moderation_status: "withdrawn",
      moderation_reason_code: "upload_abandoned_cleanup_pending",
    });
    expect(mockRemove).toHaveBeenCalledWith([stale.private_source_key]);
    expect(updates[1]).toEqual({ moderation_reason_code: "upload_abandoned" });
  });

  it("keeps cleanup pending when private storage is unavailable", async () => {
    const stale = { id: "photo-1", private_source_key: "contribution/photo-1.jpg" };
    let selectCall = 0;
    const updates: Array<Record<string, unknown>> = [];

    mockFrom.mockImplementation(() => ({
      select: vi.fn(() => {
        selectCall++;
        const builder: Record<string, unknown> = {};
        builder.eq = vi.fn(() => builder);
        builder.lt = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);
        builder.limit = vi.fn(() => queryResult(selectCall === 1 ? [stale] : [stale]));
        return builder;
      }),
      update: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        const builder: any = {
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: null })),
        };
        builder.in = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.select = vi.fn(() => queryResult([stale]));
        return builder;
      }),
    }));
    mockRemove.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });

    const response = await POST(request("test-secret"));
    const body = (await response.json()) as { expiredUploads: number };

    expect(response.status).toBe(200);
    expect(body.expiredUploads).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ moderation_reason_code: "upload_abandoned_cleanup_pending" });
  });
});
