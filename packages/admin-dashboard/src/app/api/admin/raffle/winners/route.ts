/**
 * POST /api/admin/raffle/winners (admin-dashboard)
 *
 * Trusted indexer path: records a finalized raffle winner.
 * Only admin sessions with ops.write permission may call this.
 * hub-page raffle route reads from raffle_winners; this is the write side.
 *
 * Body:
 *   round_id    bigint   - unique raffle round identifier
 *   winner      string   - lowercased EVM address of the winner
 *   program_id  string   - UUID of the voucher program this round belongs to
 *   contract    string?  - lowercased contract address
 *   chain_id    number?  - EVM chain ID
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const session = await requireAdminSession("ops.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const roundId   = typeof body.round_id   === "number" ? body.round_id    : null;
  const winner    = typeof body.winner     === "string" ? body.winner.trim().toLowerCase() : null;
  const programId = typeof body.program_id === "string" ? body.program_id.trim()           : null;
  const contract  = typeof body.contract   === "string" ? body.contract.toLowerCase()      : null;
  const chainId   = typeof body.chain_id   === "number" ? body.chain_id                   : null;

  if (roundId === null || !winner || !programId) {
    return NextResponse.json({ error: "Missing round_id, winner, or program_id" }, { status: 400 });
  }
  if (!/^0x[0-9a-f]{40}$/.test(winner)) {
    return NextResponse.json({ error: "Invalid winner address" }, { status: 400 });
  }

  // Verify program exists
  const { data: program } = await supabase
    .from("voucher_programs")
    .select("id, state")
    .eq("id", programId)
    .maybeSingle();

  if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("raffle_winners")
    .insert({
      round_id:   roundId,
      winner,
      program_id: programId,
      contract:   contract ?? null,
      chain_id:   chainId ?? null,
      finalized:  true,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Round already recorded", round_id: roundId }, { status: 409 });
    }
    console.error("[admin/raffle/winners]", error);
    return NextResponse.json({ error: "Failed to record winner" }, { status: 500 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action:      "raffle.winner_recorded",
    targetType:  "raffle_winner",
    targetId:    data.id,
    metadata:    { round_id: roundId, winner, program_id: programId, contract, chain_id: chainId },
  });

  return NextResponse.json({ id: data.id, round_id: roundId, winner }, { status: 201 });
}
