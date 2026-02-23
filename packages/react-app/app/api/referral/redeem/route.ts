// app/api/referral/redeem/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const addrRaw = body.newAddress as string | undefined;
  const codeRaw = body.code as string | undefined;

  const addr = addrRaw?.toLowerCase();
  const code = codeRaw?.trim().toUpperCase();

  if (!addr || !code) {
    return NextResponse.json({ error: "Missing address or code" }, { status: 400 });
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
