// GET  /api/games/my-prizes[?unseen=1]
//   Session-authed. Won vouchers (acquisition_source='leaderboard_win') for
//   the signed-in wallet. unseen=1 → only prizes whose win reveal sheet has
//   not been shown yet (win_seen_at is null, status still 'issued').
//
// POST /api/games/my-prizes  { voucherIds: string[] }
//   Marks win_seen_at (reveal sheet shown / dismissed). Dismissal = soft
//   claim — the voucher simply stays in the wallet.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { requireSession } from "@/lib/auth";

const SELECT = `
  id, code, status, created_at, expires_at, win_seen_at, win_meta, merchant_id,
  spend_merchants ( slug, name, country, image_url )
`;

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const address = session.walletAddress.toLowerCase();
  const unseenOnly = new URL(req.url).searchParams.get("unseen") === "1";

  let q = supabase
    .from("issued_vouchers")
    .select(SELECT)
    .eq("user_address", address)
    .eq("acquisition_source", "leaderboard_win")
    .neq("status", "void")
    .order("created_at", { ascending: false });

  if (unseenOnly) q = q.is("win_seen_at", null).eq("status", "issued");

  const { data, error } = await q;
  if (error) {
    console.error("[my-prizes:GET]", error.message);
    return NextResponse.json({ error: "Failed to fetch prizes" }, { status: 500 });
  }

  return NextResponse.json({ prizes: data ?? [] });
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const address = session.walletAddress.toLowerCase();

  let voucherIds: string[];
  try {
    const body = await req.json();
    voucherIds = Array.isArray(body?.voucherIds) ? body.voucherIds : [];
  } catch {
    voucherIds = [];
  }
  if (voucherIds.length === 0 || voucherIds.length > 20) {
    return NextResponse.json({ error: "voucherIds required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("issued_vouchers")
    .update({ win_seen_at: new Date().toISOString() })
    .in("id", voucherIds)
    .eq("user_address", address)
    .eq("acquisition_source", "leaderboard_win")
    .is("win_seen_at", null);

  if (error) {
    console.error("[my-prizes:POST]", error.message);
    return NextResponse.json({ error: "Failed to mark seen" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
