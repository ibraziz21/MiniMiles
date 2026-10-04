/**
 * Security tests for POST .../photos/upload-intent (hardening spec §11.3):
 * unauthenticated → 401, cross-origin → 403, an unsupported declared content
 * type fails safely, a stale consent version is rejected, member A cannot
 * get an upload intent against member B's contribution, a withdrawn
 * contribution is rejected, rate limiting is enforced, the active-photo cap
 * is enforced, and the object key is never influenced by caller input.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  sameOrigin: true,
  withinRateLimit: true,
  contribution: null as { id: string; partner_id: string } | null,
  contributionError: null as { message: string } | null,
  activeCount: 0,
  insertError: null as { code?: string; message: string } | null,
}));

vi.mock("@/lib/push/origin", () => ({ isSameOriginRequest: () => state.sameOrigin }));
vi.mock("@/lib/rateLimit", () => ({ checkAllRateLimits: async () => state.withinRateLimit }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));

const mockInsert = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "merchant_discovery_contributions") {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.is = vi.fn(() => builder);
        builder.maybeSingle = vi.fn(async () => ({ data: state.contribution, error: state.contributionError }));
        return builder;
      }
      if (table === "merchant_visit_photos") {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.not = vi.fn(() => builder);
        builder.or = vi.fn(async () => ({ count: state.activeCount, error: null }));
        builder.insert = mockInsert.mockImplementation(async () => ({ error: state.insertError }));
        return builder;
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

const { POST } = await import("@/app/api/me/discovery-contributions/[id]/photos/upload-intent/route");

const CONTRIBUTION_ID = "e8069a29-d2b0-4ad1-946d-45ad505acd76";
const USER_ID = "10000000-0000-4000-8000-000000000001";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/photo/upload-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST discovery-contributions/:id/photos/upload-intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = { id: USER_ID };
    state.sameOrigin = true;
    state.withinRateLimit = true;
    state.contribution = { id: CONTRIBUTION_ID, partner_id: "partner-1" };
    state.contributionError = null;
    state.activeCount = 0;
    state.insertError = null;
  });

  it("rejects an unauthenticated request", async () => {
    state.user = null;
    const res = await POST(makeRequest({ contentType: "image/jpeg", consentVersion: "v1" }), { params: { id: CONTRIBUTION_ID } });
    expect(res.status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request", async () => {
    state.sameOrigin = false;
    const res = await POST(makeRequest({ contentType: "image/jpeg", consentVersion: "v1" }), { params: { id: CONTRIBUTION_ID } });
    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects a malformed contribution id", async () => {
    const res = await POST(makeRequest({ contentType: "image/jpeg", consentVersion: "v1" }), { params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
  });

  it("fails safely on an unsupported declared content type", async () => {
    const res = await POST(makeRequest({ contentType: "application/zip", consentVersion: "v1" }), { params: { id: CONTRIBUTION_ID } });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid_content_type");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("fails safely on a forged/spoofed MIME string that isn't on the allowlist", async () => {
    // "image/jpeg; charset=whatever" or an SVG/HTML payload masquerading
    // with an image-like string must not slip through a loose match.
    const res = await POST(makeRequest({ contentType: "image/svg+xml", consentVersion: "v1" }), { params: { id: CONTRIBUTION_ID } });
    expect(res.status).toBe(400);
  });

  it("rejects a stale consent version", async () => {
    const res = await POST(makeRequest({ contentType: "image/jpeg", consentVersion: "v0" }), { params: { id: CONTRIBUTION_ID } });
    expect(res.status).toBe(409);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns not_found for another member's contribution (ownership enforced in the query itself)", async () => {
    // The lookup scopes by hub_user_id in the same query — a mismatched
    // owner simply returns no row, same as a nonexistent id.
    state.contribution = null;
    const res = await POST(makeRequest({ contentType: "image/jpeg", consentVersion: "v1" }), { params: { id: CONTRIBUTION_ID } });
    expect(res.status).toBe(404);
  });

  it("returns not_found for a withdrawn contribution", async () => {
    // The lookup's .is("withdrawn_at", null) excludes it — same not_found
    // path as ownership, so a withdrawn contribution can't be resumed.
    state.contribution = null;
    const res = await POST(makeRequest({ contentType: "image/jpeg", consentVersion: "v1" }), { params: { id: CONTRIBUTION_ID } });
    expect(res.status).toBe(404);
  });

  it("enforces the per-user rate limit deterministically", async () => {
    state.withinRateLimit = false;
    const res = await POST(makeRequest({ contentType: "image/jpeg", consentVersion: "v1" }), { params: { id: CONTRIBUTION_ID } });
    expect(res.status).toBe(429);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("enforces the active-photo cap before creating an upload intent", async () => {
    state.activeCount = 3;
    const res = await POST(makeRequest({ contentType: "image/jpeg", consentVersion: "v1" }), { params: { id: CONTRIBUTION_ID } });
    expect(res.status).toBe(409);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("maps the trigger-enforced photo limit (DB race) to the same 409", async () => {
    state.insertError = { code: "23514", message: "photo_limit_reached" };
    const res = await POST(makeRequest({ contentType: "image/jpeg", consentVersion: "v1" }), { params: { id: CONTRIBUTION_ID } });
    expect(res.status).toBe(409);
  });

  it("derives the object key entirely server-side — no client field can influence it", async () => {
    await POST(
      makeRequest({
        contentType: "image/jpeg",
        consentVersion: "v1",
        // None of these should reach the storage key or the insert.
        objectKey: "../../etc/passwd",
        bucket: "some-other-bucket",
        partnerId: "attacker-controlled-partner",
        hubUserId: "attacker-controlled-user",
      }),
      { params: { id: CONTRIBUTION_ID } },
    );

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const inserted = mockInsert.mock.calls[0][0];
    const objectKey = inserted.private_source_key as string;
    expect(objectKey.startsWith(`${CONTRIBUTION_ID}/`)).toBe(true);
    expect(objectKey).not.toContain("..");
    expect(objectKey).not.toContain("attacker-controlled");

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      contribution_id: CONTRIBUTION_ID,
      hub_user_id: USER_ID,
      partner_id: "partner-1", // from the looked-up contribution row, not the request body
    }));
  });

  it("succeeds and returns an owner-bound five-minute upload intent", async () => {
    const res = await POST(makeRequest({ contentType: "image/webp", consentVersion: "v1" }), { params: { id: CONTRIBUTION_ID } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ bucket: "discovery-visit-photos", expiresInSeconds: 300 });
    expect(json.path).toMatch(new RegExp(`^${CONTRIBUTION_ID}/.+\\.webp$`));
    expect(json).not.toHaveProperty("token");
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ upload_intent_expires_at: json.expiresAt }));
    expect(typeof json.photoId).toBe("string");
  });
});
