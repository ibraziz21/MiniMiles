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
  const { template_id, idempotency_key } = body ?? {};

  if (typeof template_id !== "string" || !template_id) {
    return NextResponse.json({ error: "template_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── Resolve wallet ────────────────────────────────────────────────────────────
  // Prefer is_primary = true; fall back to most recently linked.
  const { data: wallets } = await admin
    .from("hub_user_wallets")
    .select("address, is_primary, linked_at")
    .eq("user_id", user.id)
    .order("linked_at", { ascending: false });

  if (!wallets || wallets.length === 0) {
    return NextResponse.json({ error: "Connect a wallet first" }, { status: 400 });
  }

  const primaryWallet = (wallets as Array<{ address: string; is_primary: boolean; linked_at: string }>)
    .find((w) => w.is_primary);
  const wallet = primaryWallet ?? (wallets as Array<{ address: string }>)[0];

  // ── Resolve merchant from template ──────────────────────────────────────────
  const { data: template } = await admin
    .from("spend_voucher_templates")
    .select("partner_id")
    .eq("id", template_id)
    .maybeSingle();

  if (!template) {
    return NextResponse.json({ error: "Template not found or inactive" }, { status: 404 });
  }

  // ── Server-generated nonce + idempotency key ────────────────────────────────
  const nonce = crypto.randomUUID();
  const resolvedIdempotencyKey =
    typeof idempotency_key === "string" && idempotency_key
      ? idempotency_key
      : `hub-redeem-${user.id}-${template_id}-${crypto.randomUUID()}`;

  // ── Delegate to issuance service ─────────────────────────────────────────────
  const result = await issueVoucher({
    userId:         user.id,
    userAddress:    wallet.address.toLowerCase(),
    templateId:     template_id,
    merchantId:     (template as { partner_id: string }).partner_id,
    nonce,
    idempotencyKey: resolvedIdempotencyKey,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  }

  return NextResponse.json({ voucher: result.voucher }, { status: 201 });
}
