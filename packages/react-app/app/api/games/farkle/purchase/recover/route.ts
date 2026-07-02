/**
 * POST /api/games/farkle/purchase/recover
 * Body: { txHash: string, purchaseType: "ticket" | "credit" | "claim" }
 *
 * Recovery path for purchase syncs that failed after the on-chain tx confirmed.
 * Verifies the relevant on-chain event for the session wallet, then credits the
 * local balance if not already credited. Fully idempotent — safe to call multiple
 * times with the same txHash.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, decodeEventLog, http, parseAbiItem } from "viem";
import { celo } from "viem/chains";
import { GAME_CREDIT_VAULT_ADDRESS, gameCreditVaultAbi } from "@/lib/farkle/contracts";
import { requireSession } from "@/lib/auth";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const VAULT = (GAME_CREDIT_VAULT_ADDRESS ?? "").toLowerCase();
const TICKET = (process.env.NEXT_PUBLIC_FARKLE_TICKET_ADDRESS ?? "").toLowerCase();
const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

const TICKETS_PURCHASED_EVENT = parseAbiItem(
  "event TicketsPurchased(address indexed user, uint256 ticketAmount, uint256 milesBurned)",
);
const CREDITS_PURCHASED_EVENT = parseAbiItem(
  "event CreditsPurchased(address indexed user, uint256 indexed packId, uint256 usdtAmount, uint256 creditAmount)",
);
const CLAIMED_EVENT = parseAbiItem("event RewardCreditsClaimed(address indexed user, uint256 amount)");

const PURCHASE_TYPES = ["ticket", "credit", "claim"] as const;
type PurchaseType = (typeof PURCHASE_TYPES)[number];

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const address = session.walletAddress.toLowerCase();
  const body = await req.json().catch(() => null);
  const txHash: string | undefined = body?.txHash;
  const purchaseType: PurchaseType | undefined = body?.purchaseType;

  if (!txHash) return NextResponse.json({ error: "missing txHash" }, { status: 400 });
  if (!purchaseType || !PURCHASE_TYPES.includes(purchaseType)) {
    return NextResponse.json({ error: "missing or invalid purchaseType" }, { status: 400 });
  }

  const receipt = await createPublicClient({ chain: celo, transport: http(CELO_RPC) })
    .getTransactionReceipt({ hash: txHash as `0x${string}` })
    .catch(() => null);
  if (!receipt) {
    return NextResponse.json(
      { error: "Transaction is still confirming. Try again shortly.", retryable: true },
      { status: 425 },
    );
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "Transaction reverted or failed on-chain" }, { status: 402 });
  }

  if (purchaseType === "ticket") {
    return recoverTicket(address, txHash, receipt.logs);
  }
  if (purchaseType === "credit") {
    return recoverCredit(address, txHash, receipt.logs);
  }
  return recoverClaim(address, txHash, receipt.logs);
}

// ─── ticket recovery ────────────────────────────────────────────────────────

async function recoverTicket(
  address: string,
  txHash: string,
  logs: readonly { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }[],
) {
  if (!TICKET) return NextResponse.json({ error: "ticket contract not configured" }, { status: 500 });

  // Idempotency
  const { data: existing } = await supabase
    .from("game_credit_ledger")
    .select("balance_after")
    .eq("tx_hash", txHash)
    .eq("ledger_type", "AKIBA_TICKET_PURCHASED")
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, recovered: false, duplicate: true, newBalance: existing.balance_after });
  }

  // Decode TicketsPurchased event
  let ticketAmount = 0;
  let milesBurned = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== TICKET) continue;
    try {
      const decoded = decodeEventLog({
        abi: [TICKETS_PURCHASED_EVENT],
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      }) as any;
      if (decoded.eventName !== "TicketsPurchased") continue;
      if (String(decoded.args.user).toLowerCase() !== address) continue;
      ticketAmount = Number(decoded.args.ticketAmount);
      milesBurned = decoded.args.milesBurned as bigint;
      break;
    } catch { /* unrelated log */ }
  }

  if (!ticketAmount) {
    console.error(`[farkle/purchase/recover] TicketsPurchased not found wallet=${address} txHash=${txHash}`);
    return NextResponse.json(
      { error: "TicketsPurchased event not found for this wallet in the tx" },
      { status: 402 },
    );
  }

  // Credit balance
  const { data: bal } = await supabase
    .from("farkle_ticket_balances")
    .select("balance")
    .eq("wallet_address", address)
    .maybeSingle();
  const newBalance = (bal?.balance ?? 0) + ticketAmount;

  const { error: balErr } = await supabase.from("farkle_ticket_balances").upsert(
    { wallet_address: address, balance: newBalance, updated_at: new Date().toISOString() },
    { onConflict: "wallet_address" },
  );
  if (balErr) {
    console.error(`[farkle/purchase/recover] ticket balance write failed wallet=${address}`, balErr);
    return NextResponse.json({ error: "failed to update ticket balance" }, { status: 500 });
  }

  const { error: ledgerErr } = await supabase.from("game_credit_ledger").insert({
    wallet_address: address,
    amount: ticketAmount,
    balance_after: newBalance,
    currency: "AKIBA_TICKET",
    ledger_type: "AKIBA_TICKET_PURCHASED",
    tx_hash: txHash,
    metadata: { miles_burned: milesBurned.toString(), recovered: true },
  });
  if (ledgerErr) {
    if (ledgerErr.code === "23505") {
      return NextResponse.json({ ok: true, recovered: false, duplicate: true });
    }
    console.error(`[farkle/purchase/recover] ticket ledger insert failed wallet=${address}`, ledgerErr);
    return NextResponse.json({ error: "failed to write ticket ledger" }, { status: 500 });
  }

  console.log(
    `[farkle/purchase/recover] ticket recovered wallet=${address} txHash=${txHash}` +
      ` ticketAmount=${ticketAmount} newBalance=${newBalance}`,
  );
  return NextResponse.json({ ok: true, recovered: true, newBalance });
}

