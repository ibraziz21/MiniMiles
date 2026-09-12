import { describe, expect, it, vi } from "vitest";

const mockConfirmQuestClaim = vi.fn();
const mockGetQuestClaimStatus = vi.fn();
const mockGetPendingQuestClaims = vi.fn();

vi.mock("@/lib/server/questClaimEngine", () => ({
  confirmQuestClaim: (...a: any[]) => mockConfirmQuestClaim(...a),
  getQuestClaimStatus: (...a: any[]) => mockGetQuestClaimStatus(...a),
  getPendingQuestClaims: (...a: any[]) => mockGetPendingQuestClaims(...a),
}));

const { POST: confirmPOST } = await import("@/app/api/quests/self-claim/confirm/route");
const { GET: statusGET } = await import("@/app/api/quests/self-claim/status/route");
const { GET: pendingGET } = await import("@/app/api/quests/self-claim/pending/route");

describe("generic /api/quests/self-claim/* routes", () => {
  it("confirm delegates to confirmQuestClaim", async () => {
    const marker = Response.json({ ok: true });
    mockConfirmQuestClaim.mockResolvedValue(marker);
    const req = new Request("http://localhost/api/quests/self-claim/confirm", { method: "POST" });

    const res = await confirmPOST(req);

    expect(mockConfirmQuestClaim).toHaveBeenCalledWith(req);
    expect(res).toBe(marker);
  });

  it("status delegates to getQuestClaimStatus", async () => {
    const marker = Response.json({ ok: true });
    mockGetQuestClaimStatus.mockResolvedValue(marker);
    const req = new Request("http://localhost/api/quests/self-claim/status?intentId=x");

    const res = await statusGET(req);

    expect(mockGetQuestClaimStatus).toHaveBeenCalledWith(req);
    expect(res).toBe(marker);
  });

  it("pending delegates to getPendingQuestClaims", async () => {
    const marker = Response.json({ ok: true });
    mockGetPendingQuestClaims.mockResolvedValue(marker);
    const req = new Request("http://localhost/api/quests/self-claim/pending");

    const res = await pendingGET(req);

    expect(mockGetPendingQuestClaims).toHaveBeenCalledWith(req);
    expect(res).toBe(marker);
  });
});
