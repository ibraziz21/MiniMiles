// lib/orderMilesReward.ts
import { supabase } from "@/lib/supabaseClient";
import { enqueueOrderReward } from "@/lib/minipointQueue";

const MILES_PER_ORDER = 200;
const MAX_ATTEMPTS = 5;

/**
 * Enqueues +200 AkibaMiles for a merchant order that the customer has confirmed received.
 * Reads from and writes back to merchant_transactions.
 * Idempotent — safe to retry; bails out if already queued/sent.
 */
export async function processOrderMilesReward(orderId: string): Promise<void> {
  const { data: order, error: fetchErr } = await supabase
    .from("merchant_transactions")
    .select("id, user_address, miles_reward_status, miles_reward_attempts")
    .eq("id", orderId)
    .single();

  if (fetchErr || !order) {
    throw new Error(`[orderMilesReward] Order not found: ${orderId}`);
  }

  if (order.miles_reward_status === "queued" || order.miles_reward_status === "sent") return;

  if (order.miles_reward_attempts >= MAX_ATTEMPTS) {
    throw new Error(`[orderMilesReward] Max attempts reached for order ${orderId}`);
  }

  await supabase
    .from("merchant_transactions")
    .update({ miles_reward_attempts: order.miles_reward_attempts + 1 })
    .eq("id", orderId);

  await enqueueOrderReward({
    orderId,
    userAddress: order.user_address,
    points: MILES_PER_ORDER,
  });

  await supabase
    .from("merchant_transactions")
    .update({ miles_reward_status: "queued" })
    .eq("id", orderId);
}
