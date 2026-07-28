/**
 * Unit tests for sendSponsoredGamePlayedWebhook (discovery-quests-spec.md
 * §3.4) — the signed webhook client that reports an accepted skill-game
 * session to Akiba-Platform's generic partner webhook ingestion. Verifies
 * the request contract (headers, signed body) against what the actual
 * Platform route expects, not the spec doc's flatter payload example.
 */
import { createHmac } from "crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.AKIBA_API_URL = "https://platform.test";
process.env.AKIBA_PARTNER_SLUG = "minimiles";
process.env.AKIBA_PARTNER_KEY_ID = "key-123";
process.env.AKIBA_WEBHOOK_SECRET = "shh";

const { sendSponsoredGamePlayedWebhook } = await import("@/lib/akiba/sponsoredGameWebhook");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const job = {
  idempotency_key: "sgp:0xabc:rule_tap:2026-W01",
  wallet_address: "0xabc",
  game_type: "rule_tap",
  iso_week: "2026-W01",
  campaign_id: "campaign-1",
  quest_id: "quest-1",
  quest_verification_rule_id: "rule-1",
};

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendSponsoredGamePlayedWebhook", () => {
  it("posts to the partner webhook route with the nested proof envelope", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ success: true }));

    const result = await sendSponsoredGamePlayedWebhook(job);

    expect(result.ok).toBe(true);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://platform.test/api/v1/webhooks/partners/minimiles");

    const body = JSON.parse(options.body as string);
    expect(body).toEqual({
      questId: "quest-1",
      questVerificationRuleId: "rule-1",
      proof: {
        action: "sponsored_game_played",
        identity: { type: "wallet", value: "0xabc" },
        metadata: { game_type: "rule_tap", iso_week: "2026-W01", campaign_id: "campaign-1" },
      },
    });
  });

  it("signs the request with HMAC-SHA256 over `${timestamp}.${rawBody}`", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ success: true }));

    await sendSponsoredGamePlayedWebhook(job);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    const timestamp = headers["X-Akiba-Timestamp"];
    const expectedSig = createHmac("sha256", "shh")
      .update(`${timestamp}.${options.body}`)
      .digest("hex");

    expect(headers["X-Akiba-Signature"]).toBe(expectedSig);
    expect(headers["X-Akiba-Partner-Key"]).toBe("key-123");
    expect(headers["X-Akiba-Idempotency-Key"]).toBe(job.idempotency_key);
  });

  it("returns ok:false without throwing when Platform webhook env is not configured", async () => {
    const prevSecret = process.env.AKIBA_WEBHOOK_SECRET;
    process.env.AKIBA_WEBHOOK_SECRET = "";

    const result = await sendSponsoredGamePlayedWebhook(job);

    expect(result.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();

    process.env.AKIBA_WEBHOOK_SECRET = prevSecret;
  });

  it("returns ok:false when Platform responds non-2xx", async () => {
    mockFetch.mockResolvedValueOnce(new Response("conflict", { status: 409 }));

    const result = await sendSponsoredGamePlayedWebhook(job);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("409");
  });

  it("returns ok:false when fetch throws (network failure)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await sendSponsoredGamePlayedWebhook(job);

    expect(result.ok).toBe(false);
  });
});
