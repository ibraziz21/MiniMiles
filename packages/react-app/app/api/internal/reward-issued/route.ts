// POST /api/internal/reward-issued
//
// Inbound half of the discovery-quests reward bridge (discovery-quests-
// spec.md §5.4): Akiba-Platform's webhook-delivery worker calls this when a
// quest reward becomes 'issued', so this app can mint it on-chain through
// its own pipeline. Without this route, a mini-app user "earns" Miles they
// can never see on Platform's side alone.
//
// Real HMAC verification (see lib/akiba/verifyRewardWebhook.ts) — unlike
// this app's other inbound "webhooks" (e.g. api/internal/cancel-compensation,
// a flat x-webhook-secret === env check), this route triggers an on-chain
// mint, so a forgeable shared-secret header isn't enough.
import { NextResponse } from "next/server";
import { verifyRewardWebhookSignature } from "@/lib/akiba/verifyRewardWebhook";
import type { RewardIssuedDelivery } from "@/lib/akiba/verifyRewardWebhook";
import { enqueuePlatformReward } from "@/lib/minipointQueue";
import { CANONICAL_API_PARTNER_QUEST_IDS } from "@/lib/merchantDiscoveryQuests";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-akiba-signature");

  if (!verifyRewardWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let delivery: RewardIssuedDelivery;
  try {
    delivery = JSON.parse(rawBody) as RewardIssuedDelivery;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { data } = delivery;
  if (!data?.rewardId || !data?.questId || typeof data?.amount !== "number") {
    return NextResponse.json({ error: "Malformed reward_issued payload" }, { status: 400 });
  }

  // This app's mint pipeline only knows how to pay a wallet — an
  // email/phone-identity reward has nothing for react-app to bridge (that
  // identity never linked a mini-app wallet). Ack so Platform doesn't retry.
  if (data.identityType !== "wallet") {
    return NextResponse.json({ ok: true, skipped: "non-wallet identity" });
  }

  // These five quests are paid by the shared canonical delivery registry.
  // Acknowledge the legacy Platform webhook without minting a second reward.
  if (CANONICAL_API_PARTNER_QUEST_IDS.has(data.questId)) {
    return NextResponse.json({ ok: true, skipped: "canonical partner quest" });
  }

  try {
    await enqueuePlatformReward({
      rewardId: data.rewardId,
      questId: data.questId,
      walletAddress: data.identityValue,
      points: data.amount,
    });
  } catch (e) {
    console.error("[reward-issued] enqueuePlatformReward failed:", e);
    return NextResponse.json({ error: "Failed to enqueue reward" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
