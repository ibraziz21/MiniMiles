// app/api/referral/redeem/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { isBlacklisted } from "@/lib/blacklist";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const publicClient = createPublicClient({ chain: celo, transport: http() });

// Minimum number of prior on-chain transactions required before a wallet
// can be used as a referral target. Prevents freshly-created bot wallets.
const MIN_PRIOR_TXS = 1;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const addrRaw = body.newAddress as string | undefined;
  const codeRaw = body.code as string | undefined;

  const addr = addrRaw?.toLowerCase();
  const code = codeRaw?.trim().toUpperCase();

  if (!addr || !code) {
    return NextResponse.json({ error: "Missing address or code" }, { status: 400 });
  }

  if (await isBlacklisted(addr)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Has this address already redeemed a code?
  const { data: existingRedeem, error: existingErr } = await supabase
    .from("referrals")
    .select("referred_address")
    .eq("referred_address", addr)
    .maybeSingle();

  if (existingErr) {
    console.error(existingErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (existingRedeem) {
    return NextResponse.json(
      { error: "You already used a referral code", codeUsed: true },
      { status: 409 }
    );
  }

  // Look up the code -> get the referrer's address from referral_codes.user_address
  const { data: codeRow, error: codeErr } = await supabase
    .from("referral_codes")
    .select("user_address, code")
    .eq("code", code)
    .maybeSingle();

  if (codeErr) {
    console.error(codeErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!codeRow) {
    return NextResponse.json({ error: "Invalid code" }, { status: 404 });
  }

  const referrer = codeRow.user_address.toLowerCase();

  // Block self-referral (your DB constraint will also enforce, but check here for UX)
  if (referrer === addr) {
    return NextResponse.json({ error: "You cannot use your own code" }, { status: 400 });
  }

  // #4 — Wallet age check: require at least MIN_PRIOR_TXS on-chain transactions
  // This blocks freshly-created bot wallets that have never interacted with the chain.
  try {
    const txCount = await publicClient.getTransactionCount({
      address: addr as `0x${string}`,
    });
    if (txCount < MIN_PRIOR_TXS) {
      return NextResponse.json(
        { error: "Your wallet must have prior on-chain activity to use a referral code" },
        { status: 403 }
      );
    }
  } catch (e) {
    // Non-fatal: if the RPC fails, allow the redemption through
    console.warn("[referral/redeem] wallet age check failed:", e);
  }

  // Insert redemption row
  const { error: insErr } = await supabase
    .from("referrals")
    .insert({
      referred_address: addr,
      referrer_address: referrer,
      // redeemed_at defaults in DB
    });

  if (insErr) {
    // likely conflict due to PK or constraint
    console.error(insErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, referrer });
}
