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
};

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
    "wallet_address",
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

  if ("wallet_address" in updates) {
    if (updates.wallet_address !== null && typeof updates.wallet_address !== "string") {
      return NextResponse.json({ error: "wallet_address must be a string or null" }, { status: 400 });
    }
    // Basic EVM address format check
    if (updates.wallet_address && !/^0x[0-9a-fA-F]{40}$/.test(updates.wallet_address as string)) {
      return NextResponse.json({ error: "wallet_address must be a valid EVM address (0x...)" }, { status: 400 });
    }
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
