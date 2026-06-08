import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth";
import { grantFarkleRewards } from "@/server/farkle/grantRewards";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
type Ctx = { params: Promise<{ matchId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { matchId } = await params;
  const address = session.walletAddress.toLowerCase();

  const { data: match } = await supabase.from("game_matches")
    .select("status, game_modes(mode_key, winner_miles_reward, loser_miles_reward, winner_reward_credit)")
    .eq("id", matchId).single();
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["in_progress", "funded"].includes(match.status))
    return NextResponse.json({ error: "match not active" }, { status: 400 });

  const { data: players } = await supabase.from("game_match_players")
    .select("wallet_address, banked_score").eq("match_id", matchId);
  const me  = players?.find((p) => p.wallet_address === address);
  const opp = players?.find((p) => p.wallet_address !== address);
  if (!me)  return NextResponse.json({ error: "not a match player" }, { status: 403 });
  if (!opp) return NextResponse.json({ error: "opponent not found" }, { status: 400 });

  const winnerAddress = opp.wallet_address;
  const loserAddress  = address;
  const modeKey       = (match.game_modes as any)?.mode_key ?? "";
  const winMiles      = (match.game_modes as any)?.winner_miles_reward ?? 10;
  const losMiles      = (match.game_modes as any)?.loser_miles_reward  ?? 5;
  const winCredit     = (match.game_modes as any)?.winner_reward_credit ?? 0;

  const { error: matchError } = await supabase.from("game_matches").update({
    status:         "completed",
    winner_address: winnerAddress,
    loser_address:  loserAddress,
    winner_score:   opp.banked_score ?? 0,
    loser_score:    me.banked_score  ?? 0,
    completed_at:   new Date().toISOString(),
  }).eq("id", matchId);
  if (matchError) {
    console.error("[farkle/forfeit] failed to complete match", matchError);
    return NextResponse.json({ error: "failed to complete match" }, { status: 500 });
  }

  await supabase.from("game_match_players").update({ result: "win"  }).eq("match_id", matchId).eq("wallet_address", winnerAddress);
  await supabase.from("game_match_players").update({ result: "loss" }).eq("match_id", matchId).eq("wallet_address", loserAddress);

  await grantFarkleRewards({
    matchId, modeKey, winnerAddress, loserAddress,
    winnerScore: opp.banked_score ?? 0, loserScore: me.banked_score ?? 0,
    winMiles, losMiles, winCreditCents: winCredit, endReason: "forfeit",
  });

  return NextResponse.json({ ok: true, winnerId: winnerAddress });
}
