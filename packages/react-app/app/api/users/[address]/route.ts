// app/api/users/[address]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

/* -------------------------------------------------------------------------- */
/*  GET /api/users/[address]                                                  */
/* -------------------------------------------------------------------------- */
export async function GET(
  _req: Request,                                  // 1) the incoming request
  { params }: { params: { address: string } }     // 2) the *typed* params obj
) {
  const address = params.address;
  console.log(address)

  if (!address) {
    return NextResponse.json(
      { error: "Missing address" },
      { status: 400 }
    );
  }

  /* ---- DB lookup --------------------------------------------------------- */
  const { data, error } = await supabase
    .from("users")
    .select("is_member")
    .eq("user_address", address)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows
    console.error(error);
    return NextResponse.json(
      { error: "Database error" },
      { status: 500 }
    );
  }

  return NextResponse.json({ isMember: data?.is_member === true });
}
