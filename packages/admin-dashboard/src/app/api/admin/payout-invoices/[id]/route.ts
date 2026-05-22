// PATCH /api/admin/payout-invoices/[id]
// Finance-admin payout resolution. Marks a payout invoice paid or rejected and
// records receipt/payment metadata for merchant-facing receipts.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { getAdminSettings } from "@/lib/adminSettings";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

const PAYMENT_METHODS = new Set(["wallet", "bank", "mpesa", "manual"]);

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function receiptNumber(prefix: string, periodMonth: string, id: string): string {
  return `${prefix}-${periodMonth}-${id.slice(0, 8).toUpperCase()}`;
}

function buildDestinationSnapshot(settings: Record<string, any> | null) {
  const type = settings?.payout_destination_type ?? (settings?.payout_wallet ? "wallet" : "wallet");

  if (type === "bank") {
    return {
      type: "bank",
      bank_name: settings?.payout_bank_name ?? null,
      bank_branch: settings?.payout_bank_branch ?? null,
      account_name: settings?.payout_bank_account_name ?? null,
      account_number: settings?.payout_bank_account_number ?? null,
      notes: settings?.payout_notes ?? null,
    };
  }

  if (type === "mpesa") {
    return {
      type: "mpesa",
      recipient_name: settings?.payout_mpesa_name ?? null,
      phone: settings?.payout_mpesa_phone ?? null,
      notes: settings?.payout_notes ?? null,
    };
  }

  return {
    type: "wallet",
    wallet: settings?.payout_wallet ?? settings?.wallet_address ?? null,
    notes: settings?.payout_notes ?? null,
  };
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invoiceId = params.id;
  if (!invoiceId) return NextResponse.json({ error: "Missing invoice id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const status = body?.status;
  if (status !== "paid" && status !== "rejected") {
    return NextResponse.json({ error: "status must be paid or rejected" }, { status: 400 });
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("payout_invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const appSettings = await getAdminSettings();

  if (!["draft", "submitted"].includes(existing.status)) {
    return NextResponse.json(
      { error: `Only draft or submitted invoices can be resolved. Current status: ${existing.status}` },
      { status: 409 },
    );
  }

  const akibaNotes = textOrNull(body?.akiba_notes);
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status,
    akiba_notes: akibaNotes,
    resolved_at: now,
    updated_at: now,
  };

  if (status === "paid") {
    const paymentMethod = textOrNull(body?.payment_method) ?? "manual";
    if (!PAYMENT_METHODS.has(paymentMethod)) {
      return NextResponse.json(
        { error: "payment_method must be wallet, bank, mpesa, or manual" },
        { status: 400 },
      );
    }
    if (
      paymentMethod !== "manual" &&
      !appSettings.finance.enabledPayoutMethods.includes(paymentMethod as "wallet" | "bank" | "mpesa")
    ) {
      return NextResponse.json(
        { error: `${paymentMethod} payouts are disabled in admin settings` },
        { status: 400 },
      );
    }
    if (
      appSettings.finance.payoutApprovalThreshold > 0 &&
      Number(existing.net_cusd ?? 0) >= appSettings.finance.payoutApprovalThreshold &&
      session.role !== "super_admin"
    ) {
      return NextResponse.json(
        { error: "This payout exceeds the super-admin approval threshold" },
        { status: 403 },
      );
    }

    const paymentTxHash = textOrNull(body?.payment_tx_hash);
    if (paymentTxHash && !/^0x[0-9a-fA-F]{64}$/.test(paymentTxHash)) {
      return NextResponse.json({ error: "payment_tx_hash must be a valid 0x transaction hash" }, { status: 400 });
    }

    const paymentReference = textOrNull(body?.payment_reference);
    if (paymentMethod === "wallet" && appSettings.finance.requireTxHashForWallet && !paymentTxHash) {
      return NextResponse.json(
        { error: "Wallet payouts require a transaction hash" },
        { status: 400 },
      );
    }
    if (!paymentTxHash && !paymentReference) {
      return NextResponse.json(
        { error: "Provide a payment reference or transaction hash for paid payouts" },
        { status: 400 },
      );
    }

    const { data: settings } = await supabase
      .from("partner_settings")
      .select("*")
      .eq("partner_id", existing.partner_id)
      .maybeSingle();

    update.payment_method = paymentMethod;
    update.payment_destination_snapshot = buildDestinationSnapshot(settings);
    update.payment_tx_hash = paymentTxHash;
    update.payment_reference = paymentReference;
    update.receipt_number = existing.receipt_number ?? receiptNumber(
      appSettings.finance.receiptPrefix,
      existing.period_month,
      existing.id,
    );
    update.paid_by_admin_user_id = adminIdForWrite(session);
    update.paid_at = now;
  }

  const { data: updated, error: updateErr } = await supabase
    .from("payout_invoices")
    .update(update)
    .eq("id", invoiceId)
    .select()
    .single();

  if (updateErr) {
    console.error("[admin/payout-invoices] update error:", updateErr);
    return NextResponse.json({ error: "Failed to update payout invoice" }, { status: 500 });
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: status === "paid" ? "payout_invoice.paid" : "payout_invoice.rejected",
    targetType: "payout_invoice",
    targetId: invoiceId,
    metadata: {
      status,
      payment_method: update.payment_method ?? null,
      payment_tx_hash: update.payment_tx_hash ?? null,
      payment_reference: update.payment_reference ?? null,
      receipt_number: update.receipt_number ?? null,
    },
  });

  return NextResponse.json({ invoice: updated });
}
