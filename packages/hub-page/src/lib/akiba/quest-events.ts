/**
 * Server-only adapter — reports quest actions to Akiba-Platform via the
 * HMAC-signed partner webhook (POST /api/v1/webhooks/partners/{slug}).
 *
 * Used for Akiba's own onboarding/habit quests:
 *   pass_signup, first_purchase, purchase_completed, first_voucher_redeemed
 *
 * Fire-and-forget by design: never throws into the caller. A failed emit is
 * logged and skipped — quests are incentives, not critical path. One-time
 * quests dedupe on Platform via the (quest, identity, scope) unique index,
 * so repeat emits for the same user are safe.
 *
 * Required env (see .env.local.example):
 *   AKIBA_API_URL         — Platform API base URL
 *   AKIBA_PARTNER_SLUG    — partner slug for the webhook path
 *   AKIBA_PARTNER_KEY_ID  — API key UUID (X-Akiba-Partner-Key header)
 *   AKIBA_WEBHOOK_SECRET  — HMAC secret registered on that API key
 *   AKIBA_QUEST_MAP       — JSON: { [actionName]: { questId, ruleId } }
 *                           (printed by Akiba-Platform/scripts/setup-hub-quests.mjs)
 */
import { createHmac } from "crypto";

export type QuestActionName =
  | "pass_signup"
  | "first_purchase"
  | "purchase_completed"
  | "first_voucher_redeemed";

type QuestMapEntry = { questId: string; ruleId: string };

export type EmitQuestActionParams = {
  actionName: QuestActionName;
  /** Hub user UUID */
  userId: string;
  /** Primary linked wallet, when known */
  walletAddress?: string | null;
  /** Stable key so Platform can dedupe retries (e.g. `quest-pass_signup-<userId>`) */
  idempotencyKey: string;
  /** Extra context stored with the verification (email, orderId, …) */
  metadata?: Record<string, unknown>;
};

function loadQuestMap(): Record<string, QuestMapEntry> | null {
  const raw = process.env.AKIBA_QUEST_MAP;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, QuestMapEntry>;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    console.error("[quest-events] AKIBA_QUEST_MAP is not valid JSON — quest emits disabled");
    return null;
  }
}

export async function emitQuestAction(params: EmitQuestActionParams): Promise<void> {
  const API_URL = process.env.AKIBA_API_URL ?? "";
  const SLUG = process.env.AKIBA_PARTNER_SLUG ?? "";
  const KEY_ID = process.env.AKIBA_PARTNER_KEY_ID ?? "";
  const SECRET = process.env.AKIBA_WEBHOOK_SECRET ?? "";

  if (!API_URL || !SLUG || !KEY_ID || !SECRET) {
    // Not configured — silently skip so environments without quests still work.
    return;
  }

  const questMap = loadQuestMap();
  const entry = questMap?.[params.actionName];
  if (!entry?.questId || !entry?.ruleId) {
    // No quest configured for this action — nothing to report.
    return;
  }

  const body = JSON.stringify({
    questId: entry.questId,
    questVerificationRuleId: entry.ruleId,
    proof: {
      actionName: params.actionName,
      completedAt: new Date().toISOString(),
    },
    userId: params.userId,
    ...(params.walletAddress ? { walletAddress: params.walletAddress.toLowerCase() } : {}),
    metadata: { sourceApp: "hub", ...(params.metadata ?? {}) },
  });

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");

  try {
    const res = await fetch(`${API_URL}/api/v1/webhooks/partners/${SLUG}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Akiba-Partner-Key": KEY_ID,
        "X-Akiba-Signature": signature,
        "X-Akiba-Timestamp": timestamp,
        "X-Akiba-Idempotency-Key": params.idempotencyKey,
      },
      body,
    });

    if (!res.ok) {
      let detail = "";
      try {
        const json = (await res.json()) as { error?: { code?: string; message?: string } };
        detail = json.error?.code ?? "";
      } catch {
        /* ignore */
      }
      // 422 CAMPAIGN_NOT_LIVE is expected while quests are still drafts.
      if (res.status !== 422) {
        console.error(`[quest-events] emit '${params.actionName}' failed: ${res.status} ${detail}`);
      }
    }
  } catch (e) {
    console.error(`[quest-events] emit '${params.actionName}' network error:`, e);
  }
}

/** Emit several actions in parallel; never throws. */
export async function emitQuestActions(list: EmitQuestActionParams[]): Promise<void> {
  await Promise.allSettled(list.map(emitQuestAction));
}
