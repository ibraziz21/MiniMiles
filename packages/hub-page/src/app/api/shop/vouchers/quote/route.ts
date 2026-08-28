import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVoucherSpendableBalance } from "@/lib/akiba/voucherSpendableBalance";
import { createHash } from "crypto";
import { isHiddenPartner } from "@/lib/akiba/hidden-partners";

// Bumped whenever the confirmation modal's copy changes materially — stored
// on the quote for audit purposes (see reserve_voucher_purchase's consent
// binding, migration 046_hub_miles_spend_intents.sql).
const DISCLOSURE_VERSION = "v1";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { template_id } = body ?? {};
  if (typeof template_id !== "string" || !template_id) {
    return NextResponse.json({ error: "template_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: template } = await admin
    .from("spend_voucher_templates")
    .select("partner_id, miles_cost, active, expires_at")
    .eq("id", template_id)
    .maybeSingle();
  if (
    !template ||
    !template.active ||
    (template.expires_at && new Date(template.expires_at).getTime() <= Date.now()) ||
    isHiddenPartner(template.partner_id)
  ) {
    return NextResponse.json({ error: "Template not found or inactive" }, { status: 404 });
  }

  const { data: availableRows, error: availabilityErr } = await admin.rpc(
    "list_available_voucher_template_ids_hub",
    { p_hub_user_id: user.id },
  );
  const available = (availableRows ?? []).some(
    (row: { template_id: string } | string) =>
      typeof row === "string" ? row === template_id : row.template_id === template_id,
  );
  if (availabilityErr || !available) {
    return NextResponse.json(
      { error: "This voucher is not currently available" },
      { status: 409 },
    );
  }
  const totalPoints = template.miles_cost as number;

  const spendable = await getVoucherSpendableBalance({ hubUserId: user.id, email: user.email ?? null });
  if (!spendable.ok) {
    const message = spendable.reason === "identity_unresolved"
      ? "Could not resolve identity"
      : "Could not read ledger balance";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const ledgerPoints = Math.min(totalPoints, spendable.ledgerBalance);
  const onchainPoints = totalPoints - ledgerPoints;
  const quoteWallet = onchainPoints > 0 ? spendable.walletAddress : null;

  if (onchainPoints > 0) {
    if (!quoteWallet) {
      return NextResponse.json({ error: "Connect a wallet to cover the remaining balance" }, { status: 400 });
    }
    if (spendable.chainStatus === "chain_unavailable") {
      return NextResponse.json({ error: "Could not verify your wallet balance — please retry" }, { status: 503 });
    }
    if (spendable.chainStatus === "reserved_unavailable") {
      return NextResponse.json({ error: "Could not verify reserved wallet balance" }, { status: 503 });
    }
    if ((spendable.chainBalance ?? 0) < onchainPoints) {
      return NextResponse.json({ error: "Not enough Miles" }, { status: 422 });
    }
  }

  const purchaseKey = `hub-voucher:${crypto.randomUUID()}`;
  const requestHash = createHash("sha256")
    .update([
      user.id,
      template_id,
      template.partner_id,
      totalPoints,
      ledgerPoints,
      onchainPoints,
      quoteWallet ?? "",
      DISCLOSURE_VERSION,
    ].join(":"))
    .digest("hex");

  const { data: quote, error: insertErr } = await admin
    .from("voucher_purchase_quotes")
    .insert({
      purchase_key: purchaseKey,
      request_hash: requestHash,
      hub_user_id: user.id,
      template_id,
      merchant_id: template.partner_id,
      wallet_address: quoteWallet,
      ledger_points: ledgerPoints,
      onchain_points: onchainPoints,
      total_points: totalPoints,
      disclosure_version: DISCLOSURE_VERSION,
    })
    .select("id, ledger_points, onchain_points, total_points, disclosure_version, wallet_address")
    .single();

  if (insertErr || !quote) {
    return NextResponse.json({ error: "Could not create quote" }, { status: 500 });
  }

  return NextResponse.json({
    quote_id: quote.id,
    ledger_points: quote.ledger_points,
    onchain_points: quote.onchain_points,
    total_points: quote.total_points,
    disclosure_version: quote.disclosure_version,
    wallet_address: quote.wallet_address,
  });
}
