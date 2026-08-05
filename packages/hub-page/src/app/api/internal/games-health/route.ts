// GET /api/internal/games-health — walletless-pass-skill-games-spec.md §16.
//
// Aggregate-only observability for Pass skill games: reservation/play-cap
// activity, accepted/rejected/zero-reward results, reward delivery status
// (including stuck-processing detection), a data-integrity check for
// finalized sessions that should have a delivery but don't, and the current
// rollout gate. Same auth convention as the other /api/internal/* health
// routes (x-webhook-secret / INTERNAL_WEBHOOK_SECRET) — never identities,
// scores, or wallet addresses, only counts.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGamesRolloutSummary } from "@/lib/games/gamesRollout";

const GAME_TYPES = ["rule_tap", "memory_flip"] as const;
const STUCK_PROCESSING_MINUTES = 30;
const MAX_DAILY_REWARD_PER_MEMBER = 5 * 12 + 5 * 12; // §4.1 — 120 Miles/day exposure ceiling

function isAuthorized(request: Request): boolean {
  const secret = process.env.INTERNAL_WEBHOOK_SECRET ?? "";
  return !!secret && request.headers.get("x-webhook-secret") === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestedHours = Number(new URL(request.url).searchParams.get("hours") ?? "24");
  const hours = Number.isInteger(requestedHours) && requestedHours >= 1 && requestedHours <= 168 ? requestedHours : 24;
  const since = new Date(Date.now() - hours * 60 * 60_000).toISOString();
  const stuckCutoff = new Date(Date.now() - STUCK_PROCESSING_MINUTES * 60_000).toISOString();

  const admin = createAdminClient();
  const [reservations, sessions, deliveries] = await Promise.all([
    admin
      .from("hub_skill_game_play_reservations")
      .select("game_type, status, reserved_at")
      .gte("reserved_at", since)
      .limit(20000),
    admin
      .from("skill_game_sessions")
      .select("game_type, accepted, reward_miles, canonical_id, created_at")
      .eq("source_app", "hub-page")
      .gte("created_at", since)
      .limit(20000),
    admin
      .from("skill_game_reward_deliveries")
      .select("mode, status, points, updated_at, created_at")
      .gte("created_at", since)
      .limit(20000),
  ]);

  const error = reservations.error ?? sessions.error ?? deliveries.error;
  if (error) {
    console.error("[internal/games-health] query failed:", error.message);
    return NextResponse.json({ error: "Games health data is unavailable" }, { status: 503 });
  }

  const warnings: string[] = [];

  // Reservations by game/status — cap-denial isn't logged directly, so
  // `voided` (init-window-expired) is the closest proxy for wasted starts.
  const byGame: Record<string, { reserved: number; started: number; finalized: number; voided: number }> = {};
  for (const type of GAME_TYPES) byGame[type] = { reserved: 0, started: 0, finalized: 0, voided: 0 };
  for (const row of (reservations.data ?? []) as Array<{ game_type: string; status: string }>) {
    const bucket = byGame[row.game_type];
    if (!bucket) continue;
    if (row.status === "reserved") bucket.reserved++;
    else if (row.status === "started") bucket.started++;
    else if (row.status === "finalized") bucket.finalized++;
    else if (row.status === "voided") bucket.voided++;
  }

  // Accepted/rejected/zero-reward + per-member daily exposure.
  const sessionRows = (sessions.data ?? []) as Array<{
    game_type: string; accepted: boolean; reward_miles: number; canonical_id: string; created_at: string;
  }>;
  let accepted = 0, rejected = 0, zeroReward = 0;
  const rewardByCanonical = new Map<string, number>();
  for (const row of sessionRows) {
    if (row.accepted) {
      accepted++;
      if (row.reward_miles <= 0) zeroReward++;
      rewardByCanonical.set(row.canonical_id, (rewardByCanonical.get(row.canonical_id) ?? 0) + row.reward_miles);
    } else {
      rejected++;
    }
  }
  const maxDailyRewardIssued = Math.max(0, ...rewardByCanonical.values());
  const overExposureMembers = [...rewardByCanonical.values()].filter((v) => v > MAX_DAILY_REWARD_PER_MEMBER).length;
  if (overExposureMembers > 0) {
    warnings.push(`${overExposureMembers} member(s) exceeded the ${MAX_DAILY_REWARD_PER_MEMBER}-Mile daily exposure ceiling — investigate`);
  }

  // Delivery status + stuck detection.
  const deliveryRows = (deliveries.data ?? []) as Array<{
    mode: string; status: string; points: number; updated_at: string;
  }>;
  const ledger = { count: 0, points: 0 };
  const mint = { pending: 0, processing: 0, completed: 0, failed: 0, stuck: 0 };
  for (const row of deliveryRows) {
    if (row.mode === "offchain_ledger" && row.status === "completed") {
      ledger.count++;
      ledger.points += row.points;
    }
    if (row.mode === "onchain_mint") {
      if (row.status === "pending") mint.pending++;
      else if (row.status === "processing") mint.processing++;
      else if (row.status === "completed") mint.completed++;
      else if (row.status === "failed") mint.failed++;
      if ((row.status === "pending" || row.status === "processing") && row.updated_at < stuckCutoff) mint.stuck++;
    }
  }
  if (mint.stuck > 0) {
    warnings.push(`${mint.stuck} onchain_mint delivery(ies) stuck in pending/processing for over ${STUCK_PROCESSING_MINUTES} minutes`);
  }
  if (mint.failed > 0) {
    warnings.push(`${mint.failed} onchain_mint delivery(ies) failed in the last ${hours}h`);
  }

  // Data integrity: a finalized, accepted, positive-reward session must have
  // exactly one delivery row (§2 invariant #6/#7). Missing ones are a real bug.
  const { data: missingDeliveryRows, error: integrityError } = await admin
    .from("skill_game_sessions")
    .select("session_id, skill_game_reward_deliveries!left(id)")
    .eq("source_app", "hub-page")
    .eq("accepted", true)
    .gt("reward_miles", 0)
    .gte("created_at", since)
    .is("skill_game_reward_deliveries.id", null)
    .limit(200);
  const sessionsMissingDelivery = integrityError ? null : (missingDeliveryRows ?? []).length;
  if (integrityError) {
    console.warn("[internal/games-health] delivery-integrity check unavailable:", integrityError.message);
  } else if (sessionsMissingDelivery && sessionsMissingDelivery > 0) {
    warnings.push(`${sessionsMissingDelivery} accepted session(s) with a positive reward have no delivery row`);
  }

  return NextResponse.json(
    {
      window: { hours, since },
      byGame,
      results: { accepted, rejected, zeroReward },
      delivery: { ledger, mint },
      exposure: { maxDailyRewardIssuedToOneMember: maxDailyRewardIssued, ceiling: MAX_DAILY_REWARD_PER_MEMBER, overExposureMembers },
      integrity: { sessionsMissingDelivery },
      healthy: warnings.length === 0,
      warnings,
      rollout: getGamesRolloutSummary(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
