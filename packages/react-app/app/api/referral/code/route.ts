// app/api/referral/code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateCode } from "@/lib/referrals";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.toLowerCase();
  if (!address) return NextResponse.json({ error: "missing address" }, { status: 400 });

  // See if they already have one
  const { data, error } = await supabase
    .from("referral_codes")
    .select("code")
    .eq("user_address", address)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "DB error" }, { status: 500 });
  if (data) return NextResponse.json({ code: data.code });

  // Create
  const code = generateCode();
  const { error: insErr } = await supabase
    .from("referral_codes")
    .insert({ user_address: address, code });

  if (insErr) return NextResponse.json({ error: "DB error" }, { status: 500 });

  return NextResponse.json({ code });
}
