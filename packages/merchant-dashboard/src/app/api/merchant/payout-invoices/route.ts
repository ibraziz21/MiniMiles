// GET  /api/merchant/payout-invoices   — list all payout invoices for this partner
// POST /api/merchant/payout-invoices   — create or submit a payout invoice
//
// POST body (create draft):
//   { action: "create", period_month: "YYYY-MM", notes?: string }
//
// POST body (submit existing draft):
//   { action: "submit", invoice_id: string }

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { PayoutInvoice } from "@/types";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("payout_invoices")
    .select("*")
    .eq("partner_id", session.partnerId)
    .order("period_month", { ascending: false });

  if (error) {
    console.error("[payout-invoices] list error:", error);
    return NextResponse.json({ error: "Failed to load invoices" }, { status: 500 });
  }

  return NextResponse.json({ invoices: (data ?? []) as PayoutInvoice[] });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "Missing action" }, { status: 400 });

  // ── create draft ──────────────────────────────────────────────────────────
  if (body.action === "create") {
    const period_month: string = body.period_month;
    if (!/^\d{4}-\d{2}$/.test(period_month)) {
      return NextResponse.json({ error: "Invalid period_month. Use YYYY-MM." }, { status: 400 });
    }

    // Compute order count and gross from completed orders in this period
    const periodStart = `${period_month}-01T00:00:00.000Z`;
    const [y, m] = period_month.split("-").map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    const periodEnd = `${nextMonth}-01T00:00:00.000Z`;

    const { data: txs, error: txErr } = await supabase
      .from("merchant_transactions")
      .select("amount_cusd")
      .eq("partner_id", session.partnerId)
      .in("status", ["delivered", "received", "completed"])
      .gte("created_at", periodStart)
      .lt("created_at", periodEnd);

    if (txErr) {
      console.error("[payout-invoices] tx query error:", txErr);
      return NextResponse.json({ error: "Failed to compute period totals" }, { status: 500 });
    }

    const order_count = txs?.length ?? 0;
    const gross_cusd = Math.round(
      (txs ?? []).reduce((acc, t) => acc + (t.amount_cusd ?? 0), 0) * 100,
    ) / 100;

    const { data: inv, error: insertErr } = await supabase
      .from("payout_invoices")
      .insert({
        partner_id: session.partnerId,
        period_month,
        order_count,
        gross_cusd,
        notes: body.notes ?? null,
        status: "draft",
        created_by: session.merchantUserId,
      })
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        return NextResponse.json(
          { error: `An invoice for ${period_month} already exists.` },
          { status: 409 },
        );
      }
      console.error("[payout-invoices] insert error:", insertErr);
      return NextResponse.json({ error: "Failed to create invoice" }, { status: 500 });
    }

    return NextResponse.json({ invoice: inv as PayoutInvoice }, { status: 201 });
  }

  // ── submit draft ─────────────────────────────────────────────────────────
  if (body.action === "submit") {
    const invoice_id: string = body.invoice_id;
    if (!invoice_id) return NextResponse.json({ error: "Missing invoice_id" }, { status: 400 });

    // Fetch and verify ownership + status
    const { data: existing, error: fetchErr } = await supabase
      .from("payout_invoices")
      .select("*")
      .eq("id", invoice_id)
      .eq("partner_id", session.partnerId)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (existing.status !== "draft") {
      return NextResponse.json(
        { error: `Cannot submit an invoice with status '${existing.status}'.` },
        { status: 409 },
      );
    }

    const { data: updated, error: updateErr } = await supabase
      .from("payout_invoices")
      .update({
        status: "submitted",
        submitted_by: session.merchantUserId,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", invoice_id)
      .eq("partner_id", session.partnerId)
      .select()
      .single();

    if (updateErr) {
      console.error("[payout-invoices] submit error:", updateErr);
      return NextResponse.json({ error: "Failed to submit invoice" }, { status: 500 });
    }

    return NextResponse.json({ invoice: updated as PayoutInvoice });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
