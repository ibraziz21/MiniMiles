import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readFarkleRewardCreditCents } from "@/server/farkle/settleOnChain";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
type HexAddress = `0x${string}`;

function asHexAddress(value: string): HexAddress | null {
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as HexAddress) : null;
}

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address")?.toLowerCase();
  if (!address) return NextResponse.json({ error: "missing address" }, { status: 400 });

  const [tickets, credits] = await Promise.all([
    supabase.from("farkle_ticket_balances").select("balance")
      .eq("wallet_address", address).maybeSingle(),
    supabase.from("farkle_credit_balances").select("purchased_credits, reward_credits_cents")
      .eq("wallet_address", address).maybeSingle(),
  ]);

  let rewardCreditsCents = credits.data?.reward_credits_cents ?? 0;
  const hexAddress = asHexAddress(address);
  if (hexAddress) {
    try {
      const chainRewardCreditsCents = await readFarkleRewardCreditCents(hexAddress);
      rewardCreditsCents = chainRewardCreditsCents;
      if (chainRewardCreditsCents !== (credits.data?.reward_credits_cents ?? 0)) {
        await supabase.from("farkle_credit_balances").upsert(
          {
            wallet_address: address,
            purchased_credits: credits.data?.purchased_credits ?? 0,
            reward_credits_cents: chainRewardCreditsCents,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "wallet_address" },
        );
      }
    } catch (e: any) {
      console.error("[farkle/balances] reward credit chain sync failed:", e?.message ?? e);
    }
  }

  return NextResponse.json({
    akibaTickets:       tickets.data?.balance ?? 0,
    gameCredits:        credits.data?.purchased_credits ?? 0,
    rewardCreditsCents,
  });
}
