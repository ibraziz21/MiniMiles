/**
 * POST /api/vouchers/raffle
 *
 * Issues a voucher after server-side verification of an authoritative raffle win.
 * Contract, chain_id, and program binding are loaded from voucher_program_channel_sources.
 * Winner records are populated by the trusted indexer path:
 *   admin-dashboard POST /api/admin/raffle/winners
 *
 * source_ref: raffle:<chainId>:<contractAddress>:<roundId>:<winnerAddress>
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueVoucherFromProgram } from "@/lib/vouchers/programs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const programId = typeof body?.program_id === "string" ? body.program_id.trim() : null;
  const roundId   = typeof body?.round_id   === "string" ? body.round_id.trim()   : null;

  if (!programId || !roundId) {
    return NextResponse.json({ error: "Missing program_id or round_id" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Load trusted source config for this program+channel
  const { data: sourceConfig } = await admin
    .from("voucher_program_channel_sources")
    .select("chain_id, contract_address, campaign_id, active")
    .eq("program_id", programId)
    .eq("channel", "raffle")
    .maybeSingle();

  if (!sourceConfig || !sourceConfig.active) {
    return NextResponse.json({ error: "No active raffle source configured for this program" }, { status: 400 });
  }

  const chainId  = sourceConfig.chain_id    as number | null;
  const contract = sourceConfig.contract_address as string | null;
  const campaign = sourceConfig.campaign_id as string | null;

  // Load user wallets
  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id);
  const allAddresses = (walletRows ?? []).map((r: { address: string }) => r.address.toLowerCase());

  if (allAddresses.length === 0) {
    return NextResponse.json({ error: "No linked wallet — connect a wallet to claim wins" }, { status: 400 });
  }

  // Look up confirmed winner in raffle_winners (populated by trusted indexer)
  const { data: winnerRow } = await admin
    .from("raffle_winners")
    .select("winner, finalized, program_id, contract, chain_id")
    .eq("round_id", roundId)
    .maybeSingle();

  if (!winnerRow) {
    return NextResponse.json({ error: "Raffle winner not yet announced for this round" }, { status: 409 });
  }
  if (!winnerRow.finalized) {
    return NextResponse.json({ error: "Raffle result not yet finalized" }, { status: 409 });
  }
  if (winnerRow.program_id && winnerRow.program_id !== programId) {
    return NextResponse.json({ error: "Program mismatch for this raffle round" }, { status: 400 });
  }

  // Verify contract matches source config (if both are set)
  if (contract && winnerRow.contract && winnerRow.contract.toLowerCase() !== contract.toLowerCase()) {
    return NextResponse.json({ error: "Contract mismatch for raffle round" }, { status: 400 });
  }

  const winnerAddress = winnerRow.winner.toLowerCase();
  if (!allAddresses.includes(winnerAddress)) {
    return NextResponse.json({ error: "This raffle round was won by a different wallet" }, { status: 403 });
  }

  // Build canonical source_ref from trusted config
  const sourceIdentifier = contract?.toLowerCase() ?? campaign ?? "unknown";
  const chainIdentifier  = chainId ?? winnerRow.chain_id ?? 0;
  const sourceRef = `raffle:${chainIdentifier}:${sourceIdentifier}:${roundId}:${winnerAddress}`;

  const result = await issueVoucherFromProgram({
    programId,
    channel:          "raffle",
    sourceRef,
    recipientAddress: winnerAddress,
    hubUserId:        user.id,
    evidence: {
      round_id:   roundId,
      chain_id:   chainIdentifier,
      contract:   sourceIdentifier,
      winner:     winnerAddress,
      campaign:   campaign ?? null,
    },
    actorId: user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus ?? 500 });
  }
  return NextResponse.json({ voucher_id: result.voucherId, code: result.code }, { status: 201 });
}
