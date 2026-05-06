// app/api/referral/redeem/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isBlacklisted } from "@/lib/blacklist";
import { requireSession } from "@/lib/auth";
import { checkStableHoldRequirement } from "@/lib/stableHoldGate";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const codeRaw = body.code as string | undefined;

  const addr = session.walletAddress;
  const code = codeRaw?.trim().toUpperCase();

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  if (await isBlacklisted(addr, "referral/redeem")) {
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

  try {
    const stableCheck = await checkStableHoldRequirement(addr);
    if (!stableCheck.ok) {
      return NextResponse.json({ error: stableCheck.message }, { status: stableCheck.status });
    }
  } catch (e) {
    console.error("[referral/redeem] RPC error:", e);
    return NextResponse.json(
      { error: "Could not verify stablecoin hold history. Please try again." },
      { status: 503 }
    );
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