// ─── credit recovery ─────────────────────────────────────────────────────────

async function recoverCredit(
  address: string,
  txHash: string,
  logs: readonly { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }[],
) {
  if (!VAULT) return NextResponse.json({ error: "credit vault not configured" }, { status: 500 });

  // Idempotency
  const { data: existing } = await supabase
    .from("game_credit_ledger")
    .select("balance_after")
    .eq("tx_hash", txHash)
    .eq("ledger_type", "GAME_CREDIT_PURCHASED")
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, recovered: false, duplicate: true, newBalance: existing.balance_after });
  }

  // Decode CreditsPurchased event
  let creditAmount = 0;
  let usdtAmount = 0n;
  for (const log of logs) {
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
      usdtAmount = decoded.args.usdtAmount as bigint;
      break;
    } catch { /* unrelated log */ }
  }

  if (!creditAmount) {
    console.error(`[farkle/purchase/recover] CreditsPurchased not found wallet=${address} txHash=${txHash}`);
    return NextResponse.json(
      { error: "CreditsPurchased event not found for this wallet in the tx" },
      { status: 402 },
    );
  }

  // Credit balance
  const { data: bal } = await supabase
    .from("farkle_credit_balances")
    .select("purchased_credits")
    .eq("wallet_address", address)
    .maybeSingle();
  const newBalance = (bal?.purchased_credits ?? 0) + creditAmount;

  const { error: balErr } = await supabase.from("farkle_credit_balances").upsert(
    { wallet_address: address, purchased_credits: newBalance, updated_at: new Date().toISOString() },
    { onConflict: "wallet_address" },
  );
  if (balErr) {
    console.error(`[farkle/purchase/recover] credit balance write failed wallet=${address}`, balErr);
    return NextResponse.json({ error: "failed to update credit balance" }, { status: 500 });
  }

  const { error: ledgerErr } = await supabase.from("game_credit_ledger").insert({
    wallet_address: address,
    amount: creditAmount,
    balance_after: newBalance,
    currency: "GAME_CREDIT",
    ledger_type: "GAME_CREDIT_PURCHASED",
    tx_hash: txHash,
    metadata: { usdt_base_units: usdtAmount.toString(), recovered: true },
  });
  if (ledgerErr) {
    if (ledgerErr.code === "23505") {
      return NextResponse.json({ ok: true, recovered: false, duplicate: true });
    }
    console.error(`[farkle/purchase/recover] credit ledger insert failed wallet=${address}`, ledgerErr);
    return NextResponse.json({ error: "failed to write credit ledger" }, { status: 500 });
  }

  console.log(
    `[farkle/purchase/recover] credit recovered wallet=${address} txHash=${txHash}` +
      ` creditAmount=${creditAmount} newBalance=${newBalance}`,
  );
  return NextResponse.json({ ok: true, recovered: true, newBalance, creditsAdded: creditAmount });
}

