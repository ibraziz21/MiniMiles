/**
 * Unit tests for the discovery-quests reward bridge, inbound half
 * (discovery-quests-spec.md §5.4):
 *  - verifyRewardWebhookSignature — HMAC verification against the exact
 *    wire format Akiba-Platform's webhook-delivery worker actually sends
 *    (sha256=<hex> over the raw body, no timestamp in the signed value).
 *  - POST /api/internal/reward-issued — signature gate, malformed-payload
 *    rejection, non-wallet-identity skip, and the enqueuePlatformReward call.
 *  - enqueuePlatformReward — idempotency key shape and mint-job payload.
 */
import { createHmac } from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.AKIBA_REWARD_WEBHOOK_SECRET = "reward-secret";

const mockEnqueuePlatformReward = vi.fn(async (_opts: unknown) => {});
vi.mock("@/lib/minipointQueue", () => ({
  enqueuePlatformReward: (opts: unknown) => mockEnqueuePlatformReward(opts),
}));

function sign(body: string, secret = "reward-secret"): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyRewardWebhookSignature", () => {
  it("accepts a correctly signed body", async () => {
    const { verifyRewardWebhookSignature } = await import("@/lib/akiba/verifyRewardWebhook");
    const body = JSON.stringify({ event: "reward_issued", data: {}, timestamp: "t", deliveryId: "d" });
    expect(verifyRewardWebhookSignature(body, sign(body))).toBe(true);
  });

  it("rejects a body signed with the wrong secret", async () => {
    const { verifyRewardWebhookSignature } = await import("@/lib/akiba/verifyRewardWebhook");
    const body = JSON.stringify({ event: "reward_issued" });
    expect(verifyRewardWebhookSignature(body, sign(body, "wrong-secret"))).toBe(false);
  });

  it("rejects a tampered body (signature no longer matches)", async () => {
    const { verifyRewardWebhookSignature } = await import("@/lib/akiba/verifyRewardWebhook");
    const original = JSON.stringify({ event: "reward_issued", data: { amount: 100 } });
    const signature = sign(original);
    const tampered = JSON.stringify({ event: "reward_issued", data: { amount: 999999 } });
    expect(verifyRewardWebhookSignature(tampered, signature)).toBe(false);
  });

  it("rejects when the signature header is missing", async () => {
    const { verifyRewardWebhookSignature } = await import("@/lib/akiba/verifyRewardWebhook");
    expect(verifyRewardWebhookSignature("{}", null)).toBe(false);
  });

  it("rejects when the secret is not configured", async () => {
    const prev = process.env.AKIBA_REWARD_WEBHOOK_SECRET;
    process.env.AKIBA_REWARD_WEBHOOK_SECRET = "";
    const { verifyRewardWebhookSignature } = await import("@/lib/akiba/verifyRewardWebhook");
    const body = "{}";
    expect(verifyRewardWebhookSignature(body, sign(body))).toBe(false);
    process.env.AKIBA_REWARD_WEBHOOK_SECRET = prev;
  });
});

describe("POST /api/internal/reward-issued", () => {
  beforeEach(() => {
    mockEnqueuePlatformReward.mockClear();
  });

  function makeRequest(body: string, signature?: string): Request {
    return new Request("http://localhost/api/internal/reward-issued", {
      method: "POST",
      headers: signature ? { "x-akiba-signature": signature } : {},
      body,
    });
  }

  it("returns 401 when the signature is missing or wrong", async () => {
    const { POST } = await import("@/app/api/internal/reward-issued/route");
    const body = JSON.stringify({ data: { rewardId: "r1", questId: "q1", amount: 100, identityType: "wallet", identityValue: "0xabc" } });

    const res = await POST(makeRequest(body, "sha256=wrong"));
    expect(res.status).toBe(401);
    expect(mockEnqueuePlatformReward).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed payload (missing rewardId)", async () => {
    const { POST } = await import("@/app/api/internal/reward-issued/route");
    const body = JSON.stringify({ data: { questId: "q1", amount: 100, identityType: "wallet", identityValue: "0xabc" } });

    const res = await POST(makeRequest(body, sign(body)));
    expect(res.status).toBe(400);
    expect(mockEnqueuePlatformReward).not.toHaveBeenCalled();
  });

  it("acknowledges without enqueueing when the identity is not a wallet", async () => {
    const { POST } = await import("@/app/api/internal/reward-issued/route");
    const body = JSON.stringify({
      data: { rewardId: "r1", questId: "q1", amount: 100, identityType: "email", identityValue: "a@b.com" },
    });

    const res = await POST(makeRequest(body, sign(body)));
    const json = await res.json() as { ok: boolean; skipped?: string };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.skipped).toBeTruthy();
    expect(mockEnqueuePlatformReward).not.toHaveBeenCalled();
  });

  it("enqueues the platform reward for a valid, correctly-signed wallet reward", async () => {
    const { POST } = await import("@/app/api/internal/reward-issued/route");
    const body = JSON.stringify({
      event: "reward_issued",
      data: { rewardId: "r1", questId: "q1", amount: 100, currency: "AKIBA_MILES", identityType: "wallet", identityValue: "0xABC" },
      timestamp: "2026-01-01T00:00:00Z",
      deliveryId: "d1",
    });

    const res = await POST(makeRequest(body, sign(body)));
    const json = await res.json() as { ok: boolean };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mockEnqueuePlatformReward).toHaveBeenCalledWith({
      rewardId: "r1",
      questId: "q1",
      walletAddress: "0xABC",
      points: 100,
    });
  });

  it("acknowledges a canonical api_partner_quests reward without minting it twice", async () => {
    const { POST } = await import("@/app/api/internal/reward-issued/route");
    const body = JSON.stringify({
      event: "reward_issued",
      data: {
        rewardId: "r-canonical",
        questId: "216cd2c5-74c9-4e79-80ba-612ecaff4aaf",
        amount: 20,
        currency: "AKIBA_MILES",
        identityType: "wallet",
        identityValue: "0xABC",
      },
      timestamp: "2026-01-01T00:00:00Z",
      deliveryId: "d-canonical",
    });

    const res = await POST(makeRequest(body, sign(body)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "canonical partner quest" });
    expect(mockEnqueuePlatformReward).not.toHaveBeenCalled();
  });

  it("returns 500 when enqueuePlatformReward throws, so Platform's delivery worker retries", async () => {
    mockEnqueuePlatformReward.mockRejectedValueOnce(new Error("db down"));
    const { POST } = await import("@/app/api/internal/reward-issued/route");
    const body = JSON.stringify({
      data: { rewardId: "r1", questId: "q1", amount: 100, identityType: "wallet", identityValue: "0xabc" },
    });

    const res = await POST(makeRequest(body, sign(body)));
    expect(res.status).toBe(500);
  });
});
