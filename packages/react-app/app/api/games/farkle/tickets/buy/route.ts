/**
 * POST /api/games/farkle/tickets/buy
 * Body: { address: string }
 *
 * Burns 25 AkibaMiles (off-chain ledger entry) and credits 5 tickets.
 * The on-chain burn (AkibaFarkleTicketManager.buyTicketPack) is triggered
 * from the frontend directly — this route handles the Supabase ledger update
 * after the tx is confirmed.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const TICKETS_PER_PACK = 5;
const MILES_PER_PACK   = 25;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const address = body?.address?.toLowerCase();
  const txHash  = body?.txHash;
  if (!address) return NextResponse.json({ error: "missing address" }, { status: 400 });
  if (!txHash) return NextResponse.json({ error: "missing txHash" }, { status: 400 });

  const { data: existingTx, error: existingTxError } = await supabase
    .from("game_credit_ledger")
    .select("balance_after")
    .eq("tx_hash", txHash)
    .eq("ledger_type", "AKIBA_TICKET_PURCHASED")
    .maybeSingle();
  if (existingTxError) {
    console.error("[farkle/tickets/buy] failed to check tx hash", existingTxError);
    return NextResponse.json({ error: "failed to check ticket purchase" }, { status: 500 });
  }
  if (existingTx) {
    return NextResponse.json({ ok: true, duplicate: true, newBalance: existingTx.balance_after ?? null });
  }

  // Upsert ticket balance
  const { data: existing, error: balanceReadError } = await supabase
    .from("farkle_ticket_balances")
    .select("balance")
    .eq("wallet_address", address)
    .maybeSingle();
  if (balanceReadError) {
    console.error("[farkle/tickets/buy] failed to read ticket balance", balanceReadError);
    return NextResponse.json({ error: "failed to read ticket balance" }, { status: 500 });
  }

  const newBalance = (existing?.balance ?? 0) + TICKETS_PER_PACK;

  const { error: balanceWriteError } = await supabase.from("farkle_ticket_balances").upsert(
    { wallet_address: address, balance: newBalance, updated_at: new Date().toISOString() },
    { onConflict: "wallet_address" }
  );
  if (balanceWriteError) {
    console.error("[farkle/tickets/buy] failed to update ticket balance", balanceWriteError);
    return NextResponse.json({ error: "failed to update ticket balance" }, { status: 500 });
  }

  // Ledger entry
  const { error: ledgerError } = await supabase.from("game_credit_ledger").insert({
    wallet_address: address,
    amount:         TICKETS_PER_PACK,
    balance_after:  newBalance,
    currency:       "AKIBA_TICKET",
    ledger_type:    "AKIBA_TICKET_PURCHASED",
    tx_hash:        txHash ?? null,
    metadata:       { miles_cost: MILES_PER_PACK },
  });
  if (ledgerError) {
    console.error("[farkle/tickets/buy] failed to write ledger", ledgerError);
    return NextResponse.json(
      { error: ledgerError.code === "23505" ? "ticket purchase already synced" : "failed to write ticket ledger" },
      { status: ledgerError.code === "23505" ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true, newBalance });
}
