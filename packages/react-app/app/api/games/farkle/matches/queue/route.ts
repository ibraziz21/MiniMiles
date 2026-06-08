/**
 * GET /api/games/farkle/matches/queue?modeKey=xxx&address=0x...
 * Returns the list of players currently waiting in the matchmaking queue
 * for the given mode, excluding the requesting player.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  expireWaitingQueue,
  FARKLE_QUEUE_TTL_MS,
  getActiveFarkleMatchForPlayer,
} from "@/server/farkle/session";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const modeKey = searchParams.get("modeKey");
  const address = searchParams.get("address")?.toLowerCase();

  if (!modeKey) return NextResponse.json({ error: "missing modeKey" }, { status: 400 });

  await expireWaitingQueue(supabase);

  if (address) {
    const active = await getActiveFarkleMatchForPlayer(supabase, address);
    if (active) {
      return NextResponse.json({
        matchId: active.matchId,
        modeKey: active.modeKey,
        waiters: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }
  }

  // Check if the requesting player has already been matched
  let myMatchId: string | null = null;
  if (address) {
    const { data: myEntry } = await supabase
      .from("matchmaking_queue")
      .select("status, match_id")
      .eq("wallet_address", address)
      .eq("mode_key", modeKey)
      .maybeSingle();

    if (myEntry?.status === "matched" && myEntry.match_id) {
      const { data: match } = await supabase
        .from("game_matches")
        .select("id, status")
        .eq("id", myEntry.match_id)
        .in("status", ["created", "funded", "in_progress"])
        .maybeSingle();
      if (match) {
        myMatchId = myEntry.match_id;
      } else {
        await supabase
          .from("matchmaking_queue")
          .update({ status: "expired", match_id: null })
          .eq("wallet_address", address)
          .eq("mode_key", modeKey);
      }
    } else if (myEntry?.status === "waiting") {
      await supabase
        .from("matchmaking_queue")
        .update({ expires_at: new Date(Date.now() + FARKLE_QUEUE_TTL_MS).toISOString() })
        .eq("wallet_address", address)
        .eq("mode_key", modeKey)
        .eq("status", "waiting");
    }
  }

  const { data: queue } = await supabase
    .from("matchmaking_queue")
    .select("wallet_address, queued_at")
    .eq("mode_key", modeKey)
    .eq("status", "waiting")
    .order("queued_at", { ascending: true });

  const waiters = (queue ?? []).filter((w) => w.wallet_address !== address);

  // Fetch usernames for display
  const wallets = waiters.map((w) => w.wallet_address);
  const usernameMap: Record<string, string> = {};
  if (wallets.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("user_address, username")
      .in("user_address", wallets);
    for (const u of users ?? []) {
      if (u.username) usernameMap[u.user_address] = u.username;
    }
  }

  return NextResponse.json({
    matchId: myMatchId,   // non-null means this player was challenged and matched
    waiters: waiters.map((w) => ({
      address:  w.wallet_address,
      username: usernameMap[w.wallet_address] ?? null,
      queuedAt: w.queued_at,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const url = new URL(req.url);
  const modeKey = body?.modeKey ?? url.searchParams.get("modeKey");
  const address = (body?.address ?? url.searchParams.get("address"))?.toLowerCase();

  if (!modeKey || !address) return NextResponse.json({ error: "missing fields" }, { status: 400 });

  const { error } = await supabase
    .from("matchmaking_queue")
    .update({ status: "cancelled", match_id: null })
    .eq("wallet_address", address)
    .eq("mode_key", modeKey)
    .eq("status", "waiting");
  if (error) {
    console.error("[farkle/queue] failed to cancel queue entry", error);
    return NextResponse.json({ error: "failed to leave lobby" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
