import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  merchant: { id: "merchant-1" } as { id: string } | null,
  eligible: true,
}));

vi.mock("@/lib/auth/requestActor", () => {
  class MockUnauthorizedError extends Error {
    readonly status = 401;
    readonly code = "UNAUTHORIZED";
  }
  return {
    UnauthorizedError: MockUnauthorizedError,
    requireActor: async () => {
      if (!state.actor) throw new MockUnauthorizedError("Unauthorized");
      return state.actor;
    },
  };
});

class MockDirectoryUnavailableError extends Error {}
vi.mock("@/lib/merchants/queries", () => ({
  DirectoryUnavailableError: MockDirectoryUnavailableError,
  getPublicMerchant: async () => state.merchant,
}));

vi.mock("@/lib/merchants/verifiedVisitHelpful", () => ({
  isEligiblePublicVerifiedVisit: async () => state.eligible,
}));

const reportMock = vi.fn();
vi.mock("@/lib/merchants/verifiedVisitReports", async (importOriginal) => {
  // Keep the real reason validation — it is part of what this route promises.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, reportVerifiedVisit: (...args: unknown[]) => reportMock(...args) };
});

const { POST } = await import(
  "@/app/api/v1/merchants/[slug]/verified-visits/[visitId]/report/route"
);

const VISIT = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PHOTO = "11111111-1111-4111-8111-111111111111";

function request(body: unknown, opts: { origin?: string; contentType?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.contentType !== null) headers["content-type"] = opts.contentType ?? "application/json";
  if (opts.origin) headers.origin = opts.origin;
  return new Request(`http://localhost/api/v1/merchants/acme/verified-visits/${VISIT}/report`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = { params: { slug: "acme", visitId: VISIT } };

describe("POST verified visit report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = { userId: "user-1", email: null, authMode: "bearer" };
    state.merchant = { id: "merchant-1" };
    state.eligible = true;
    reportMock.mockResolvedValue({ ok: true, alreadyReported: false });
  });

  it("requires authentication", async () => {
    state.actor = null;
    expect((await POST(request({ reason: "spam" }), ctx)).status).toBe(401);
  });

  it("rejects a cross-origin cookie mutation", async () => {
    state.actor = { userId: "user-1", email: null, authMode: "cookie" };
    expect((await POST(request({ reason: "spam" }, { origin: "https://evil.example" }), ctx)).status).toBe(403);
  });

  it("rejects a bearer mutation that is not JSON", async () => {
    expect((await POST(request({ reason: "spam" }, { contentType: "text/plain" }), ctx)).status).toBe(415);
  });

  it.each([undefined, null, "", "DROP TABLE", "not_a_reason", 7])(
    "refuses %o as a reason",
    async (reason) => {
      const response = await POST(request({ reason }), ctx);
      const payload = (await response.json()) as { error: { code: string } };
      expect(response.status).toBe(400);
      expect(payload.error.code).toBe("INVALID_REASON");
      expect(reportMock).not.toHaveBeenCalled();
    },
  );

  it("refuses a photoId that is not a UUID rather than silently dropping it", async () => {
    // Dropping it would file a vaguer report than the member intended.
    const response = await POST(request({ reason: "spam", photoId: "nope" }), ctx);
    expect(response.status).toBe(400);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("accepts a report without a photo", async () => {
    const response = await POST(request({ reason: "not_this_place" }), ctx);
    expect(response.status).toBe(200);
    expect(reportMock).toHaveBeenCalledWith(
      expect.objectContaining({ contributionId: VISIT, photoId: null, reason: "not_this_place" }),
    );
  });

  it("files the report against the authenticated actor, never a body-supplied id", async () => {
    await POST(request({ reason: "spam", photoId: PHOTO, hubUserId: "user-2", reporterHubUserId: "user-2" }), ctx);
    expect(reportMock).toHaveBeenCalledWith(expect.objectContaining({ hubUserId: "user-1", photoId: PHOTO }));
  });

  it("404s a visit that is not publicly eligible", async () => {
    // Hidden, withdrawn, or another merchant's card: a member must not be
    // able to report something they could never have seen.
    state.eligible = false;
    const response = await POST(request({ reason: "spam" }), ctx);
    expect(response.status).toBe(404);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("404s an unknown merchant", async () => {
    state.merchant = null;
    expect((await POST(request({ reason: "spam" }), ctx)).status).toBe(404);
  });

  it("treats a repeat report as success, not an error", async () => {
    // Answering "you already reported this" invites the member to find
    // another route to complain about the same thing.
    reportMock.mockResolvedValue({ ok: true, alreadyReported: true });
    const response = await POST(request({ reason: "spam" }), ctx);
    const payload = (await response.json()) as { data: { reported: boolean; alreadyReported: boolean } };

    expect(response.status).toBe(200);
    expect(payload.data).toEqual({ reported: true, alreadyReported: true });
  });

  it("does not leak the database error to the caller", async () => {
    reportMock.mockResolvedValue({ ok: false, error: 'duplicate key value violates "idx_x"' });
    const response = await POST(request({ reason: "spam" }), ctx);
    const payload = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("REPORT_FAILED");
    expect(payload.error.message).not.toContain("duplicate key");
  });

  it("never caches a report response", async () => {
    const response = await POST(request({ reason: "spam" }), ctx);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