// ─── claim recovery ──────────────────────────────────────────────────────────

async function recoverClaim(
  address: string,
  txHash: string,
  logs: readonly { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }[],
) {
  if (!VAULT) return NextResponse.json({ error: "credit vault not configured" }, { status: 500 });

  // Idempotency
  const { data: existing } = await supabase
    .from("game_credit_ledger")
    .select("balance_after")
    .eq("tx_hash", txHash)
    .eq("ledger_type", "REWARD_CREDIT_CLAIMED")
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, recovered: false, duplicate: true });
  }

  // Decode RewardCreditsClaimed event
  let claimedBaseUnits = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== VAULT) continue;
    try {
      const decoded = decodeEventLog({
        abi: [CLAIMED_EVENT],
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      }) as any;
      if (decoded.eventName !== "RewardCreditsClaimed") continue;
      if (String(decoded.args.user).toLowerCase() !== address) continue;
      claimedBaseUnits = decoded.args.amount as bigint;
      break;
    } catch { /* unrelated log */ }
  }

  if (claimedBaseUnits === 0n) {
    console.error(`[farkle/purchase/recover] RewardCreditsClaimed not found wallet=${address} txHash=${txHash}`);
    return NextResponse.json(
      { error: "RewardCreditsClaimed event not found for this wallet in the tx" },
      { status: 402 },
    );
  }

  // Read post-claim on-chain balance (source of truth)
  let remainingCents = 0;
  try {
    const remaining = (await createPublicClient({ chain: celo, transport: http(CELO_RPC) }).readContract({
      address: VAULT as `0x${string}`,
      abi: gameCreditVaultAbi,
      functionName: "rewardCreditBalance",
      args: [address as `0x${string}`],
    })) as bigint;
    remainingCents = Math.round(Number(remaining) / 1e4);
  } catch { /* fall back to 0 */ }

  await supabase.from("farkle_credit_balances").upsert(
    { wallet_address: address, reward_credits_cents: remainingCents, updated_at: new Date().toISOString() },
    { onConflict: "wallet_address" },
  );

  await supabase.from("game_credit_ledger").insert({
    wallet_address: address,
    amount: -Math.round(Number(claimedBaseUnits) / 1e4),
    balance_after: remainingCents,
    currency: "REWARD_CREDIT",
    ledger_type: "REWARD_CREDIT_CLAIMED",
    tx_hash: txHash,
    metadata: { usdt_base_units: claimedBaseUnits.toString(), recovered: true },
  });

  const claimedCents = Math.round(Number(claimedBaseUnits) / 1e4);
  console.log(
    `[farkle/purchase/recover] claim recovered wallet=${address} txHash=${txHash}` +
      ` claimedCents=${claimedCents} remainingCents=${remainingCents}`,
  );
  return NextResponse.json({ ok: true, recovered: true, claimedCents, remainingCents });
}
