/**
 * GET /api/me/pass/resolve?passId={uuid}
 *
 * Resolves an Akiba Pass ID to a safe customer identity for reward issuance.
 * Called by the merchant dashboard after scanning a customer's QR code.
 *
 * The QR payload format is: akiba-pass:v1:{uuid}
 * Callers should strip the "akiba-pass:v1:" prefix before passing passId here.
 *
 * Authentication: Authorization: Bearer {AKIBA_API_KEY}
 *
 * Contract:
 *   Request:
 *     GET /api/me/pass/resolve?passId=<uuid>
 *     Authorization: Bearer <hub_platform_service_key>
 *
 *   Response 200:
 *     {
 *       "identityType": "email",
 *       "identityValue": "customer@example.com",
 *       "displayLabel": "Jane Doe",
 *       "userId": "<supabase-uuid>"
 *     }
 *
 *   Response 400: missing passId param
 *   Response 401: missing or invalid Authorization header
 *   Response 404: passId not found (or was regenerated)
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const AKIBA_API_KEY = process.env.AKIBA_API_KEY ?? "";

export async function GET(request: Request) {
  // ── Authenticate caller ────────────────────────────────────────────────────
  const auth = request.headers.get("Authorization") ?? "";
  const callerKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (!AKIBA_API_KEY || callerKey !== AKIBA_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse passId param ─────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const passId = searchParams.get("passId") ?? "";

  if (!passId) {
    return NextResponse.json({ error: "Missing passId param" }, { status: 400 });
  }

  // ── Look up by stable public_pass_id ──────────────────────────────────────
  const admin = createAdminClient();

  const { data: passRow } = await admin
    .from("hub_user_passes")
    .select("user_id, email")
    .eq("public_pass_id", passId)
    .maybeSingle();

  if (!passRow) {
    return NextResponse.json(
      { error: "Pass not found — QR may have been regenerated" },
      { status: 404 },
    );
  }

  // ── Fetch display name from Hub users table ────────────────────────────────
  const { data: userRow } = await admin
    .from("users")
    .select("full_name, username")
    .eq("email", passRow.email)
    .maybeSingle();

  const displayLabel =
    userRow?.full_name ?? userRow?.username ?? passRow.email;

  return NextResponse.json({
    identityType: "email",
    identityValue: passRow.email,
    displayLabel,
    userId: passRow.user_id,
  });
}
