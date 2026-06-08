import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address")?.toLowerCase();
  if (!address) return NextResponse.json({ error: "missing address" }, { status: 400 });

  const [tickets, credits] = await Promise.all([
    supabase.from("farkle_ticket_balances").select("balance")
      .eq("wallet_address", address).maybeSingle(),
    supabase.from("farkle_credit_balances").select("purchased_credits, reward_credits_cents")
      .eq("wallet_address", address).maybeSingle(),
  ]);

  return NextResponse.json({
    akibaTickets:       tickets.data?.balance ?? 0,
    gameCredits:        credits.data?.purchased_credits ?? 0,
    rewardCreditsCents: credits.data?.reward_credits_cents ?? 0,
  });
}
