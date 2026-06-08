/**
 * GET /api/games/farkle/active?address=0x...
 *
 * Returns the player's current in-progress match (if any) so the client can
 * reconnect after a refresh / disconnect. Also expires the player's stale
 * matchmaking-queue entries.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { expireWaitingQueue, getActiveFarkleMatchForPlayer } from "@/server/farkle/session";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address")?.toLowerCase();
  if (!address) return NextResponse.json({ error: "missing address" }, { status: 400 });

  await expireWaitingQueue(supabase);
  const match = await getActiveFarkleMatchForPlayer(supabase, address);
  if (!match) return NextResponse.json({ active: null }, { headers: { "Cache-Control": "no-store" } });

  return NextResponse.json({
    active: {
      matchId: match.matchId,
      modeKey: match.modeKey,
      status:  match.status,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
