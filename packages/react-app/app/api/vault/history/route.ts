// GET /api/vault/history
// Returns the last 20 vault events (deposits + withdrawals) for the signed-in wallet.

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";

export async function GET(_req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }

  const wallet = session.walletAddress.toLowerCase();

  const { data, error } = await supabase
    .from("vault_events")
    .select("id, event_type, amount_usdt, tx_hash, block_number, created_at")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[vault/history] DB error", error);
    return Response.json({ error: "db-error" }, { status: 500 });
  }

  return Response.json({ events: data ?? [] });
}
