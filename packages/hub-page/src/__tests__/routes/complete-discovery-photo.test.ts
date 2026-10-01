import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processPendingPhotoJobs: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock("@/lib/discovery/photoProcessing", () => ({
  processPendingPhotoJobs: mocks.processPendingPhotoJobs,
}));

vi.mock("@/lib/push/origin", () => ({ isSameOriginRequest: () => true }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));

const admin = {
  from: mocks.from,
  rpc: mocks.rpc,
  storage: { from: mocks.storageFrom },
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

const { POST } = await import(
  "@/app/api/me/discovery-contributions/[id]/photos/[photoId]/complete/route"
);

const contributionId = "e8069a29-d2b0-4ad1-946d-45ad505acd76";
const photoId = "0f4a1d56-d34e-4f11-8abc-33221100aabb";

describe("POST discovery photo complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const lookupBuilder: Record<string, unknown> = {};
    lookupBuilder.select = vi.fn(() => lookupBuilder);
    lookupBuilder.eq = vi.fn(() => lookupBuilder);
    lookupBuilder.maybeSingle = vi.fn(async () => ({
      data: {
        id: photoId,
        private_source_key: `${contributionId}/${photoId}.jpg`,
        moderation_status: "uploading",
      },
      error: null,
    }));
    mocks.from.mockReturnValue(lookupBuilder);

    mocks.storageFrom.mockReturnValue({
      list: vi.fn(async () => ({ data: [{ name: `${photoId}.jpg` }], error: null })),
    });
    mocks.rpc.mockResolvedValue({ data: [{ ok: true }], error: null });
    mocks.processPendingPhotoJobs.mockResolvedValue({ claimed: 1, succeeded: 1, failed: 0 });
  });

  it("processes one queued image immediately after upload completion", async () => {
    const response = await POST(new Request("http://localhost/api/photo/complete", { method: "POST" }), {
      params: { id: contributionId, photoId },
    });

    expect(response.status).toBe(200);
    expect(mocks.processPendingPhotoJobs).toHaveBeenCalledWith(admin, 1);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processing: { claimed: 1, succeeded: 1, failed: 0 },
    });
  });
});
