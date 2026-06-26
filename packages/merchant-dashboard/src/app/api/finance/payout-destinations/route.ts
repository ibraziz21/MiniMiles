/**
 * Merchant payout destinations.
 * GET  — list this partner's destinations (never returns encrypted_destination).
 * POST — register a new destination (encrypted server-side, pending admin approval).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { encryptDestinationDetails, redactDestination } from "@/lib/payout/encryption";

const VALID_TYPES = new Set(["mpesa", "bank", "celo_wallet", "manual"]);
const VALID_CURRENCIES = new Set(["KES", "USD", "cUSD"]);

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("merchant_payout_destinations")
    .select(
      "id, partner_id, destination_type, display_name, currency, destination_summary, is_active, verified_at, approved_at, last_modified_at, created_at",
    )
    .eq("partner_id", session.partnerId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to load destinations" }, { status: 500 });
  }
  return NextResponse.json(
    { destinations: data ?? [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["owner", "manager"].includes(session.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const destinationType = typeof body.destination_type === "string" ? body.destination_type : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  const currency = typeof body.currency === "string" ? body.currency : "";
  const details =
    body.destination_details && typeof body.destination_details === "object"
      ? (body.destination_details as Record<string, string>)
      : null;
  const previousVersionId =
    typeof body.previous_version_id === "string" ? body.previous_version_id : null;

  if (!VALID_TYPES.has(destinationType)) {
    return NextResponse.json({ error: "Invalid destination_type" }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: "display_name is required" }, { status: 400 });
  }
  if (!VALID_CURRENCIES.has(currency)) {
    return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
  }
  if (!details || Object.keys(details).length === 0) {
    return NextResponse.json({ error: "destination_details are required" }, { status: 400 });
  }

  let encrypted;
  try {
    encrypted = encryptDestinationDetails(details);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  const summary = redactDestination(destinationType, details);

  const { data, error } = await supabase.rpc("register_payout_destination", {
    p_partner_id: session.partnerId,
    p_destination_type: destinationType,
    p_display_name: displayName,
    p_currency: currency,
    p_encrypted_destination: encrypted,
    p_destination_summary: summary,
    p_merchant_user_id: session.merchantUserId,
    p_created_by: session.email,
    p_previous_version_id: previousVersionId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  const row = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    id: row?.destination_id ?? null,
    display_name: displayName,
    destination_summary: summary,
    is_active: false,
    pending_approval: true,
  });
}
