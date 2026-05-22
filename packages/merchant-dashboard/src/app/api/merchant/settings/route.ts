// GET   /api/merchant/settings  — fetch partner settings (creates defaults if not exists)
// PATCH /api/merchant/settings  — update settings (owner only)

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

const DEFAULT_SETTINGS = {
  store_active: true,
  logo_url: null,
  support_email: null,
  support_phone: null,
  delivery_cities: ["Nairobi", "Mombasa"],
  notify_new_order: true,
  notify_stale_order: true,
  stale_threshold_hours: 2,
  payout_destination_type: "wallet",
};

const PAYOUT_DESTINATION_TYPES = new Set(["wallet", "bank", "mpesa"]);
const OPTIONAL_TEXT_FIELDS = [
  "logo_url",
  "support_email",
  "support_phone",
  "wallet_address",
  "payout_wallet",
  "payout_bank_name",
  "payout_bank_branch",
  "payout_bank_account_name",
  "payout_bank_account_number",
  "payout_mpesa_name",
  "payout_mpesa_phone",
  "payout_notes",
] as const;

async function getOrCreateSettings(partnerId: string) {
  const { data } = await supabase
    .from("partner_settings")
    .select("*")
    .eq("partner_id", partnerId)
    .maybeSingle();

  if (data) return data;

  // Create defaults
  const { data: created } = await supabase
    .from("partner_settings")
    .insert({ partner_id: partnerId, ...DEFAULT_SETTINGS })
    .select("*")
    .single();

  return created;
}

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getOrCreateSettings(session.partnerId);
  return NextResponse.json({ settings });
}

export async function PATCH(req: Request) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.role !== "owner") {
    return NextResponse.json({ error: "Only owners can modify settings" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowed = [
    "store_active", "logo_url", "support_email", "support_phone",
    "delivery_cities", "notify_new_order", "notify_stale_order", "stale_threshold_hours",
    "wallet_address", "payout_destination_type", "payout_wallet",
    "payout_bank_name", "payout_bank_branch", "payout_bank_account_name", "payout_bank_account_number",
    "payout_mpesa_name", "payout_mpesa_phone", "payout_notes", "kes_exchange_rate",
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Validate delivery_cities if present
  if ("delivery_cities" in updates) {
    if (!Array.isArray(updates.delivery_cities) || updates.delivery_cities.some((c) => typeof c !== "string")) {
      return NextResponse.json({ error: "delivery_cities must be an array of strings" }, { status: 400 });
    }
    updates.delivery_cities = [...new Set((updates.delivery_cities as string[]).map((c) => c.trim()).filter(Boolean))];
    if ((updates.delivery_cities as string[]).length === 0) {
      return NextResponse.json({ error: "delivery_cities cannot be empty" }, { status: 400 });
    }
  }

  for (const key of OPTIONAL_TEXT_FIELDS) {
    if (key in updates) {
      if (updates[key] !== null && typeof updates[key] !== "string") {
        return NextResponse.json({ error: `${key} must be a string or null` }, { status: 400 });
      }
      const trimmed = typeof updates[key] === "string" ? updates[key].trim() : null;
      updates[key] = trimmed || null;
      if (typeof trimmed === "string" && trimmed.length > 500) {
        return NextResponse.json({ error: `${key} is too long` }, { status: 400 });
      }
    }
  }

  for (const addrKey of ["wallet_address", "payout_wallet"] as const) {
    if (addrKey in updates) {
      if (updates[addrKey] && !/^0x[0-9a-fA-F]{40}$/.test(updates[addrKey] as string)) {
        return NextResponse.json({ error: `${addrKey} must be a valid EVM address (0x...)` }, { status: 400 });
      }
    }
  }

  if ("payout_destination_type" in updates) {
    if (
      typeof updates.payout_destination_type !== "string" ||
      !PAYOUT_DESTINATION_TYPES.has(updates.payout_destination_type)
    ) {
      return NextResponse.json(
        { error: "payout_destination_type must be wallet, bank, or mpesa" },
        { status: 400 },
      );
    }
  }

  if (updates.payout_mpesa_phone && !/^\+?[0-9][0-9\s-]{6,20}$/.test(updates.payout_mpesa_phone as string)) {
    return NextResponse.json({ error: "payout_mpesa_phone must be a valid phone number" }, { status: 400 });
  }

  if ("kes_exchange_rate" in updates) {
    const rate = Number(updates.kes_exchange_rate);
    if (updates.kes_exchange_rate !== null && (isNaN(rate) || rate <= 0 || rate > 10000)) {
      return NextResponse.json({ error: "kes_exchange_rate must be a positive number" }, { status: 400 });
    }
    updates.kes_exchange_rate = updates.kes_exchange_rate === null ? null : rate;
  }

  if ("stale_threshold_hours" in updates) {
    const threshold = Number(updates.stale_threshold_hours);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 168) {
      return NextResponse.json(
        { error: "stale_threshold_hours must be an integer between 1 and 168" },
        { status: 400 },
      );
    }
    updates.stale_threshold_hours = threshold;
  }

  // Ensure row exists
  await getOrCreateSettings(session.partnerId);

  const { data, error } = await supabase
    .from("partner_settings")
    .update(updates)
    .eq("partner_id", session.partnerId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });

  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId: session.partnerId,
    action: "settings.updated",
    metadata: { changes: updates },
  });

  return NextResponse.json({ settings: data });
}
