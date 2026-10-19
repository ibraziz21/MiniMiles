import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: { userId: "user-1", email: "member@example.com", authMode: "bearer", accessToken: "token" } as {
    userId: string;
    email: string | null;
    authMode: "bearer";
    accessToken: string;
  } | null,
  assertMutationAllowed: vi.fn(),
  createIntent: vi.fn(),
}));

vi.mock("@/lib/auth/requestActor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/requestActor")>();
  return {
    ...actual,
    requireActor: vi.fn(async () => {
      if (!mocks.actor) throw new actual.UnauthorizedError();
      return mocks.actor;
    }),
  };
});

vi.mock("@/lib/api/v1/mutationGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/v1/mutationGuard")>();
  return { ...actual, assertMutationAllowed: mocks.assertMutationAllowed };
});

vi.mock("@/lib/discovery/photoUploads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discovery/photoUploads")>();
  return { ...actual, createDiscoveryPhotoUploadIntent: mocks.createIntent };
});

const { POST } = await import(
  "@/app/api/v1/me/discovery-contributions/[id]/photos/upload-intent/route"
);

const contributionId = "e8069a29-d2b0-4ad1-946d-45ad505acd76";

function request() {
  return new Request("http://localhost/api/v1/me/discovery-contributions/id/photos/upload-intent", {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json", "X-Request-Id": "request-1" },
    body: JSON.stringify({ contentType: "image/jpeg", consentVersion: "v1" }),
  });
}

describe("native verified-visit photo upload intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor = { userId: "user-1", email: "member@example.com", authMode: "bearer", accessToken: "token" };
    mocks.createIntent.mockResolvedValue({
      photoId: "photo-1",
      bucket: "discovery-visit-photos",
      path: `${contributionId}/photo-1.jpg`,
      expiresAt: "2026-10-18T22:00:00.000Z",
      expiresInSeconds: 300,
    });
  });

  it("uses the bearer actor and returns the standard native envelope", async () => {
    const response = await POST(request(), { params: { id: contributionId } });

    expect(response.status).toBe(200);
    expect(mocks.assertMutationAllowed).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ authMode: "bearer" }));
    expect(mocks.createIntent).toHaveBeenCalledWith({
      contributionId,
      userId: "user-1",
      contentType: "image/jpeg",
      consentVersion: "v1",
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { photoId: "photo-1", bucket: "discovery-visit-photos" },
      meta: { requestId: "request-1", apiVersion: "v1" },
    });
  });

  it("rejects a missing mobile session before creating an intent", async () => {
    mocks.actor = null;
    const response = await POST(request(), { params: { id: contributionId } });

    expect(response.status).toBe(401);
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });
});
