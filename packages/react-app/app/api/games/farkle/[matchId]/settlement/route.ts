import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth";
import { grantFarkleRewards } from "@/server/farkle/grantRewards";
import { readFarkleRewardCreditCents } from "@/server/farkle/settleOnChain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

type Ctx = { params: Promise<{ matchId: string }> };
type HexAddress = `0x${string}`;

function isHexAddress(value: string | null | undefined): value is HexAddress {
  return !!value && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function modeOf(match: any) {
  const relation = match?.game_modes;
  return Array.isArray(relation) ? relation[0] : relation;
}

async function handle(_req: Request, { params }: Ctx, retry: boolean) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { matchId } = await params;
  const address = session.walletAddress.toLowerCase();

  const [{ data: match, error: matchError }, { data: players, error: playersError }] = await Promise.all([
    supabase
      .from("game_matches")
      .select(
        "id,status,chain_id,winner_address,loser_address,winner_score,loser_score,settled_at,completed_at," +
          "game_modes(mode_key,winner_miles_reward,loser_miles_reward,winner_reward_credit)",
      )
      .eq("id", matchId)
      .maybeSingle(),
    supabase
      .from("game_match_players")
      .select("wallet_address,banked_score,result")
      .eq("match_id", matchId),
  ]);

  if (matchError) {
    console.error(`[farkle/settlement-status] match read failed matchId=${matchId}`, matchError);
    return NextResponse.json({ error: "failed to read match" }, { status: 500 });
  }
  if (playersError) {
    console.error(`[farkle/settlement-status] players read failed matchId=${matchId}`, playersError);
    return NextResponse.json({ error: "failed to read match players" }, { status: 500 });
  }
  if (!match) return NextResponse.json({ error: "match not found" }, { status: 404 });

  const matchRow = match as any;
  const playerRows = (players ?? []) as any[];
  const me = playerRows.find((player) => player.wallet_address === address);
  const opponent = playerRows.find((player) => player.wallet_address !== address);
  if (!me) return NextResponse.json({ error: "not a match player" }, { status: 403 });

  const mode = modeOf(matchRow);
  const winnerAddress = String(matchRow.winner_address ?? "").toLowerCase();
  const loserAddress = String(matchRow.loser_address ?? "").toLowerCase();
  const isWinner = winnerAddress === address;
  const yourScore = isWinner ? matchRow.winner_score ?? me.banked_score ?? 0 : matchRow.loser_score ?? me.banked_score ?? 0;
  const oppScore = isWinner ? matchRow.loser_score ?? opponent?.banked_score ?? 0 : matchRow.winner_score ?? opponent?.banked_score ?? 0;
  const isCompleted = matchRow.status === "completed" || matchRow.status === "settled";

  let retryError: string | null = null;
  let retryAttempted = false;

  if (retry && isCompleted && !matchRow.settled_at && isHexAddress(winnerAddress) && isHexAddress(loserAddress)) {
    retryAttempted = true;
    try {
      await grantFarkleRewards({
        matchId,
        modeKey: mode?.mode_key ?? "",
        winnerAddress,
        loserAddress,
        winnerScore: matchRow.winner_score ?? 0,
        loserScore: matchRow.loser_score ?? 0,
        winMiles: mode?.winner_miles_reward ?? 10,
        losMiles: mode?.loser_miles_reward ?? 5,
        winCreditCents: mode?.winner_reward_credit ?? 0,
        endReason: "score",
      });
    } catch (err: any) {
      retryError = err?.message ?? "settlement retry failed";
      console.error(`[farkle/settlement-status] retry failed matchId=${matchId}: ${retryError}`);
    }
  }

  const { data: refreshed } = await supabase
    .from("game_matches")
    .select("settled_at,status")
    .eq("id", matchId)
    .maybeSingle();

  let rewardCreditsCents: number | null = null;
  if (mode?.mode_key === "FARKLE_REWARD_3000_USDT" && isWinner && isHexAddress(address)) {
    try {
      rewardCreditsCents = await readFarkleRewardCreditCents(address, matchRow.chain_id ?? undefined);
    } catch (err: any) {
      console.error(
        `[farkle/settlement-status] reward credit read failed matchId=${matchId} wallet=${address}:`,
        err?.message ?? err,
      );
    }
  }

  const refreshedRow = refreshed as any;
  const settled = Boolean(refreshedRow?.settled_at ?? matchRow.settled_at) || (rewardCreditsCents ?? 0) > 0;

  return NextResponse.json({
    ok: true,
    matchId,
    matchStatus: refreshedRow?.status ?? matchRow.status,
    settlementStatus: settled ? "settled" : isCompleted ? "pending" : "in_progress",
    retryAttempted,
    retryError,
    modeKey: mode?.mode_key ?? null,
    winnerId: winnerAddress || null,
    isWinner,
    yourScore,
    oppScore,
    rewardCreditsCents,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request, ctx: Ctx) {
  return handle(req, ctx, false);
}

export async function POST(req: Request, ctx: Ctx) {
  return handle(req, ctx, true);
}
