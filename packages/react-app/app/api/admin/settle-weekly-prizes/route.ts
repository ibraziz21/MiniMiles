/**
 * POST /api/admin/settle-weekly-prizes?secret=<ADMIN_QUEUE_SECRET>
 *   Optional query params:
 *     week=YYYY-Www   (defaults to the most recently CLOSED ISO week)
 *     dry_run=1       (compute winners + campaign match, issue nothing)
 *
 * Replaces the manual USDT payout: issues merchant vouchers to the weekly
 * top-3 per game via issue_leaderboard_prize() (idempotent on
 * source_ref = '{game}:{week}:{rank}' — safe to re-run).
 *
 * See docs/skill-games-voucher-prizes-spec.md §3.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isoWeek, weekRange, lastClosedWeek, WEEK_RE } from "@/lib/games/week";
import { computeWeeklyStandings } from "@/lib/games/weeklyStandings";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const ADMIN_SECRET = process.env.ADMIN_QUEUE_SECRET ?? "";

function isAuthorized(req: Request): boolean {
  if (!ADMIN_SECRET) return false;
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${ADMIN_SECRET}`) return true;
  return new URL(req.url).searchParams.get("secret") === ADMIN_SECRET;
}

function generateVoucherCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars — no I/O/1/0, no modulo bias
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let code = "";
  for (let i = 0; i < 10; i++) code += chars[bytes[i] % chars.length];
  return code;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const week = searchParams.get("week") ?? lastClosedWeek();
  const dryRun = searchParams.get("dry_run") === "1";

  if (!WEEK_RE.test(week)) {
    return NextResponse.json({ error: "invalid week format, use YYYY-Www" }, { status: 400 });
  }
  if (week === isoWeek()) {
    return NextResponse.json({ error: "refusing to settle the still-open week" }, { status: 409 });
  }

  const range = weekRange(week);

  // ── Active campaign covering that week ──────────────────────────────────────
  const weekMonday = range.from.slice(0, 10); // YYYY-MM-DD
  const { data: campaign, error: cErr } = await supabase
    .from("game_weekly_campaigns")
    .select("id, merchant_id, game_types, tiers")
    .eq("active", true)
    .lte("week_from", weekMonday)
    .gt("week_to", weekMonday)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json({ error: `campaign lookup failed: ${cErr.message}` }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ error: `no active campaign covering week ${week}` }, { status: 404 });
  }

  const results: Record<string, unknown[]> = {};

  for (const gameType of campaign.game_types as string[]) {
    let winners;
    try {
      winners = await computeWeeklyStandings(gameType, range.from, range.to, 3);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }

    const settled: unknown[] = [];

    for (let i = 0; i < winners.length; i++) {
      const rank = i + 1;
      const winner = winners[i];
      const addr = winner.walletAddress.toLowerCase();

      if (dryRun) {
        settled.push({ rank, walletAddress: addr, score: winner.score, dryRun: true });
        continue;
      }

      const code = generateVoucherCode();
      const tier = (campaign.tiers as Array<Record<string, unknown>>)
        .find((t) => Number(t.rank) === rank);
      const qrPayload = JSON.stringify({
        code,
        merchant_id: campaign.merchant_id,
        voucher_template_id: tier?.template_id ?? null,
        user: addr,
        linked_product_id: null,
      });

      const { data, error } = await supabase.rpc("issue_leaderboard_prize", {
        p_campaign_id:  campaign.id,
        p_game_type:    gameType,
        p_week:         week,
        p_rank:         rank,
        p_user_address: addr,
        p_score:        winner.score,
        p_code:         code,
        p_qr_payload:   qrPayload,
      });

      if (error) {
        console.error(`[settle-weekly-prizes] ${gameType} rank ${rank}`, error.message);
        settled.push({ rank, walletAddress: addr, score: winner.score, error: error.message });
        continue;
      }

      const row = Array.isArray(data) ? data[0] : data;
      settled.push({
        rank,
        walletAddress: addr,
        score: winner.score,
        voucherId: row?.voucher_id ?? null,
        alreadyIssued: row?.already_issued ?? false,
      });
    }

    results[gameType] = settled;
  }

  return NextResponse.json({ week, range, campaignId: campaign.id, dryRun, results });
}
