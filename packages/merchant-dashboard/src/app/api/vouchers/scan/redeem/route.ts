/**
 * POST /api/vouchers/scan/redeem
 * Body: { token: string, gross_amount_cusd: number, external_reference?: string }
 *
 * Atomically redeems a presented voucher. partner_id and merchant_user_id come
 * from the iron-session ONLY. The raw token is hashed server-side; the hash is
 * passed to redeem_voucher_in_store_atomic, which locks the voucher row so that
 * concurrent scans / online-order races resolve to exactly one winner.
 *
 * Referral qualification (referral-system-spec.md §2.4.2/§2.4.3) is queued
 * by the redemption RPC in the same transaction. The durable outbox worker
 * qualifies it after commit, so a transient failure cannot lose the reward
 * and referral processing never blocks a successful merchant scan.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { createHash } from "crypto";

// Same static rate hub-page's orders/route.ts uses (USD_TO_KES, default
// 130) — referral qualification only needs an approximate KES-equivalent
// threshold check, not settlement-grade precision.
const USD_TO_KES = Number(process.env.USD_TO_KES ?? 130);

const PRESENTATION_TOKEN_RE = /^AKV1\.[A-Za-z0-9_-]{43}$/;
const GENERIC_INVALID = {
  ok: false,
  error: "Voucher code is invalid or unavailable",
  code: "INVALID",
};

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, private" },
  });
}

export async function POST(req: NextRequest) {
  const session = await requireMerchantSession();
  if (!session) return jsonNoStore({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as
    | { token?: unknown; gross_amount_cusd?: unknown; external_reference?: unknown }
    | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const grossAmount =
    typeof body?.gross_amount_cusd === "number" ? body.gross_amount_cusd : Number.NaN;
  const externalReference =
    typeof body?.external_reference === "string" && body.external_reference.trim() !== ""
      ? body.external_reference.trim()
      : null;

  if (!PRESENTATION_TOKEN_RE.test(token)) {
    return jsonNoStore(GENERIC_INVALID, 409);
  }
  if (!Number.isFinite(grossAmount) || grossAmount <= 0 || grossAmount > 1_000_000) {
    return jsonNoStore({ error: "Enter a valid gross order amount" }, 400);
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data, error } = await supabase.rpc("redeem_voucher_in_store_atomic", {
    p_token_hash:         tokenHash,
    p_partner_id:         session.partnerId,
    p_merchant_user_id:   session.merchantUserId,
    p_gross_amount_cusd:  grossAmount,
    p_external_reference: externalReference,
    p_gross_amount_kes:   Math.round(grossAmount * USD_TO_KES),
  });

  if (error) {
    console.error("[scan/redeem]", error.message);
    return jsonNoStore({ error: "Redemption failed" }, 500);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.ok) return jsonNoStore(GENERIC_INVALID, 409);

  return jsonNoStore({ ok: true, voucher_id: row.voucher_id, offer_title: row.offer_title });
}
