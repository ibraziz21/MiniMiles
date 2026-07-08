// POST /api/crackpot/attempt/start
//
// Starts a new CrackPot attempt session.
//
// Auth:   requires iron-session.  Player wallet is derived from the session;
//         any client-supplied `address` field in the body is ignored.
//
// Paid entry flow:
//   1. Require txHash in body.
//   2. Idempotency check — if this tx already has an attempt, return it.
//   3. Verify the receipt: success, correct contract, EntryRecorded event,
//      player = session wallet, version, cycleId = active chain cycle.
//   4. Insert attempt row with chain_id / entry_tx_hash / entry_log_index.

import { NextResponse } from "next/server";
import { celo } from "viem/chains";
import { crackPotComingSoonResponse, isCrackPotLive } from "@/lib/server/crackpotComingSoon";
import { requireSession } from "@/lib/auth";
import { getOrSyncActiveCycle } from "@/lib/server/crackpotCycleSync";
import { verifyCrackPotEntry } from "@/lib/server/crackpotEntryVerifier";
import {
  findAttemptByTxHash,
  countAttemptsForPlayer,
  createAttempt,
  getGuessesForAttempt,
  buildAttemptView,
  getCycleSecret,
} from "@/lib/server/crackpotAttemptHelpers";
import type { CrackPotVersion } from "@/lib/crackpotTypes";

const CELO_CHAIN_ID  = celo.id;                       // 42220
const HASH_RE        = /^0x[0-9a-fA-F]{64}$/;
type PlayVersion = Extract<CrackPotVersion, "miles" | "usdt">;

export async function POST(req: Request) {
  if (!isCrackPotLive()) return crackPotComingSoonResponse();

  // ── Auth ─────────────────────────────────────────────────────────────────
  const appSession = await requireSession();
  if (!appSession) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }
  const playerWallet = appSession.walletAddress.toLowerCase();

  // ── Parse body ────────────────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}));
  const rawVersion = typeof body.version === "string" ? body.version : "miles";
  const version: PlayVersion = rawVersion === "usdt" ? "usdt" : "miles";
  const txHash: string | null =
    typeof body.txHash === "string" && HASH_RE.test(body.txHash.trim())
      ? body.txHash.trim().toLowerCase()
      : null;

  if (!txHash) {
    return NextResponse.json(
      { error: "tx_hash_required", message: "A paid CrackPot entry transaction is required" },
      { status: 400 },
    );
  }

  // Idempotency: if this tx already created an attempt, return it.
  const existing = await findAttemptByTxHash(CELO_CHAIN_ID, txHash);
  if (existing) {
    if (existing.player_address !== playerWallet) {
      return NextResponse.json({ error: "tx_belongs_to_another_player" }, { status: 403 });
    }
    const guesses = await getGuessesForAttempt(existing.id, playerWallet);
    const cycleData = await getCycleSecret(existing.cycle_id);
    const { total, free } = await countAttemptsForPlayer(existing.cycle_id, playerWallet);
    return NextResponse.json(
      buildAttemptView(existing, guesses, cycleData?.theme ?? "bank-vault", free, total),
    );
  }

  // ── Get chain-backed active cycle ─────────────────────────────────────────
  const activeCycle = await getOrSyncActiveCycle(version as "miles" | "usdt");

  // Verify the tx.
  const verified = await verifyCrackPotEntry(txHash, playerWallet, activeCycle, CELO_CHAIN_ID, version);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 422 });
  }

  // Ensure cycle has chain fields (defensive — getOrSyncActiveCycle guarantees this).
  if (!activeCycle.contract_cycle_id) {
    return NextResponse.json({ error: "cycle_not_chain_anchored" }, { status: 500 });
  }

  const { total } = await countAttemptsForPlayer(activeCycle.id, playerWallet);
  const attempt = await createAttempt({
    cycleId:       activeCycle.id,
    playerWallet,
    attemptNumber: total + 1,
    isPaid:        true,
    chainId:       CELO_CHAIN_ID,
    txHash,
    logIndex:      verified.logIndex,
  });

  const guesses   = await getGuessesForAttempt(attempt.id, playerWallet);
  const cycleData = await getCycleSecret(attempt.cycle_id);
  const counts    = await countAttemptsForPlayer(activeCycle.id, playerWallet);
  return NextResponse.json(
    buildAttemptView(attempt, guesses, cycleData?.theme ?? "bank-vault", counts.free, counts.total),
  );
}
