import {
  readReferenceChunks,
  readAllRows as voucherReadAll,
} from "./readAllRows";
import { supabase } from "@/lib/supabase";

export interface VoucherReimbursementDashboard {
  balances: Array<{
    merchantId: string;
    merchantName: string;
    currency: "KES";
    outstandingMinor: number;
    batchedMinor: number;
    paidMinor: number;
    payoutReady: boolean;
  }>;
  unbatched: Array<{
    voucherRedemptionId: string;
    merchantId: string;
    merchantName: string;
    receiptReference: string;
    redeemedAt: string;
    amountMinor: number;
    payoutReady: boolean;
  }>;
  batches: Array<{
    batchId: string;
    merchantId: string;
    merchantName: string;
    state: "draft" | "submitted" | "paid" | "cancelled";
    itemCount: number;
    totalAmountMinor: number;
    paymentReference: string | null;
    paymentEvidenceRef: string | null;
    createdBy: string;
    createdAt: string;
    submittedAt: string | null;
    paidAt: string | null;
  }>;
  incidents: Array<{
    incidentId: string;
    incidentType: string;
    severity: "info" | "warning" | "critical";
    entityType: string;
    entityId: string;
    description: string;
    openedAt: string;
  }>;
}

export async function getVoucherReimbursementDashboard(): Promise<VoucherReimbursementDashboard> {
  const [payables, batches, incidents] = await Promise.all([
    voucherReadAll((from, to) =>
      supabase
        .from("v_unbatched_voucher_payables")
        .select(
          "voucher_redemption_id, merchant_id, currency, net_payable_minor, payout_ready"
        )
        .order("voucher_redemption_id")
        .range(from, to)
    ),
    voucherReadAll((from, to) =>
      supabase
        .from("v_partner_settlement_batches")
        .select(
          "id, merchant_id, currency, state, total_amount_minor, item_count, payment_reference, payment_evidence_ref, created_by, created_at, updated_at, paid_at"
        )
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    ),
    voucherReadAll((from, to) =>
      supabase
        .from("v_open_voucher_reconciliation_incidents")
        .select(
          "id, incident_type, severity, entity_type, entity_id, description, opened_at"
        )
        .order("id")
        .range(from, to)
    ),
  ]);
  const merchantIds = [
    ...new Set([
      ...payables.map((row) => row.merchant_id),
      ...batches.map((row) => row.merchant_id),
    ]),
  ];
  const redemptionIds = payables.map((row) => row.voucher_redemption_id);
  const [merchantRows, redemptionRows] = await Promise.all([
    readReferenceChunks(merchantIds, (chunk) =>
      supabase
        .from("partners")
        .select("id,name,payout_destination_approved")
        .in("id", chunk)
    ),
    readReferenceChunks(redemptionIds, (chunk) =>
      supabase
        .from("voucher_redemptions")
        .select("id,external_reference,redeemed_at")
        .in("id", chunk)
    ),
  ]);
  const merchants = new Map(merchantRows.map((row) => [row.id, row]));
  const redemptions = new Map(redemptionRows.map((row) => [row.id, row]));
  const balances = new Map<
    string,
    VoucherReimbursementDashboard["balances"][number]
  >();
  function balanceFor(merchantId: string) {
    const existing = balances.get(merchantId);
    if (existing) return existing;
    const merchant = merchants.get(merchantId);
    const created: VoucherReimbursementDashboard["balances"][number] = {
      merchantId,
      merchantName: merchant?.name ?? "Unknown merchant",
      currency: "KES",
      outstandingMinor: 0,
      batchedMinor: 0,
      paidMinor: 0,
      payoutReady: Boolean(merchant?.payout_destination_approved),
    };
    balances.set(merchantId, created);
    return created;
  }

  for (const payable of payables)
    balanceFor(payable.merchant_id).outstandingMinor += Number(
      payable.net_payable_minor ?? 0
    );
  for (const batch of batches) {
    const balance = balanceFor(batch.merchant_id);
    if (batch.state === "paid")
      balance.paidMinor += Number(batch.total_amount_minor ?? 0);
    if (batch.state === "draft" || batch.state === "submitted")
      balance.batchedMinor += Number(batch.total_amount_minor ?? 0);
  }

  return {
    balances: Array.from(balances.values()).sort(
      (a, b) => b.outstandingMinor - a.outstandingMinor
    ),
    unbatched: payables.map((row) => {
      const redemption = redemptions.get(row.voucher_redemption_id);
      return {
        voucherRedemptionId: row.voucher_redemption_id,
        merchantId: row.merchant_id,
        merchantName:
          merchants.get(row.merchant_id)?.name ?? "Unknown merchant",
        receiptReference:
          redemption?.external_reference ?? "No receipt reference",
        redeemedAt: redemption?.redeemed_at ?? "",
        amountMinor: Number(row.net_payable_minor ?? 0),
        payoutReady: Boolean(row.payout_ready),
      };
    }),
    batches: batches.map((row) => ({
      batchId: row.id,
      merchantId: row.merchant_id,
      merchantName: merchants.get(row.merchant_id)?.name ?? "Unknown merchant",
      state: row.state,
      itemCount: Number(row.item_count ?? 0),
      totalAmountMinor: Number(row.total_amount_minor ?? 0),
      paymentReference: row.payment_reference,
      paymentEvidenceRef: row.payment_evidence_ref,
      createdBy: row.created_by,
      createdAt: row.created_at,
      submittedAt:
        row.state === "submitted" || row.state === "paid"
          ? row.updated_at
          : null,
      paidAt: row.paid_at,
    })),
    incidents: incidents.map((row) => ({
      incidentId: row.id,
      incidentType: row.incident_type,
      severity: row.severity,
      entityType: row.entity_type,
      entityId: row.entity_id,
      description: row.description,
      openedAt: row.opened_at,
    })),
  };
}
