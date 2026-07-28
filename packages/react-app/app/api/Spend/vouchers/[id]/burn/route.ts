// POST /api/Spend/vouchers/[id]/burn
// Body: { reason: 'not_in_country'|'too_far'|'not_interested'|'prefer_miles'|'other',
//         reason_text?: string }
//
// Burns a WON voucher (acquisition_source='leaderboard_win') for Miles at the
// burn_pct snapshotted at issuance (default 80% of marketplace value).
// Atomic via burn_voucher_for_miles(): reason row → status='burned' → Miles
// mint job. No reason, no Miles — the survey is half the pilot's learning.
//
// See docs/skill-games-voucher-prizes-spec.md §5.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { requireSession } from "@/lib/auth";

const REASONS = ["not_in_country", "too_far", "not_interested", "prefer_miles", "other"] as const;
type BurnReason = (typeof REASONS)[number];

const RPC_ERROR_MAP: Record<string, { status: number; error: string }> = {
  VOUCHER_NOT_FOUND: { status: 404, error: "Voucher not found" },
  NOT_BURNABLE:      { status: 409, error: "Only won vouchers can be burned" },
  INVALID_STATUS:    { status: 409, error: "Voucher is not active" },
  FORBIDDEN:         { status: 403, error: "Not your voucher" },
  VOUCHER_EXPIRED:   { status: 409, error: "Voucher has expired" },
  NO_BURN_VALUE:     { status: 500, error: "Voucher has no burn value configured" },
  REASON_MISMATCH:   { status: 400, error: "Invalid reason" },
};

function mapRpcError(message: string): { status: number; error: string } {
  for (const [prefix, mapped] of Object.entries(RPC_ERROR_MAP)) {
    if (message.startsWith(prefix)) return mapped;
  }
  return { status: 500, error: "Burn failed" };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const address = session.walletAddress.toLowerCase();

  const { id: voucherId } = await params;
  if (!voucherId) {
    return NextResponse.json({ error: "voucher id required" }, { status: 400 });
  }

  let reason: BurnReason | undefined;
  let reasonText: string | null = null;
  try {
    const body = await req.json();
    if (REASONS.includes(body?.reason)) reason = body.reason;
    if (typeof body?.reason_text === "string") {
      reasonText = body.reason_text.trim().slice(0, 280) || null;
    }
  } catch { /* fall through to validation */ }

  if (!reason) {
    return NextResponse.json(
      { error: `reason required: one of ${REASONS.join(", ")}` },
      { status: 400 },
    );
  }

  // Country/city from profile at burn time (geo decision: profile is source of truth).
  const { data: profile } = await supabase
    .from("users")
    .select("country")
    .eq("user_address", address)
    .maybeSingle();

  const { data, error } = await supabase.rpc("burn_voucher_for_miles", {
    p_voucher_id:   voucherId,
    p_user_address: address,
    p_reason:       reason,
    p_reason_text:  reasonText,
    p_user_country: profile?.country ?? null,
    p_user_city:    null,
    p_expired:      false,
  });

  if (error) {
    const mapped = mapRpcError(error.message ?? "");
    if (mapped.status >= 500) console.error("[vouchers/burn]", error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    ok: true,
    milesCredited:    row?.miles_credited ?? null,
    marketplaceMiles: row?.marketplace_miles ?? null,
  });
}
