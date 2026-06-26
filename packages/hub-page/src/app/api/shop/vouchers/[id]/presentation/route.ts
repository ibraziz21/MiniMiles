/**
 * POST   /api/shop/vouchers/[id]/presentation  → mint a short-lived QR token
 * DELETE /api/shop/vouchers/[id]/presentation  → revoke the live QR token
 *
 * The raw AKV1 token is generated here and returned exactly once. Only its
 * SHA-256 hex is persisted (via issue_voucher_presentation_atomic). The raw
 * token is never stored, logged, or cached.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Pragma": "no-cache",
    },
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: voucherId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonNoStore({ error: "Unauthorized" }, 401);

  const admin = createAdminClient();

  // Resolve all linked wallets
  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id);
  const walletAddresses = (walletRows ?? []).map((r: { address: string }) => r.address.toLowerCase());

  // Generate secure token server-side — raw token never stored
  const rawBytes = new Uint8Array(32);
  crypto.getRandomValues(rawBytes);
  const base64url = btoa(String.fromCharCode(...rawBytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const rawToken = `AKV1.${base64url}`;

  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  const expiresAt = new Date(Date.now() + 115_000).toISOString(); // 115s < 120s limit

  const { data, error } = await admin.rpc("issue_voucher_presentation_atomic", {
    p_voucher_id:       voucherId,
    p_hub_user_id:      user.id,
    p_wallet_addresses: walletAddresses,
    p_token_hash:       tokenHash,
    p_token_expires_at: expiresAt,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("NOT_OWNER"))               return jsonNoStore({ error: "Not authorized" }, 403);
    if (msg.includes("ALREADY_REDEEMED"))        return jsonNoStore({ error: "Voucher already redeemed" }, 409);
    if (msg.includes("VOUCHER_VOID"))            return jsonNoStore({ error: "Voucher is void" }, 409);
    if (msg.includes("VOUCHER_NOT_PRESENTABLE")) return jsonNoStore({ error: "Voucher cannot be presented" }, 409);
    console.error("[presentation POST]", error);
    return jsonNoStore({ error: "Failed to generate token" }, 500);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.ok) return jsonNoStore({ error: "Voucher cannot be presented" }, 409);

  // Return raw token once — never cache
  return jsonNoStore({
    token: rawToken, expires_at: expiresAt, token_version: row.token_version,
    offer_title: row.offer_title, voucher_type: row.voucher_type,
    merchant_name: row.merchant_name, discount_percent: row.discount_percent,
    discount_cusd: row.discount_cusd, applicable_category: row.applicable_category,
    merchant_id: row.merchant_id,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: voucherId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonNoStore({ error: "Unauthorized" }, 401);

  const admin = createAdminClient();

  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id);
  const walletAddresses = (walletRows ?? []).map((r: { address: string }) => r.address.toLowerCase());

  const { error } = await admin.rpc("revoke_voucher_presentation_atomic", {
    p_voucher_id:       voucherId,
    p_hub_user_id:      user.id,
    p_wallet_addresses: walletAddresses,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("NOT_OWNER")) return jsonNoStore({ error: "Not authorized" }, 403);
    console.error("[presentation DELETE]", error);
    return jsonNoStore({ error: "Failed to revoke" }, 500);
  }

  return jsonNoStore({ ok: true });
}
