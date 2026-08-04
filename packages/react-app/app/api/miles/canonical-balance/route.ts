import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { resolveCanonicalWallet } from "@/lib/server/canonicalPartnerQuests";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    const canonicalId = await resolveCanonicalWallet(session.walletAddress);
    const { data, error } = await supabase
      .from("miles_ledger")
      .select("amount, direction")
      .eq("canonical_id", canonicalId)
      .eq("on_chain", false);
    if (error) throw error;
    const offchain = (data ?? []).reduce(
      (sum, row: any) => sum + (row.direction === "credit" ? Number(row.amount) : -Number(row.amount)),
      0,
    );
    return NextResponse.json(
      { offchain, canonicalId },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[canonical-balance] lookup failed:", error);
    return NextResponse.json({ error: "Balance unavailable" }, { status: 503 });
  }
}
