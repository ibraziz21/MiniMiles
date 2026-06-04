/**
 * GET  /api/merchant/settings?slug=<slug>       — fetch settings
 * POST /api/merchant/settings?slug=<slug>       — update payout_wallet and/or kes_exchange_rate
 *
 * Auth: x-merchant-secret header (same as billing route).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function resolveAndAuth(
  req: NextRequest,
  slug: string
): Promise<{ partnerId: string } | null> {
  const { data: partner } = await supabase
    .from("partners")
    .select("id")
    .eq("slug", slug)
    .single();
  if (!partner) return null;

  const secret =
    req.headers.get("x-merchant-secret") ??
    req.nextUrl.searchParams.get("secret") ??
    "";
  const ok =
    (process.env.MERCHANT_API_SECRET && secret === process.env.MERCHANT_API_SECRET) ||
    await (async () => {
      const { data } = await supabase
        .from("partner_settings")
        .select("api_secret")
        .eq("partner_id", partner.id)
        .maybeSingle();
      return !!data?.api_secret && secret === data.api_secret;
    })();

  return ok ? { partnerId: partner.id } : null;
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const auth = await resolveAndAuth(req, slug);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("partner_settings")
    .select("payout_wallet, kes_exchange_rate, logo_url, store_active, delivery_cities")
    .eq("partner_id", auth.partnerId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "db-error" }, { status: 500 });

  return NextResponse.json({ settings: data ?? {} });
}

export async function POST(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const auth = await resolveAndAuth(req, slug);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if ("payout_wallet" in body) {
    const w = body.payout_wallet;
    if (w !== null && (typeof w !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(w))) {
      return NextResponse.json({ error: "invalid payout_wallet — must be a 0x address or null" }, { status: 400 });
    }
    patch.payout_wallet = w ?? null;
  }

  if ("kes_exchange_rate" in body) {
    const r = Number(body.kes_exchange_rate);
    if (isNaN(r) || r <= 0 || r > 10000) {
      return NextResponse.json({ error: "kes_exchange_rate must be a positive number" }, { status: 400 });
    }
    patch.kes_exchange_rate = r;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  const { error } = await supabase
    .from("partner_settings")
    .update(patch)
    .eq("partner_id", auth.partnerId);

  if (error) {
    console.error("[merchant/settings POST]", error);
    return NextResponse.json({ error: "db-error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: Object.keys(patch) });
}
