// Server-only signed-webhook client for discovery-quests-spec.md §3.4 —
// react-app's backend posts sponsored_game_played proofs to Akiba-Platform's
// generic partner webhook ingestion (POST /api/v1/webhooks/partners/:slug).
//
// This is genuinely new signing code, not a reuse of lib/partnerAttestation.ts
// — that's a short-lived claim-token HMAC over a fixed string
// (`partner:{address}:{questId}:{window}`) for react-app's own local claim
// flow, not a per-request payload signer. The scheme here (raw-body HMAC +
// timestamp + partner-key header) is dictated by the actual Platform route,
// confirmed by reading it directly:
// Akiba-Platform/packages/api/app/api/v1/webhooks/partners/[partnerSlug]/route.ts
//   - signed string: `${timestamp}.${rawBody}`
//   - HMAC-SHA256, hex digest
//   - headers: X-Akiba-Partner-Key, X-Akiba-Signature, X-Akiba-Timestamp,
//     X-Akiba-Idempotency-Key
//   - ±300s timestamp tolerance
import { createHmac } from "crypto";

export type SponsoredGamePlayedResult = {
  ok: boolean;
  error?: string;
};

export async function sendSponsoredGamePlayedWebhook(job: {
  idempotency_key: string;
  wallet_address: string;
  game_type: string;
  iso_week: string;
  campaign_id: string;
  quest_id: string;
  quest_verification_rule_id: string;
}): Promise<SponsoredGamePlayedResult> {
  const AKIBA_API_URL = process.env.AKIBA_API_URL ?? "";
  const AKIBA_PARTNER_SLUG = process.env.AKIBA_PARTNER_SLUG ?? "";
  const AKIBA_PARTNER_KEY_ID = process.env.AKIBA_PARTNER_KEY_ID ?? "";
  const AKIBA_WEBHOOK_SECRET = process.env.AKIBA_WEBHOOK_SECRET ?? "";

  if (!AKIBA_API_URL || !AKIBA_PARTNER_SLUG || !AKIBA_PARTNER_KEY_ID || !AKIBA_WEBHOOK_SECRET) {
    console.warn("[sponsoredGameWebhook] Akiba Platform webhook env not configured — send skipped");
    return { ok: false, error: "Platform not configured" };
  }

  const body = JSON.stringify({
    questId: job.quest_id,
    questVerificationRuleId: job.quest_verification_rule_id,
    proof: {
      action: "sponsored_game_played",
      identity: { type: "wallet", value: job.wallet_address },
      metadata: {
        game_type: job.game_type,
        iso_week: job.iso_week,
        campaign_id: job.campaign_id,
      },
    },
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", AKIBA_WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  let res: Response;
  try {
    res = await fetch(`${AKIBA_API_URL}/api/v1/webhooks/partners/${AKIBA_PARTNER_SLUG}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Akiba-Partner-Key": AKIBA_PARTNER_KEY_ID,
        "X-Akiba-Signature": signature,
        "X-Akiba-Timestamp": timestamp,
        "X-Akiba-Idempotency-Key": job.idempotency_key,
      },
      body,
    });
  } catch (e) {
    console.error("[sponsoredGameWebhook] network error calling Platform:", e);
    return { ok: false, error: "Network error reaching Platform" };
  }

  if (!res.ok) {
    let responseBody: Record<string, unknown> = {};
    try { responseBody = await res.json(); } catch { /* ignore */ }
    console.error("[sponsoredGameWebhook] Platform returned", res.status, responseBody);
    return { ok: false, error: `Platform responded ${res.status}` };
  }

  return { ok: true };
}
