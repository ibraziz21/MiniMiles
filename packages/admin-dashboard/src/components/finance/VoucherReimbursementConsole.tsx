"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, FileCheck2, Landmark, Loader2, ReceiptText, ShieldAlert, WalletCards } from "lucide-react";
import type { VoucherReimbursementDashboard } from "@/lib/voucherReimbursements";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { cn, formatDateTime, formatMoney, minorToMajor } from "@/lib/utils";

type Batch = VoucherReimbursementDashboard["batches"][number];

const STATE_VARIANT: Record<Batch["state"], "secondary" | "warning" | "success" | "destructive"> = {
  draft: "secondary",
  submitted: "warning",
  paid: "success",
  cancelled: "destructive",
};

export function VoucherReimbursementConsole({ data, canWrite, canMarkPaid }: { data: VoucherReimbursementDashboard; canWrite: boolean; canMarkPaid: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [pendingBatch, setPendingBatch] = useState<Batch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentEvidenceRef, setPaymentEvidenceRef] = useState("");
  const [confirmedTotal, setConfirmedTotal] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const selectedRows = useMemo(() => data.unbatched.filter((row) => selected.has(row.voucherRedemptionId)), [data.unbatched, selected]);
  const selectedMerchantId = selectedRows[0]?.merchantId ?? null;
  const selectedTotalMinor = selectedRows.reduce((sum, row) => sum + row.amountMinor, 0);
  const openBatchTotal = data.batches.filter((batch) => batch.state === "draft" || batch.state === "submitted").reduce((sum, batch) => sum + batch.totalAmountMinor, 0);
  const paidTotal = data.batches.filter((batch) => batch.state === "paid").reduce((sum, batch) => sum + batch.totalAmountMinor, 0);

  function togglePayable(id: string, merchantId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else {
        if (selectedMerchantId && selectedMerchantId !== merchantId) next.clear();
        next.add(id);
      }
      return next;
    });
  }

  async function runAction(payload: Record<string, unknown>, message: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/voucher-reimbursements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Reimbursement action failed.");
      setSuccess(message);
      setSelected(new Set());
      setPendingBatch(null);
      setPaymentReference("");
      setPaymentEvidenceRef("");
      setConfirmedTotal("");
      setCancelReason("");
      router.refresh();
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FinanceMetric label="Unbatched payables" value={formatMoney(minorToMajor(data.unbatched.reduce((sum, row) => sum + row.amountMinor, 0)), "KES")} icon={ReceiptText} tone="warning" />
        <FinanceMetric label="In payment runs" value={formatMoney(minorToMajor(openBatchTotal), "KES")} icon={WalletCards} />
        <FinanceMetric label="Recorded paid" value={formatMoney(minorToMajor(paidTotal), "KES")} icon={CheckCircle2} tone="success" />
      </div>

      {(error || success) && <div role={error ? "alert" : "status"} className={cn("rounded-card border px-4 py-3 text-sm", error ? "border-danger/25 bg-danger/[0.04] text-danger" : "border-success/25 bg-success/[0.04] text-success")}>{error ?? success}</div>}

      <Tabs defaultValue="balances">
        <TabsList aria-label="Voucher reimbursement views">
          <TabsTrigger value="balances">Balances <Count value={data.balances.length} /></TabsTrigger>
          <TabsTrigger value="payables">Payables <Count value={data.unbatched.length} /></TabsTrigger>
          <TabsTrigger value="batches">Batches <Count value={data.batches.length} /></TabsTrigger>
          <TabsTrigger value="incidents">Incidents <Count value={data.incidents.length} tone={data.incidents.length > 0 ? "danger" : "neutral"} /></TabsTrigger>
        </TabsList>

        <TabsContent value="balances">
          <Card className="overflow-hidden border-border shadow-none">
            {data.balances.length === 0 ? <EmptyFinance message="No reimbursement balances yet." /> : (
              <ul className="divide-y divide-border">
                {data.balances.map((balance) => (
                  <li key={balance.merchantId} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(110px,auto))] sm:items-center sm:px-5">
                    <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-ink">{balance.merchantName}</p><Badge variant={balance.payoutReady ? "success" : "warning"}>{balance.payoutReady ? "Payout ready" : "Destination needed"}</Badge></div><p className="mt-1 text-xs text-ink-muted">KES reimbursement account</p></div>
                    <MoneyDatum label="Unbatched" amount={balance.outstandingMinor} />
                    <MoneyDatum label="In batches" amount={balance.batchedMinor} />
                    <MoneyDatum label="Paid" amount={balance.paidMinor} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="payables">
          <Card className="overflow-hidden border-border shadow-none">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div><h2 className="text-sm font-semibold text-ink">Unbatched merchant payables</h2><p className="text-xs text-ink-muted">Select payout-ready items from one merchant per batch.</p></div>
              {canWrite && <Button disabled={selected.size === 0 || busy} onClick={() => setConfirmBatch(true)} className="min-h-11 sm:min-h-9"><FileCheck2 className="h-4 w-4" aria-hidden="true" />Create batch · {formatMoney(minorToMajor(selectedTotalMinor), "KES")}</Button>}
            </div>
            {data.unbatched.length === 0 ? <EmptyFinance message="No unbatched voucher payables." /> : (
              <ul className="divide-y divide-border">
                {data.unbatched.map((row) => {
                  const disabled = !canWrite || !row.payoutReady || Boolean(selectedMerchantId && selectedMerchantId !== row.merchantId);
                  return (
                    <li key={row.voucherRedemptionId} className="flex min-h-[68px] items-center gap-3 px-4 py-3 sm:px-5">
                      {canWrite && <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-control hover:bg-surface-subtle"><input type="checkbox" name={`payable-${row.voucherRedemptionId}`} checked={selected.has(row.voucherRedemptionId)} disabled={disabled} onChange={() => togglePayable(row.voucherRedemptionId, row.merchantId)} aria-label={`Select ${row.receiptReference} for ${row.merchantName}`} className="h-5 w-5 rounded border-border text-primary focus:ring-primary disabled:cursor-not-allowed" /></label>}
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{row.merchantName}</p><p className="truncate text-xs text-ink-muted">{row.receiptReference} · {formatDateTime(row.redeemedAt)}</p></div>
                      {!row.payoutReady && <Badge variant="warning">Payout blocked</Badge>}
                      <p className="text-sm font-semibold tabular-nums text-ink">{formatMoney(minorToMajor(row.amountMinor), "KES")}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="batches">
          <div className="space-y-3">
            {data.batches.length === 0 ? <Card className="border-border shadow-none"><EmptyFinance message="No reimbursement batches yet." /></Card> : data.batches.map((batch) => (
              <Card key={batch.batchId} className="border-border p-4 shadow-none sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-ink">{batch.merchantName}</h2><Badge variant={STATE_VARIANT[batch.state]}>{batch.state}</Badge></div><p className="mt-1 text-xs text-ink-muted">{batch.itemCount} payable{batch.itemCount === 1 ? "" : "s"} · created {formatDateTime(batch.createdAt)}</p></div>
                  <p className="text-lg font-semibold tabular-nums text-ink">{formatMoney(minorToMajor(batch.totalAmountMinor), "KES")}</p>
                </div>
                {(batch.paymentReference || batch.paymentEvidenceRef) && <div className="mt-3 rounded-control bg-surface-subtle p-3 text-xs text-ink-muted">{batch.paymentReference && <p>Payment: <span className="font-medium text-ink">{batch.paymentReference}</span></p>}{batch.paymentEvidenceRef && <p className="mt-1 break-all">Evidence: {batch.paymentEvidenceRef}</p>}</div>}
                {canWrite && batch.state === "draft" && <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" onClick={() => setPendingBatch(batch)}>Submit batch</Button><details className="w-full rounded-control border border-border p-3 sm:max-w-md"><summary className="cursor-pointer text-sm font-medium text-danger">Cancel batch</summary><label className="mt-3 block text-xs font-medium text-ink" htmlFor={`cancel-${batch.batchId}`}>Cancellation reason</label><textarea id={`cancel-${batch.batchId}`} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={2} className="mt-1 w-full rounded-control border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" /><Button variant="destructive" size="sm" className="mt-2" disabled={busy || cancelReason.trim().length < 4} onClick={() => runAction({ action: "cancel_batch", batch_id: batch.batchId, reason: cancelReason }, "Batch cancelled.")}>Cancel batch</Button></details></div>}
                {canMarkPaid && batch.state === "submitted" && <details className="mt-4 rounded-card border border-primary/20 bg-primary/[0.03] p-4"><summary className="cursor-pointer text-sm font-semibold text-primary-strong">Record payment</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field id={`reference-${batch.batchId}`} label="Payment reference" value={paymentReference} onChange={setPaymentReference} /><Field id={`evidence-${batch.batchId}`} label="Evidence reference" value={paymentEvidenceRef} onChange={setPaymentEvidenceRef} /><Field id={`total-${batch.batchId}`} label={`Confirm exact total (${formatMoney(minorToMajor(batch.totalAmountMinor), "KES")})`} value={confirmedTotal} onChange={setConfirmedTotal} inputMode="decimal" /></div><Button className="mt-3" disabled={busy || !paymentReference.trim() || !paymentEvidenceRef.trim() || Math.round(Number(confirmedTotal) * 100) !== batch.totalAmountMinor} onClick={() => runAction({ action: "mark_paid", batch_id: batch.batchId, payment_reference: paymentReference, payment_evidence_ref: paymentEvidenceRef, confirmed_total_minor: Math.round(Number(confirmedTotal) * 100) }, "Payment recorded.")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}Record paid</Button></details>}
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="incidents">
          <div className="space-y-3">
            {data.incidents.length === 0 ? <Card className="border-success/25 bg-success/[0.04] p-4 shadow-none"><div className="flex items-center gap-3 text-sm font-medium text-ink"><CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />No open reimbursement incidents.</div></Card> : data.incidents.map((incident) => <Card key={incident.incidentId} className={cn("border-border p-4 shadow-none", incident.severity === "critical" && "border-danger/25 bg-danger/[0.03]")}><div className="flex gap-3"><ShieldAlert className={cn("mt-0.5 h-5 w-5 shrink-0", incident.severity === "critical" ? "text-danger" : "text-warning")} aria-hidden="true" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold capitalize text-ink">{incident.incidentType.replaceAll("_", " ")}</h2><Badge variant={incident.severity === "critical" ? "destructive" : "warning"}>{incident.severity}</Badge></div><p className="mt-1 text-sm leading-6 text-ink-muted">{incident.description}</p><p className="mt-2 text-xs text-ink-muted">Opened {formatDateTime(incident.openedAt)} · {incident.entityType} {incident.entityId.slice(0, 8)}</p></div><ArrowRight className="h-4 w-4 text-ink-muted" aria-hidden="true" /></div></Card>)}
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmActionDialog open={confirmBatch} onOpenChange={setConfirmBatch} title="Create reimbursement batch?" description={<p>Locks {selected.size} selected payable{selected.size === 1 ? "" : "s"} into a draft batch for <strong>{formatMoney(minorToMajor(selectedTotalMinor), "KES")}</strong>. The item set becomes immutable after submission.</p>} confirmLabel="Create draft batch" onConfirm={async () => { if (!selectedMerchantId) return; await runAction({ action: "create_batch", merchant_id: selectedMerchantId, voucher_redemption_ids: Array.from(selected) }, "Draft reimbursement batch created."); setConfirmBatch(false); }} />
      <ConfirmActionDialog open={Boolean(pendingBatch)} onOpenChange={(open) => !open && setPendingBatch(null)} title="Submit reimbursement batch?" description={<p>Submission locks this batch’s {pendingBatch?.itemCount ?? 0} payables and sends <strong>{formatMoney(minorToMajor(pendingBatch?.totalAmountMinor ?? 0), "KES")}</strong> into the payment queue.</p>} confirmLabel="Submit batch" onConfirm={async () => { if (!pendingBatch) return; await runAction({ action: "submit_batch", batch_id: pendingBatch.batchId }, "Batch submitted for payment."); }} />
    </div>
  );
}

function Count({ value, tone = "neutral" }: { value: number; tone?: "neutral" | "danger" }) { return <span className={cn("ml-1 rounded-full bg-surface-subtle px-1.5 py-0.5 text-[11px] tabular-nums", tone === "danger" && "bg-danger/10 text-danger")}>{value}</span>; }

function FinanceMetric({ label, value, icon: Icon, tone = "neutral" }: { label: string; value: string; icon: typeof Landmark; tone?: "neutral" | "warning" | "success" }) { return <Card className="border-border p-4 shadow-none"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-ink-muted">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums text-ink">{value}</p></div><span className={cn("flex h-9 w-9 items-center justify-center rounded-control bg-primary/10 text-primary", tone === "warning" && "bg-warning/10 text-warning", tone === "success" && "bg-success/10 text-success")}><Icon className="h-4 w-4" aria-hidden="true" /></span></div></Card>; }

function MoneyDatum({ label, amount }: { label: string; amount: number }) { return <div className="flex items-center justify-between gap-4 sm:block sm:text-right"><p className="text-xs text-ink-muted">{label}</p><p className="text-sm font-semibold tabular-nums text-ink">{formatMoney(minorToMajor(amount), "KES")}</p></div>; }

function EmptyFinance({ message }: { message: string }) { return <div className="flex min-h-36 flex-col items-center justify-center px-4 py-8 text-center"><Landmark className="h-6 w-6 text-ink-muted" aria-hidden="true" /><p className="mt-2 text-sm text-ink-muted">{message}</p></div>; }

function Field({ id, label, value, onChange, inputMode }: { id: string; label: string; value: string; onChange: (value: string) => void; inputMode?: "decimal" }) { return <div><label htmlFor={id} className="text-xs font-medium text-ink">{label}</label><input id={id} name={id} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} inputMode={inputMode} className="mt-1 min-h-11 w-full rounded-control border border-border bg-surface px-3 text-base text-ink focus:outline-none focus:ring-2 focus:ring-primary sm:text-sm" /></div>; }
