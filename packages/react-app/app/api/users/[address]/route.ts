// app/api/users/[address]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
    const { address } = await params;
  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("users")
    .select("is_member")
    .eq("user_address", address)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error(error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const isMember = data?.is_member === true;
  return NextResponse.json({ isMember });
}
