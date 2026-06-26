import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildIssueMessage, isTimestampFresh } from "@/lib/vouchers/codes";
import { issueVoucher } from "@/lib/vouchers/issuance";

const AKIBA_API = process.env.AKIBA_API_URL ?? "";

async function verifyWalletSignature(
  address: string,
  message: string,
  signature: string
): Promise<boolean> {
  if (!AKIBA_API) return false;
  try {
    const res = await fetch(`${AKIBA_API}/api/v1/auth/verify-signature`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, message, signature }),
    });
    if (!res.ok) return false;
    const { valid } = await res.json() as { valid?: boolean };
    return Boolean(valid);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Parse body ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const {
    template_id,
    user_address,
    signature,
    nonce,
    timestamp,
    idempotency_key,
  } = body ?? {};

  if (
    typeof template_id !== "string" ||
    typeof user_address !== "string" ||
    typeof signature   !== "string" ||
    typeof nonce       !== "string" ||
    typeof timestamp   !== "number"
  ) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
  }

  // ── Timestamp freshness ──────────────────────────────────────────────────────
  if (!isTimestampFresh(timestamp)) {
    return NextResponse.json({ error: "Request timestamp is expired" }, { status: 400 });
  }

  // ── Wallet ownership ─────────────────────────────────────────────────────────
  const admin = createAdminClient();
  const { data: wallet } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id)
    .eq("address", user_address.toLowerCase())
    .maybeSingle();

  if (!wallet) {
    return NextResponse.json({ error: "Wallet not linked to your account" }, { status: 403 });
  }

  // ── Signature verification (message includes nonce + timestamp) ──────────────
  const message = buildIssueMessage({
    templateId: template_id,
    address:    user_address,
    nonce,
    timestamp,
  });

  const valid = await verifyWalletSignature(user_address, message, signature);
  if (!valid) {
    return NextResponse.json({ error: "Invalid wallet signature" }, { status: 403 });
  }

  // Resolve merchant_id from the template
  const { data: template } = await admin
    .from("spend_voucher_templates")
    .select("partner_id")
    .eq("id", template_id)
    .maybeSingle();

  if (!template) {
    return NextResponse.json({ error: "Template not found or inactive" }, { status: 404 });
  }

  // ── Delegate to issuance service ─────────────────────────────────────────────
  const result = await issueVoucher({
    userId:         user.id,
    userAddress:    user_address.toLowerCase(),
    templateId:     template_id,
    merchantId:     template.partner_id,
    nonce,
    idempotencyKey: typeof idempotency_key === "string" ? idempotency_key : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  }

  return NextResponse.json({ voucher: result.voucher }, { status: 201 });
}
