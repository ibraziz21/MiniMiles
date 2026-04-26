// PATCH /api/admin/invoices/[id]
// Resolves a submitted payout invoice as paid or rejected.
//
// Protected by ADMIN_SECRET header. AkibaMiles internal use only.
//
// Request body:
//   { status: "paid" | "rejected", akiba_notes?: string }

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendInvoiceResolvedEmail } from "@/lib/notify";
import type { PayoutInvoice } from "@/types";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("x-admin-secret");
  if (!ADMIN_SECRET || authHeader !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invoiceId = params.id;
  if (!invoiceId) return NextResponse.json({ error: "Missing invoice id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const status: "paid" | "rejected" = body?.status;
  if (status !== "paid" && status !== "rejected") {
    return NextResponse.json(
      { error: "status must be 'paid' or 'rejected'" },
      { status: 400 },
    );
  }

  const akiba_notes: string | null = body?.akiba_notes ?? null;

  // ── Fetch & validate ────────────────────────────────────────────────────────
  const { data: existing, error: fetchErr } = await supabase
    .from("payout_invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (existing.status !== "submitted") {
    return NextResponse.json(
      { error: `Cannot resolve an invoice with status '${existing.status}'. Must be 'submitted'.` },
      { status: 409 },
    );
  }

  // ── Update ──────────────────────────────────────────────────────────────────
  const { data: updated, error: updateErr } = await supabase
    .from("payout_invoices")
    .update({
      status,
      akiba_notes,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .select()
    .single();

  if (updateErr) {
    console.error("[admin/invoices] resolve error:", updateErr);
    return NextResponse.json({ error: "Failed to resolve invoice" }, { status: 500 });
  }

  // ── Notify merchant ─────────────────────────────────────────────────────────
  sendInvoiceResolvedEmail({
    partnerId: existing.partner_id,
    periodMonth: existing.period_month,
    status,
    akibaNotes: akiba_notes,
    grossCusd: existing.gross_cusd,
  }).catch((e) => console.error("[admin/invoices] resolution email failed:", e));

  return NextResponse.json({ invoice: updated as PayoutInvoice });
}
