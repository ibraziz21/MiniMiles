import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  getLinkedWalletRequestById,
  toPublicLinkedWalletRequest,
} from "@/lib/prosperityPassLinkedWallets";
import { normalizeEvmAddress } from "@/lib/prosperity-pass-linking";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await context.params;
    const row = await getLinkedWalletRequestById(id);

    if (!row) {
      return NextResponse.json({ error: "Link request not found" }, { status: 404 });
    }

    // Only the primary wallet owner can cancel
    const primaryWallet = normalizeEvmAddress(session.walletAddress);
    if (!primaryWallet || primaryWallet !== row.primary_wallet) {
      return NextResponse.json({ error: "Not authorised to cancel this request" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("prosperity_pass_linked_wallets")
      .update({ status: "expired", last_error: "Cancelled by user" })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ request: toPublicLinkedWalletRequest(data as any) });
  } catch (err: any) {
    console.error("[linked-wallets][cancel]", err);
    return NextResponse.json(
      { error: err?.message ?? "Could not cancel request" },
      { status: 500 }
    );
  }
}
