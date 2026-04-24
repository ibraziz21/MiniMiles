// GET /api/Spend/vouchers/user/[address]
// Returns all vouchers (non-void) for the authenticated user.
// Session is required and must match the requested address.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { requireSession } from "@/lib/auth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { address: rawAddress } = await params;
  const address = rawAddress?.toLowerCase();
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  // Users may only fetch their own vouchers
  if (session.walletAddress.toLowerCase() !== address) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Step 1: fetch vouchers (no join — avoids FK auto-detection issues)
  const { data: vouchers, error: vErr } = await supabase
    .from("issued_vouchers")
    .select("id, code, qr_payload, status, created_at, voucher_template_id, merchant_id")
    .eq("user_address", address)
    .neq("status", "void")
    .order("created_at", { ascending: false });

  if (vErr) {
    console.error("[GET /vouchers/user] vouchers query", vErr);
    return NextResponse.json({ error: "Failed to fetch vouchers" }, { status: 500 });
  }

  if (!vouchers || vouchers.length === 0) {
    return NextResponse.json({ vouchers: [] });
  }

  // Step 2: fetch templates for those vouchers
  const templateIds = [
    ...new Set(vouchers.map((v: any) => v.voucher_template_id).filter(Boolean)),
  ];

  const { data: templates, error: tErr } = await supabase
    .from("spend_voucher_templates")
    .select(
      "id, title, voucher_type, discount_percent, discount_cusd, applicable_category, merchant_id",
    )
    .in("id", templateIds);

  if (tErr) {
    console.error("[GET /vouchers/user] templates query", tErr);
  }

  // Step 3: fetch merchants (partners) for those templates
  const merchantIds = [
    ...new Set((templates ?? []).map((t: any) => t.merchant_id).filter(Boolean)),
  ];

  const { data: merchants, error: mErr } = merchantIds.length
    ? await supabase
        .from("partners")
        .select("id, name, slug, image_url")
        .in("id", merchantIds)
    : { data: [], error: null };

  if (mErr) {
    console.error("[GET /vouchers/user] merchants query", mErr);
  }

  const merchantMap = new Map((merchants ?? []).map((m: any) => [m.id, m]));
  const templateMap = new Map(
    (templates ?? []).map((t: any) => [
      t.id,
      { ...t, spend_merchants: merchantMap.get(t.merchant_id) ?? null },
    ]),
  );

  const enriched = vouchers.map((v: any) => {
    const tpl = templateMap.get(v.voucher_template_id);
    return {
      ...v,
      // Synthesize structured rules_snapshot from template so the UI can display discount info
      rules_snapshot: tpl
        ? {
            voucher_type: tpl.voucher_type,
            discount_percent: tpl.discount_percent ?? null,
            discount_cusd: tpl.discount_cusd ?? null,
            applicable_category: tpl.applicable_category ?? null,
          }
        : null,
      spend_voucher_templates: tpl ?? null,
    };
  });

  return NextResponse.json({ vouchers: enriched });
}
