import { supabase } from "@/lib/supabaseClient";

export type MerchantQuestEventType =
  | "proof_recorded"
  | "claim_queued"
  | "retry_queued"
  | "reward_completed"
  | "reward_failed";

export async function recordMerchantQuestEvent(input: {
  eventKey: string;
  eventType: MerchantQuestEventType;
  userAddress: string;
  questId: string;
  isoWeek?: string | null;
  mintJobId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("merchant_quest_events")
      .upsert(
        {
          event_key: input.eventKey,
          event_type: input.eventType,
          user_address: input.userAddress.toLowerCase(),
          partner_quest_id: input.questId,
          iso_week: input.isoWeek ?? null,
          mint_job_id: input.mintJobId ?? null,
          metadata: input.metadata ?? {},
        },
        { onConflict: "event_key", ignoreDuplicates: true },
      );

    if (!error) return true;
    console.warn("[merchant-quests/audit] event write failed", {
      eventType: input.eventType,
      questId: input.questId,
      message: error.message,
    });
    return false;
  } catch (error) {
    console.warn("[merchant-quests/audit] event write unavailable", {
      eventType: input.eventType,
      questId: input.questId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}
