/**
 * Unit tests for sendInternalEvent (discovery-quests-spec.md §3 outbound
 * adapter). Same mocked-fetch shape as purchase-events.test.ts — verifies
 * the request contract and the never-throws safe-fallback behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.AKIBA_API_URL = "https://platform.test";
process.env.AKIBA_API_KEY = "test-key";

const { sendInternalEvent } = await import("@/lib/akiba/internal-events");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const job = {
  event_type: "pass_activated",
  idempotency_key: "pass:user-123",
  identities: [{ type: "email" as const, value: "a@b.com" }],
  occurred_at: "2026-01-01T00:00:00.000Z",
  metadata: { src: "organic" },
};

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendInternalEvent", () => {
  it("posts to /api/v1/events/track with the Platform event contract", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ success: true }));

    const result = await sendInternalEvent(job);

    expect(result.ok).toBe(true);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://platform.test/api/v1/events/track");
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect((options.headers as Record<string, string>)["Idempotency-Key"]).toBe("pass:user-123");

    const body = JSON.parse(options.body as string);
    expect(body).toEqual({
      eventType: "pass_activated",
      identities: job.identities,
      idempotencyKey: "pass:user-123",
      occurredAt: job.occurred_at,
      metadata: job.metadata,
    });
  });

  it("returns ok:false without throwing when Platform is not configured", async () => {
    const prevUrl = process.env.AKIBA_API_URL;
    process.env.AKIBA_API_URL = "";

    const result = await sendInternalEvent(job);

    expect(result.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();

    process.env.AKIBA_API_URL = prevUrl;
  });

  it("returns ok:false when Platform responds non-2xx", async () => {
    mockFetch.mockResolvedValueOnce(new Response("bad request", { status: 422 }));

    const result = await sendInternalEvent(job);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("422");
  });

  it("returns ok:false when fetch throws (network failure)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await sendInternalEvent(job);

    expect(result.ok).toBe(false);
  });
});
