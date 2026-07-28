/**
 * POST /api/admin/weekly-challenge/assign-sponsor (admin-dashboard)
 *
 * Assigns one merchant's weekly_leaderboard_challenge allocation as the
 * sponsor of a given week window — the bridge between merchant self-service
 * allocations (voucher_program_channel_allocations, written by
 * Akiba-Platform/packages/dashboard-merchant) and react-app's settlement
 * engine (game_weekly_campaigns.program_id, see
 * packages/react-app/sql/leaderboard_voucher_prizes_channel_bridge.sql).
 * One sponsor per week — all 3 leaderboard ranks win the same voucher.
 * Deactivates any prior active campaign overlapping the same window so
 * settlement's `.maybeSingle()` lookup never sees two active rows.
 *
 * Body:
 *   program_id  string  - UUID of the voucher program with a
 *                         weekly_leaderboard_challenge allocation
 *   week_from   string  - 'YYYY-MM-DD', inclusive Monday
 *   week_to     string  - 'YYYY-MM-DD', exclusive next Monday
 *   game_types  string[] - e.g. ["rule_tap","memory_flip"]
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

const CHANNEL = "weekly_leaderboard_challenge";
const VALID_GAME_TYPES = ["rule_tap", "memory_flip"];

export async function POST(req: NextRequest) {
  const session = await requireAdminSession("ops.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const programId = typeof body.program_id === "string" ? body.program_id.trim() : null;
  const weekFrom   = typeof body.week_from  === "string" ? body.week_from.trim() : null;
  const weekTo     = typeof body.week_to    === "string" ? body.week_to.trim() : null;
  const gameTypes  = Array.isArray(body.game_types)
    ? body.game_types.filter((g): g is string => typeof g === "string" && VALID_GAME_TYPES.includes(g))
    : [];

  if (!programId || !weekFrom || !weekTo || gameTypes.length === 0) {
    return NextResponse.json({ error: "Missing program_id, week_from, week_to, or game_types" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(weekTo)) {
    return NextResponse.json({ error: "week_from/week_to must be YYYY-MM-DD" }, { status: 400 });
  }
  if (weekFrom >= weekTo) {
    return NextResponse.json({ error: "week_from must be before week_to" }, { status: 400 });
  }

  // Verify the program has remaining weekly_leaderboard_challenge capacity.
  const { data: inventory, error: invError } = await supabase
    .from("v_program_inventory")
    .select("channel_active, channel_remaining, channel_cap")
    .eq("program_id", programId)
    .eq("channel", CHANNEL)
    .maybeSingle();

  if (invError) {
    console.error("[admin/weekly-challenge/assign-sponsor] inventory lookup error", invError);
    return NextResponse.json({ error: "Failed to verify program allocation" }, { status: 500 });
  }
  if (!inventory) {
    return NextResponse.json({ error: "Program has no weekly_leaderboard_challenge allocation" }, { status: 404 });
  }
  if (!inventory.channel_active) {
    return NextResponse.json({ error: "Channel allocation is inactive" }, { status: 409 });
  }
  if (inventory.channel_cap !== null && (inventory.channel_remaining ?? 0) <= 0) {
    return NextResponse.json({ error: "No remaining capacity in this channel allocation" }, { status: 409 });
  }

  // Deactivate any active campaign whose window overlaps this one.
  const { error: deactivateError } = await supabase
    .from("game_weekly_campaigns")
    .update({ active: false })
    .eq("active", true)
    .lt("week_from", weekTo)
    .gt("week_to", weekFrom);

  if (deactivateError) {
    console.error("[admin/weekly-challenge/assign-sponsor] deactivate error", deactivateError);
    return NextResponse.json({ error: "Failed to clear overlapping campaigns" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("game_weekly_campaigns")
    .insert({
      program_id: programId,
      week_from:  weekFrom,
      week_to:    weekTo,
      game_types: gameTypes,
      active:     true,
      tiers:      [],
    })
    .select("id")
    .single();

  if (error) {
    console.error("[admin/weekly-challenge/assign-sponsor]", error);
    return NextResponse.json({ error: "Failed to assign sponsor" }, { status: 500 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action:      "weekly_challenge.sponsor_assigned",
    targetType:  "game_weekly_campaign",
    targetId:    data.id,
    metadata:    { program_id: programId, week_from: weekFrom, week_to: weekTo, game_types: gameTypes },
  });

  return NextResponse.json({ id: data.id, program_id: programId, week_from: weekFrom, week_to: weekTo }, { status: 201 });
}
