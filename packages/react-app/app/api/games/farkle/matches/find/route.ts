/**
 * POST /api/games/farkle/matches/find
 * Body: { address: string; modeKey: string }
 *
 * Enters the matchmaking queue. If another player is already waiting,
 * pairs them immediately and creates an in_progress match.
 * Returns { status: "waiting"|"matched", matchId? }
 */
import { NextResponse } from "next/server";
import { createClient }  from "@supabase/supabase-js";
import { randomUUID }    from "crypto";
import { generateServerSeed, hashServerSeed } from "@/lib/farkle/engine";
import {
  expireWaitingQueue,
  FARKLE_QUEUE_TTL_MS,
  getActiveFarkleMatchForPlayer,
} from "@/server/farkle/session";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const MODE_TARGET: Record<string, number> = {
  FARKLE_QUICK_1500_AKIBA: 1500,
  FARKLE_REWARD_3000_USDT: 2500,
};

export async function POST(req: Request) {
  const body    = await req.json().catch(() => null);
  const address = body?.address?.toLowerCase();
  const modeKey = body?.modeKey;

  if (!address || !modeKey) return NextResponse.json({ error: "missing fields" }, { status: 400 });
  if (!MODE_TARGET[modeKey]) return NextResponse.json({ error: "invalid modeKey" }, { status: 400 });

  // Entry balance check — player must hold at least 1 ticket (Quick) or 1 credit (Reward)
  if (modeKey === "FARKLE_QUICK_1500_AKIBA") {
    const { data: ticketRow } = await supabase
      .from("farkle_ticket_balances")
      .select("balance")
      .eq("wallet_address", address)
      .maybeSingle();
    if ((ticketRow?.balance ?? 0) < 1) {
      return NextResponse.json({ error: "insufficient-tickets", message: "You need at least 1 ticket to enter." }, { status: 402 });
    }
  } else if (modeKey === "FARKLE_REWARD_3000_USDT") {
    const { data: creditRow } = await supabase
      .from("farkle_credit_balances")
      .select("purchased_credits")
      .eq("wallet_address", address)
      .maybeSingle();
    if ((creditRow?.purchased_credits ?? 0) < 1) {
      return NextResponse.json({ error: "insufficient-credits", message: "You need at least 1 game credit to enter." }, { status: 402 });
    }
  }

  await expireWaitingQueue(supabase);

  const active = await getActiveFarkleMatchForPlayer(supabase, address);
  if (active) {
    return NextResponse.json({ status: "matched", matchId: active.matchId, modeKey: active.modeKey });
  }

  // If a specific target is requested, use them; otherwise take the first waiter
  const targetAddress = body?.targetAddress?.toLowerCase() ?? null;

  const query = supabase
    .from("matchmaking_queue")
    .select("*")
    .eq("mode_key", modeKey)
    .eq("status", "waiting")
    .neq("wallet_address", address);

  const { data: waiter } = targetAddress
    ? await query.eq("wallet_address", targetAddress).maybeSingle()
    : await query.order("queued_at", { ascending: true }).limit(1).maybeSingle();

  if (waiter) {
    // ── Pair found — create match ─────────────────────────────────────────
    const matchId  = randomUUID();
    const matchKey = `farkle-${Date.now()}`;
    const seed     = generateServerSeed();
    const seedHash = hashServerSeed(seed);

    const { data: modeRow, error: modeError } = await supabase.from("game_modes")
      .select("id, game_id").eq("mode_key", modeKey).single();
    if (modeError || !modeRow) {
      console.error("[farkle/find] missing game mode", modeError);
      return NextResponse.json({ error: "game mode is not configured" }, { status: 500 });
    }

    const { data: claimedWaiter, error: claimError } = await supabase
      .from("matchmaking_queue")
      .update({
        status: "matched",
        match_id: null,
        expires_at: new Date(Date.now() + FARKLE_QUEUE_TTL_MS).toISOString(),
      })
      .eq("id", waiter.id)
      .eq("status", "waiting")
      .select("wallet_address")
      .maybeSingle();

    if (claimError) {
      console.error("[farkle/find] failed to claim waiter", claimError);
      return NextResponse.json({ error: "failed to claim opponent" }, { status: 500 });
    }
    if (!claimedWaiter) {
      await supabase.from("matchmaking_queue").upsert({
        wallet_address: address,
        mode_key:       modeKey,
        status:         "waiting",
        match_id:       null,
        queued_at:      new Date().toISOString(),
        expires_at:     new Date(Date.now() + FARKLE_QUEUE_TTL_MS).toISOString(),
      }, { onConflict: "wallet_address,mode_key" });
      return NextResponse.json({ status: "waiting" });
    }

    const { error: matchError } = await supabase.from("game_matches").insert({
      id:                   matchId,
      match_key:            matchKey,
      game_id:              modeRow?.game_id,
      mode_id:              modeRow?.id,
      status:               "in_progress",
      seed_hash:            seedHash,
      current_turn_address: claimedWaiter.wallet_address, // seat 0 goes first
      turn_number:          1,
      metadata:             { seed, modeKey },
      started_at:           new Date().toISOString(),
      turn_started_at:      new Date().toISOString(),
      last_action_at:       new Date().toISOString(),
    });
    if (matchError) {
      console.error("[farkle/find] failed to create match", matchError);
      await supabase
        .from("matchmaking_queue")
        .update({ status: "waiting", match_id: null, expires_at: new Date(Date.now() + FARKLE_QUEUE_TTL_MS).toISOString() })
        .eq("id", waiter.id)
        .eq("status", "matched")
        .is("match_id", null);
      return NextResponse.json({ error: "failed to create match" }, { status: 500 });
    }

    const { error: playersError } = await supabase.from("game_match_players").insert([
      { match_id: matchId, wallet_address: claimedWaiter.wallet_address, seat_index: 0 },
      { match_id: matchId, wallet_address: address,               seat_index: 1 },
    ]);
    if (playersError) {
      console.error("[farkle/find] failed to create match players", playersError);
      await supabase.from("game_matches").update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        metadata: { seed, modeKey, endReason: "player_insert_failed" },
      }).eq("id", matchId);
      await supabase
        .from("matchmaking_queue")
        .update({ status: "waiting", match_id: null, expires_at: new Date(Date.now() + FARKLE_QUEUE_TTL_MS).toISOString() })
        .eq("id", waiter.id)
        .eq("status", "matched")
        .is("match_id", null);
      return NextResponse.json({ error: "failed to create match players" }, { status: 500 });
    }

    await debitEntry(modeKey, claimedWaiter.wallet_address);
    await debitEntry(modeKey, address);

    await supabase.from("game_match_players")
      .update({ entry_debited: true }).eq("match_id", matchId);

    const { error: waiterAttachError } = await supabase
      .from("matchmaking_queue")
      .update({
        status: "matched",
        match_id: matchId,
        expires_at: new Date(Date.now() + FARKLE_QUEUE_TTL_MS).toISOString(),
      })
      .eq("id", waiter.id)
      .eq("status", "matched")
      .is("match_id", null);
    if (waiterAttachError) {
      console.error("[farkle/find] failed to attach waiter queue row", waiterAttachError);
    }

    await supabase.from("matchmaking_queue").upsert({
      wallet_address: address,
      mode_key:       modeKey,
      status:         "matched",
      match_id:       matchId,
      expires_at:     new Date(Date.now() + FARKLE_QUEUE_TTL_MS).toISOString(),
    }, { onConflict: "wallet_address,mode_key" });

    return NextResponse.json({ status: "matched", matchId });
  }

  // ── No opponent yet — join queue ──────────────────────────────────────────
  await supabase.from("matchmaking_queue").upsert({
    wallet_address: address,
    mode_key:       modeKey,
    status:         "waiting",
    match_id:       null,
    queued_at:      new Date().toISOString(),
    expires_at:     new Date(Date.now() + FARKLE_QUEUE_TTL_MS).toISOString(),
  }, { onConflict: "wallet_address,mode_key" });

  return NextResponse.json({ status: "waiting" });
}

