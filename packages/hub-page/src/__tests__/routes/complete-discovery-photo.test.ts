import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  storageFrom: vi.fn(),
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
  });

  // Hardening spec §5.5: the foreground completion request flips the state
  // and enqueues the job, then returns — it must never itself claim and
  // process a queue job (claim_photo_processing_jobs takes the oldest
  // pending job regardless of which photo it belongs to, so doing that here
  // could process a completely unrelated backlogged photo). Only the
  // scheduled worker (/api/internal/process-photo-jobs) processes jobs.
  it("flips the photo to processing and enqueues its job without claiming any queue job itself", async () => {
    const response = await POST(new Request("http://localhost/api/photo/complete", { method: "POST" }), {
      params: { id: contributionId, photoId },
    });

    expect(response.status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledWith("complete_discovery_photo_upload", { p_photo_id: photoId });
    await expect(response.json()).resolves.toMatchObject({ ok: true, photoId, status: "processing" });
  });
});
