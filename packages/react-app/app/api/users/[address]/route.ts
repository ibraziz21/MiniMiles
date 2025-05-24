// app/api/users/[address]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

/**
 * GET /api/users/:address
 * returns { isMember: boolean }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  const address = params.address;        // no need to “await” params
  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  const { data } = await supabase
    .from("users")
    .select("is_member")
    .eq("user_address", address)
    .maybeSingle();

  return NextResponse.json({ isMember: !!data?.is_member });
}
