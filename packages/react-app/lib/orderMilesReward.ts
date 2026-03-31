// lib/orderMilesReward.ts
import { supabase } from "@/lib/supabaseClient";
import { safeMintMiniPoints } from "@/lib/minipoints";

const MILES_PER_ORDER = 200;
const MAX_ATTEMPTS = 5;

/**
 * Mints +200 AkibaMiles for a completed voucher order.
 * Safe to call multiple times — idempotent once status = 'sent'.
 * Throws on hard failure so the caller can decide to retry or log.
 */
export async function processOrderMilesReward(orderId: string): Promise<void> {
  const { data: order, error: fetchErr } = await supabase
    .from("voucher_orders")
    .select("id, user_address, miles_reward_status, miles_reward_attempts")
    .eq("id", orderId)
    .single();

  if (fetchErr || !order) {
    throw new Error(`[orderMilesReward] Order not found: ${orderId}`);
  }

  if (order.miles_reward_status === "sent") return; // already rewarded

  if (order.miles_reward_attempts >= MAX_ATTEMPTS) {
    throw new Error(
      `[orderMilesReward] Max attempts (${MAX_ATTEMPTS}) reached for order ${orderId}`,
    );
  }

  // Increment attempt counter before the on-chain call
  await supabase
    .from("voucher_orders")
    .update({ miles_reward_attempts: order.miles_reward_attempts + 1 })
    .eq("id", orderId);

  const txHash = await safeMintMiniPoints({
    to: order.user_address as `0x${string}`,
    points: MILES_PER_ORDER,
    reason: `order-miles:${orderId}`,
  });

  await supabase
    .from("voucher_orders")
    .update({
      miles_reward_status: "sent",
      miles_reward_tx_hash: txHash,
    })
    .eq("id", orderId);
}
