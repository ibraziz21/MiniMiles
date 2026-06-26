/**
 * GET /api/shop/vouchers/lookup?code=...&merchant_id=...
 *
 * Security properties enforced:
 *   • Requires authenticated Hub session
 *   • Verifies the voucher belongs to this user (hub_user_id OR linked wallet)
 *   • Verifies merchant scope from rules_snapshot (not from client-supplied data)
 *   • Verifies voucher is issued (not redeemed, void, expired, pending)
 *   • Verifies expiry server-side
 *   • Returns rules from server-side rules_snapshot — never from raw QR payload
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RulesSnapshot } from "@/lib/vouchers/types";

export async function GET(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const code       = searchParams.get("code")?.trim().toUpperCase();
  const merchantId = searchParams.get("merchant_id")?.trim();

  if (!code || !merchantId) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── Resolve user's linked wallet addresses ─────────────────────────────────
  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id);

  const addresses = (walletRows ?? []).map((r) => r.address.toLowerCase());

  // ── Fetch voucher with template (for legacy fallback) ──────────────────────
  const { data: issued } = await admin
    .from("issued_vouchers")
    .select(`
      id, status, hub_user_id, user_address, expires_at, rules_snapshot,
      spend_voucher_templates (
        id, partner_id, voucher_type, discount_percent, discount_cusd,
        applicable_category, linked_product_id, retail_value_cusd, miles_cost, title
      )
    `)
    .eq("code", code)
    .maybeSingle();

  if (!issued) {
    return NextResponse.json({ error: "Voucher not found or already used" }, { status: 404 });
  }

  // ── Status check ──────────────────────────────────────────────────────────
  if (issued.status !== "issued") {
    return NextResponse.json({ error: "Voucher not found or already used" }, { status: 404 });
  }

  // ── Expiry check ──────────────────────────────────────────────────────────
  if (issued.expires_at && new Date(issued.expires_at) < new Date()) {
    return NextResponse.json({ error: "Voucher has expired" }, { status: 410 });
  }

  // ── Ownership check ───────────────────────────────────────────────────────
  const ownsIt = issued.hub_user_id
    ? issued.hub_user_id === user.id
    : addresses.includes((issued.user_address ?? "").toLowerCase());

  if (!ownsIt) {
    // Return same 404 to avoid oracle leaking that a code exists but belongs to another user
    return NextResponse.json({ error: "Voucher not found or already used" }, { status: 404 });
  }

  // ── Build rules_snapshot (prefer stored snapshot, fall back to template) ──
  let rules: RulesSnapshot;

  const snap = issued.rules_snapshot as RulesSnapshot | null;
  if (snap) {
    rules = snap;
  } else {
    const tmpl = Array.isArray(issued.spend_voucher_templates)
      ? issued.spend_voucher_templates[0]
      : issued.spend_voucher_templates;

    if (!tmpl) {
      return NextResponse.json({ error: "Voucher template not found" }, { status: 404 });
    }

    const t = tmpl as Record<string, unknown>;
    rules = {
      template_id:        t.id as string,
      merchant_id:        t.partner_id as string,
      voucher_type:       t.voucher_type as RulesSnapshot["voucher_type"],
      discount_percent:   t.discount_percent as number | null,
      discount_cusd:      t.discount_cusd as number | null,
      applicable_category: t.applicable_category as string | null,
      linked_product_id:  t.linked_product_id as string | null,
      retail_value_cusd:  t.retail_value_cusd as number | null,
      miles_cost:         t.miles_cost as number,
      title:              t.title as string,
      snapshotted_at:     new Date().toISOString(),
    };
  }

  // ── Merchant scope check (from server-side rules) ─────────────────────────
  if (rules.merchant_id !== merchantId) {
    return NextResponse.json({ error: "Voucher is not valid for this merchant" }, { status: 400 });
  }

  return NextResponse.json({
    voucher_id: issued.id,
    rules,
  });
}
