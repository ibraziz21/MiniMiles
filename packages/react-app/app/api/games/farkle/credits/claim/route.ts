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

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const address = session.walletAddress.toLowerCase();
  const body    = await req.json().catch(() => null);
  const txHash  = body?.txHash;
  if (!txHash)  return NextResponse.json({ error: "missing txHash" }, { status: 400 });
  if (!VAULT)   return NextResponse.json({ error: "credit vault not configured" }, { status: 500 });

  // Idempotency
  const { data: existingTx } = await supabase
    .from("game_credit_ledger")
    .select("balance_after")
    .eq("tx_hash", txHash)
    .eq("ledger_type", "REWARD_CREDIT_CLAIMED")
    .maybeSingle();
  if (existingTx) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Verify the on-chain claim event for this user
  const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null);
  if (!receipt) {
    return NextResponse.json({ error: "Transaction is still confirming.", retryable: true }, { status: 425 });
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "Transaction not confirmed or failed" }, { status: 402 });
  }

  let claimedBaseUnits = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== VAULT) continue;
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
    return NextResponse.json({ error: "RewardCreditsClaimed event not found for this user" }, { status: 402 });
  }

  // Reconcile the mirror to the *post-claim* on-chain balance (handles any drift)
  let remainingCents = 0;
  try {
    const remaining = (await publicClient.readContract({
      address: VAULT as `0x${string}`, abi: gameCreditVaultAbi,
      functionName: "rewardCreditBalance", args: [address as `0x${string}`],
    })) as bigint;
    remainingCents = Math.round(Number(remaining) / 1e4); // 6-dp USDT base units → cents
  } catch { /* fall back to 0 below */ }

  await supabase.from("farkle_credit_balances").upsert(
    { wallet_address: address, reward_credits_cents: remainingCents, updated_at: new Date().toISOString() },
    { onConflict: "wallet_address" },
  );

  await supabase.from("game_credit_ledger").insert({
    wallet_address: address,
    amount:         -Math.round(Number(claimedBaseUnits) / 1e4), // cents withdrawn
    balance_after:  remainingCents,
    currency:       "REWARD_CREDIT",
    ledger_type:    "REWARD_CREDIT_CLAIMED",
    tx_hash:        txHash,
    metadata:       { usdt_base_units: claimedBaseUnits.toString() },
  });

  const claimedCents = Math.round(Number(claimedBaseUnits) / 1e4);
  console.log(
    `[farkle/credits/claim] synced wallet=${address} txHash=${txHash}` +
      ` claimedCents=${claimedCents} remainingCents=${remainingCents}`,
  );
  return NextResponse.json({ ok: true, claimedCents, remainingCents });
}
