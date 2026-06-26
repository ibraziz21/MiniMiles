/**
 * POST /api/vouchers/scan/inspect
 * Body: { token: string }
 *
 * Read-only QR preview for the in-store scanner. The partner_id is derived from
 * the iron-session ONLY — never from the request body. The raw token is hashed
 * server-side; only the hash is sent to inspect_voucher_presentation, which
 * returns a PII-free, enumeration-safe preview.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { createHash } from "crypto";

const PRESENTATION_TOKEN_RE = /^AKV1\.[A-Za-z0-9_-]{43}$/;
const INVALID_PREVIEW = {
  valid: false,
  invalid_reason: "INVALID",
  voucher_id: null,
  offer_title: null,
  voucher_type: null,
  discount_percent: null,
  discount_cusd: null,
  merchant_name: null,
  applicable_category: null,
  token_expires_at: null,
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

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";

  if (!PRESENTATION_TOKEN_RE.test(token)) {
    return jsonNoStore(INVALID_PREVIEW);
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data, error } = await supabase.rpc("inspect_voucher_presentation", {
    p_token_hash: tokenHash,
    p_partner_id: session.partnerId,
  });

  if (error) {
    console.error("[scan/inspect]", error.message);
    return jsonNoStore({ error: "Inspection failed" }, 500);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.valid) {
    return jsonNoStore(INVALID_PREVIEW);
  }

  return jsonNoStore({
    valid:               row.valid,
    invalid_reason:      null,
    voucher_id:          row.voucher_id ?? null,
    offer_title:         row.offer_title ?? null,
    voucher_type:        row.voucher_type ?? null,
    discount_percent:    row.discount_percent ?? null,
    discount_cusd:       row.discount_cusd ?? null,
    merchant_name:       row.merchant_name ?? null,
    applicable_category: row.applicable_category ?? null,
    token_expires_at:    row.token_expires_at ?? null,
  });
}
