// Verifies inbound reward_issued deliveries from Akiba-Platform
// (discovery-quests-spec.md §5.4). This is a DIFFERENT wire format from the
// outbound sponsored_game_played signer in sponsoredGameWebhook.ts — that one
// targets the generic partner-API ingestion route (timestamp+body HMAC,
// several headers). This one is Platform's OUTBOUND webhook-delivery worker
// (Akiba-Platform/packages/api/app/api/internal/webhook-worker/route.ts),
// confirmed by reading it directly:
//   - header: X-Akiba-Signature: sha256=<hex>
//   - signed value: the exact raw request body (no timestamp in the
//     signature input — the body's own `timestamp` field is just informational,
//     not a replay-window input on this route)
//   - secret: the react-app partner row's webhook_endpoints.secret
// No signed timestamp means no replay-window check is possible here; the
// real duplicate-delivery protection is enqueuePlatformReward's idempotency
// key (platform_reward:{rewardId}), which makes a replayed valid request a
// safe no-op rather than a double mint.
import { createHmac, timingSafeEqual } from "crypto";

export function verifyRewardWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.AKIBA_REWARD_WEBHOOK_SECRET ?? "";
  if (!secret || !signatureHeader) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type RewardIssuedDelivery = {
  event: string;
  data: {
    rewardId: string;
    questId: string;
    identityType: "wallet" | "email" | "phone";
    identityValue: string;
    amount: number;
    currency: string;
  };
  timestamp: string;
  deliveryId: string;
};
