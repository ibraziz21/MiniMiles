import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY || "";

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

export async function GET(req: Request) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase is not configured" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address");

    if (!address) {
      return NextResponse.json(
        { error: "Missing address" },
        { status: 400 }
      );
    }

    const lower = address.toLowerCase();

    const { data, error } = await supabase
      .from("users")
      .select("username")
      .eq("user_address", lower)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/user/username] Supabase error:", error);
      return NextResponse.json(
        { error: "Failed to fetch username" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      username: data?.username ?? null,
    });
  } catch (err) {
    console.error("[GET /api/user/username] exception:", err);
    return NextResponse.json(
      { error: "Unexpected error" },
      { status: 500 }
    );
  }
}