async function debitEntry(modeKey: string, address: string) {
  if (modeKey === "FARKLE_QUICK_1500_AKIBA") {
    const { data } = await supabase.from("farkle_ticket_balances")
      .select("balance").eq("wallet_address", address).maybeSingle();
    const newBal = Math.max(0, (data?.balance ?? 0) - 1);
    await supabase.from("farkle_ticket_balances").upsert(
      { wallet_address: address, balance: newBal, updated_at: new Date().toISOString() },
      { onConflict: "wallet_address" }
    );
    await supabase.from("game_credit_ledger").insert({
      wallet_address: address, amount: -1, balance_after: newBal,
      currency: "AKIBA_TICKET", ledger_type: "AKIBA_TICKET_DEBITED",
    });
  } else {
    const { data } = await supabase.from("farkle_credit_balances")
      .select("purchased_credits").eq("wallet_address", address).maybeSingle();
    const newBal = Math.max(0, (data?.purchased_credits ?? 0) - 1);
    await supabase.from("farkle_credit_balances").upsert(
      { wallet_address: address, purchased_credits: newBal, updated_at: new Date().toISOString() },
      { onConflict: "wallet_address" }
    );
    await supabase.from("game_credit_ledger").insert({
      wallet_address: address, amount: -1, balance_after: newBal,
      currency: "GAME_CREDIT", ledger_type: "GAME_CREDIT_DEBITED",
    });
  }
}
