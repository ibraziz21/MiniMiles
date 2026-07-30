import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

const { POST } = await import("@/app/api/internal/revalidate-merchant-directory/route");

const BODY = {
  partnerId: "20000000-0000-4000-8000-000000000002",
  slug: "akiba-coffee",
  reason: "locations_updated",
  version: "2026-07-30T10:00:00.000Z",
};

function request(body: unknown = BODY, secret = "directory-secret") {
  return new Request("http://localhost/api/internal/revalidate-merchant-directory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-directory-revalidation-secret": secret,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/revalidate-merchant-directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECTORY_REVALIDATION_SECRET = "directory-secret";
  });

  it("rejects a caller with the wrong shared secret", async () => {
    const response = await POST(request(BODY, "wrong"));

    expect(response.status).toBe(401);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("validates identifiers before acknowledging an outbox job", async () => {
    const response = await POST(request({ ...BODY, partnerId: "partner-1" }));

    expect(response.status).toBe(400);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates directory list and detail surfaces", async () => {
    const response = await POST(request());
    const body = await response.json() as { ok: boolean; slug: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, partnerId: BODY.partnerId, slug: BODY.slug });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/merchants", "page");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/api/merchants", "page");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/merchants/akiba-coffee", "page");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/api/merchants/akiba-coffee", "page");
  });

  it("accepts a null slug and revalidates only the collection routes", async () => {
    const response = await POST(request({ ...BODY, slug: null }));

    expect(response.status).toBe(200);
    expect(mockRevalidatePath).toHaveBeenCalledTimes(2);
  });
});
