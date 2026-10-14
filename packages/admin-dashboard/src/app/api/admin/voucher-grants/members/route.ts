import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(request: Request) {
  const session = await requireAdminSession("voucher_funds.grant");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const query = new URL(request.url).searchParams.get("query")?.trim().replace(/^@/, "") ?? "";
  if (query.length < 2 || query.length > 100) return NextResponse.json({ members: [] });

  const normalized = query.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (normalized.length < 2) return NextResponse.json({ members: [] });
  const { data, error } = await supabase
    .from("leaderboard_profiles")
    .select("username, username_normalized")
    .ilike("username_normalized", `${normalized}%`)
    .order("username_normalized", { ascending: true })
    .limit(8);
  if (error) {
    console.error("[voucher-grants:members]", error.message);
    return NextResponse.json({ error: "Member search is unavailable." }, { status: 503 });
  }

  return NextResponse.json({
    members: (data ?? []).filter((row) => row.username).map((row) => ({
      id: row.username_normalized,
      username: row.username,
      maskedContact: "Canonical Akiba username",
      joinedAt: null,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
