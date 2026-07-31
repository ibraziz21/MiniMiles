import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueVoucher } from "@/lib/vouchers/issuance";

export async function POST(request: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Parse body ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { template_id, quote_id, confirmed } = body ?? {};

  if (typeof template_id !== "string" || !template_id) {
    return NextResponse.json({ error: "template_id is required" }, { status: 400 });
  }

  // The burn (whether ledger, on-chain, or both) requires the user to have
  // explicitly clicked through a confirmation modal showing the real quote —
  // no wallet signature needed for this path, but a bare boolean isn't
  // enough on its own either; it must reference an actual quote (see below).
  if (confirmed !== true || typeof quote_id !== "string" || !quote_id) {
    return NextResponse.json({ error: "A confirmed quote is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // The quote owns the stable purchase key and the exact wallet (or null for a
  // ledger-only walletless purchase). A retry of the same quote therefore
  // reaches the database with the same idempotency key.
  const { data: quote, error: quoteErr } = await admin
    .from("voucher_purchase_quotes")
    .select("purchase_key, wallet_address, disclosure_version, hub_user_id, template_id")
    .eq("id", quote_id)
    .maybeSingle();

  if (
    quoteErr ||
    !quote ||
    quote.hub_user_id !== user.id ||
    quote.template_id !== template_id
  ) {
    return NextResponse.json({ error: "Quote not found or expired" }, { status: 409 });
  }

  const walletAddress =
    typeof quote.wallet_address === "string"
      ? quote.wallet_address.toLowerCase()
      : null;

  if (walletAddress) {
    const { data: linkedWallet } = await admin
      .from("hub_user_wallets")
      .select("address")
      .eq("user_id", user.id)
      .eq("address", walletAddress)
      .eq("verification_status", "verified")
      .maybeSingle();
    if (!linkedWallet) {
      return NextResponse.json(
        { error: "The wallet in this quote is no longer linked" },
        { status: 409 },
      );
    }
  }

  // ── Resolve merchant + price from template ──────────────────────────────────
  const { data: template } = await admin
    .from("spend_voucher_templates")
    .select("partner_id, miles_cost")
    .eq("id", template_id)
    .maybeSingle();

  if (!template) {
    return NextResponse.json({ error: "Template not found or inactive" }, { status: 404 });
  }

  // ── Server-generated nonce + idempotency key ────────────────────────────────
  // ── Delegate to issuance service ─────────────────────────────────────────────
  const result = await issueVoucher({
    userId:         user.id,
    userAddress:    walletAddress,
    email:          user.email ?? null,
    templateId:     template_id,
    merchantId:     (template as { partner_id: string; miles_cost: number }).partner_id,
    totalPoints:    (template as { partner_id: string; miles_cost: number }).miles_cost,
    idempotencyKey: quote.purchase_key,
    consentMethod:  "hub_ui_confirmed",
    quoteId:        quote_id,
    disclosureVersion: quote.disclosure_version,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  }

  return NextResponse.json(
    {
      voucher: result.voucher,
      queued: result.queued ?? false,
      intent_state: result.intentState,
    },
    { status: 201 },
  );
}
