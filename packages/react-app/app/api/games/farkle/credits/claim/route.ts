/**
 * POST /api/games/farkle/credits/claim
 * Body: { txHash: string }
 *
 * The user withdraws USDT winnings on-chain via
 * GameCreditVault.claimRewardCredits() (emits RewardCreditsClaimed). The on-chain
 * rewardCreditBalance is the source of truth; this route just reconciles the
 * off-chain display mirror (farkle_credit_balances.reward_credits_cents) to the
 * post-claim on-chain balance and writes a ledger row.
 * Wallet identity comes from requireSession() — never from the request body.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, decodeEventLog, http, parseAbiItem } from "viem";
import { celo } from "viem/chains";
import { GAME_CREDIT_VAULT_ADDRESS, gameCreditVaultAbi } from "@/lib/farkle/contracts";
import { requireSession } from "@/lib/auth";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const VAULT = (GAME_CREDIT_VAULT_ADDRESS ?? "").toLowerCase();
const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

const CLAIMED_EVENT = parseAbiItem("event RewardCreditsClaimed(address indexed user, uint256 amount)");

function makeDebugId(input: unknown) {
  return typeof input === "string" && input.trim()
    ? input.trim().slice(0, 80)
    : `claim-sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isTxHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function dbErrorText(error: any) {
  return error?.message ?? error?.details ?? error?.hint ?? String(error ?? "unknown db error");
}

function errorJson(
  message: string,
  status: number,
  debugId: string,
  code: string,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json({ error: message, code, debugId, ...extra }, { status });
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const address = session.walletAddress.toLowerCase();
  const body    = await req.json().catch(() => null);
  const txHash  = body?.txHash;
  const debugId = makeDebugId(body?.debugId);
  if (!isTxHash(txHash)) return errorJson("missing or invalid txHash", 400, debugId, "invalid_tx_hash");
  if (!VAULT) return errorJson("credit vault not configured", 500, debugId, "vault_not_configured");

  console.log(
    `[farkle/credits/claim] start debugId=${debugId}` +
      ` wallet=${address} txHash=${txHash} vault=${VAULT}`,
  );

  // Idempotency
  const { data: existingTx, error: existingTxError } = await supabase
    .from("game_credit_ledger")
    .select("balance_after")
    .eq("tx_hash", txHash)
    .eq("ledger_type", "REWARD_CREDIT_CLAIMED")
    .maybeSingle();
  if (existingTxError) {
    console.warn(
      `[farkle/credits/claim] ledger idempotency read failed debugId=${debugId}` +
        ` wallet=${address} txHash=${txHash}: ${dbErrorText(existingTxError)}`,
    );
    return errorJson("failed to check claim sync state", 500, debugId, "ledger_read_failed");
  }
  if (existingTx) {
    console.log(`[farkle/credits/claim] duplicate debugId=${debugId} wallet=${address} txHash=${txHash}`);
    return NextResponse.json({ ok: true, duplicate: true, debugId });
  }

  // Verify the on-chain claim event for this user
  const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch (err: any) {
    console.warn(
      `[farkle/credits/claim] receipt read failed debugId=${debugId}` +
        ` wallet=${address} txHash=${txHash}: ${err?.shortMessage ?? err?.message ?? err}`,
    );
    return errorJson("failed to read claim transaction receipt", 502, debugId, "receipt_read_failed", {
      retryable: true,
    });
  }
  if (!receipt) {
    return errorJson("Transaction is still confirming.", 425, debugId, "receipt_pending", { retryable: true });
  }
  if (receipt.status !== "success") {
    console.warn(
      `[farkle/credits/claim] receipt not successful debugId=${debugId}` +
        ` wallet=${address} txHash=${txHash} status=${receipt.status}`,
    );
    return errorJson("Transaction not confirmed or failed", 402, debugId, "tx_failed");
  }

  let claimedBaseUnits = 0n;
  let vaultLogCount = 0;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== VAULT) continue;
    vaultLogCount += 1;
    try {
      const decoded = decodeEventLog({
        abi: [CLAIMED_EVENT], data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      }) as any;
      if (decoded.eventName !== "RewardCreditsClaimed") continue;
      if (String(decoded.args.user).toLowerCase() !== address) continue;
      claimedBaseUnits = decoded.args.amount as bigint;
      break;
    } catch { /* unrelated log */ }
  }
  if (claimedBaseUnits === 0n) {
    console.warn(
      `[farkle/credits/claim] claim event not found debugId=${debugId}` +
        ` wallet=${address} txHash=${txHash} vaultLogCount=${vaultLogCount}` +
        ` receiptLogs=${receipt.logs.length}`,
    );
    return errorJson("RewardCreditsClaimed event not found for this user", 402, debugId, "claim_event_not_found", {
      vaultLogCount,
      logCount: receipt.logs.length,
    });
  }

  // Reconcile the mirror to the *post-claim* on-chain balance (handles any drift)
  let remainingCents = 0;
  try {
    const remaining = (await publicClient.readContract({
      address: VAULT as `0x${string}`, abi: gameCreditVaultAbi,
      functionName: "rewardCreditBalance", args: [address as `0x${string}`],
    })) as bigint;
    remainingCents = Math.round(Number(remaining) / 1e4); // 6-dp USDT base units → cents
  } catch (err: any) {
    console.warn(
      `[farkle/credits/claim] remaining balance read failed debugId=${debugId}` +
        ` wallet=${address} txHash=${txHash}: ${err?.shortMessage ?? err?.message ?? err}`,
    );
    /* fall back to 0 below because the claim event already proved withdrawal */
  }

  const { error: balanceWriteError } = await supabase.from("farkle_credit_balances").upsert(
    { wallet_address: address, reward_credits_cents: remainingCents, updated_at: new Date().toISOString() },
    { onConflict: "wallet_address" },
  );
  if (balanceWriteError) {
    console.warn(
      `[farkle/credits/claim] balance mirror write failed debugId=${debugId}` +
        ` wallet=${address} txHash=${txHash}: ${dbErrorText(balanceWriteError)}`,
    );
    return errorJson("claim succeeded on-chain but balance sync failed", 500, debugId, "balance_sync_failed", {
      retryable: true,
    });
  }

  const claimedCents = Math.round(Number(claimedBaseUnits) / 1e4);
  const { error: ledgerWriteError } = await supabase.from("game_credit_ledger").insert({
    wallet_address: address,
    amount:         -claimedCents, // cents withdrawn
    balance_after:  remainingCents,
    currency:       "REWARD_CREDIT",
    ledger_type:    "REWARD_CREDIT_CLAIMED",
    tx_hash:        txHash,
    metadata:       { usdt_base_units: claimedBaseUnits.toString(), debug_id: debugId },
  });
  if (ledgerWriteError) {
    if (ledgerWriteError.code === "23505") {
      console.warn(
        `[farkle/credits/claim] duplicate ledger race debugId=${debugId}` +
          ` wallet=${address} txHash=${txHash}`,
      );
      return NextResponse.json({ ok: true, duplicate: true, debugId, claimedCents, remainingCents });
    }
    console.warn(
      `[farkle/credits/claim] ledger write failed debugId=${debugId}` +
        ` wallet=${address} txHash=${txHash}: ${dbErrorText(ledgerWriteError)}`,
    );
    return errorJson("claim succeeded on-chain but ledger sync failed", 500, debugId, "ledger_sync_failed", {
      retryable: true,
    });
  }

  console.log(
    `[farkle/credits/claim] synced debugId=${debugId} wallet=${address} txHash=${txHash}` +
      ` claimedCents=${claimedCents} remainingCents=${remainingCents}`,
  );
  return NextResponse.json({ ok: true, debugId, claimedCents, remainingCents });
}
