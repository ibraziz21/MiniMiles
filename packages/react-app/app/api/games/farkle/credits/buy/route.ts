/**
 * POST /api/games/farkle/credits/buy
 * Body: { txHash: string }
 *
 * The user calls GameCreditVault.buyCredits(packId) on-chain first (pulls USDT
 * via transferFrom and emits CreditsPurchased). We verify the event was emitted
 * for this user, then credit `purchased_credits` in farkle_credit_balances —
 * the currency Reward Duel entry consumes.
 * Wallet identity comes from requireSession() — never from the request body.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, decodeEventLog, http, parseAbiItem } from "viem";
import { celo } from "viem/chains";
import { requireSession } from "@/lib/auth";
import { GAME_CREDIT_VAULT_ADDRESS } from "@/lib/farkle/contracts";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const VAULT = (GAME_CREDIT_VAULT_ADDRESS ?? "").toLowerCase();
const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

const CREDITS_PURCHASED_EVENT = parseAbiItem(
  "event CreditsPurchased(address indexed user, uint256 indexed packId, uint256 usdtAmount, uint256 creditAmount)",
);

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const address = session.walletAddress.toLowerCase();
  const body    = await req.json().catch(() => null);
  const txHash  = body?.txHash;
  if (!txHash)  return NextResponse.json({ error: "missing txHash" }, { status: 400 });
  if (!VAULT)   return NextResponse.json({ error: "credit vault not configured" }, { status: 500 });

  // ── Idempotency: this tx already synced? ──────────────────────────────────
  const { data: existingTx, error: existingTxError } = await supabase
    .from("game_credit_ledger")
    .select("balance_after")
    .eq("tx_hash", txHash)
    .eq("ledger_type", "GAME_CREDIT_PURCHASED")
    .maybeSingle();
  if (existingTxError) {
    console.error("[farkle/credits/buy] failed to check tx hash", existingTxError);
    return NextResponse.json({ error: "failed to check credit purchase" }, { status: 500 });
  }
  if (existingTx) {
    return NextResponse.json({ ok: true, duplicate: true, newBalance: existingTx.balance_after ?? null });
  }

  // ── Verify the on-chain CreditsPurchased event for this user ───────────────
  const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC) });
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null);

  if (!receipt) {
    return NextResponse.json(
      { error: "Transaction is still confirming. Retrying will not charge again.", retryable: true },
      { status: 425 },
    );
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "Transaction not confirmed or failed" }, { status: 402 });
  }

  let creditAmount = 0;
  let usdtAmount   = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== VAULT) continue;
    try {
      const decoded = decodeEventLog({
        abi: [CREDITS_PURCHASED_EVENT],
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      }) as any;
      if (decoded.eventName !== "CreditsPurchased") continue;
      if (String(decoded.args.user).toLowerCase() !== address) continue;
      creditAmount = Number(decoded.args.creditAmount);
      usdtAmount   = decoded.args.usdtAmount as bigint;
      break;
    } catch {
      // unrelated log
    }
  }

  if (!creditAmount) {
    return NextResponse.json(
      { error: "CreditsPurchased event not found for this user in the tx" },
      { status: 402 },
    );
  }

  // ── Credit the balance (preserves reward_credits_cents) ────────────────────
  const { data: existing, error: balanceReadError } = await supabase
    .from("farkle_credit_balances")
    .select("purchased_credits")
    .eq("wallet_address", address)
    .maybeSingle();
  if (balanceReadError) {
    console.error("[farkle/credits/buy] failed to read credit balance", balanceReadError);
    return NextResponse.json({ error: "failed to read credit balance" }, { status: 500 });
  }

  const newBalance = (existing?.purchased_credits ?? 0) + creditAmount;

  const { error: balanceWriteError } = await supabase.from("farkle_credit_balances").upsert(
    { wallet_address: address, purchased_credits: newBalance, updated_at: new Date().toISOString() },
    { onConflict: "wallet_address" },
  );
  if (balanceWriteError) {
    console.error("[farkle/credits/buy] failed to update credit balance", balanceWriteError);
    return NextResponse.json({ error: "failed to update credit balance" }, { status: 500 });
  }

  // ── Ledger entry ──────────────────────────────────────────────────────────
  const { error: ledgerError } = await supabase.from("game_credit_ledger").insert({
    wallet_address: address,
    amount:         creditAmount,
    balance_after:  newBalance,
    currency:       "GAME_CREDIT",
    ledger_type:    "GAME_CREDIT_PURCHASED",
    tx_hash:        txHash,
    metadata:       { usdt_base_units: usdtAmount.toString() },
  });
  if (ledgerError) {
    console.error("[farkle/credits/buy] failed to write ledger", ledgerError);
    return NextResponse.json(
      { error: ledgerError.code === "23505" ? "credit purchase already synced" : "failed to write credit ledger" },
      { status: ledgerError.code === "23505" ? 409 : 500 },
    );
  }

  console.log(
    `[farkle/credits/buy] synced wallet=${address} txHash=${txHash}` +
      ` creditsAdded=${creditAmount} newBalance=${newBalance}`,
  );
  return NextResponse.json({ ok: true, newBalance, creditsAdded: creditAmount });
}
