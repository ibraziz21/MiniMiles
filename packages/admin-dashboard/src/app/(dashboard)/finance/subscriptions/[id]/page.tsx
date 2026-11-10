import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import {
  VoucherFacts,
  voucherCard,
  VoucherStatus,
} from "@/components/vouchers/VoucherUi";
import { DetailHeader } from "@/components/shell/DetailHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SubscriptionPaymentReview } from "@/components/finance/SubscriptionPaymentReview";
import { formatDateTime } from "@/lib/utils";
import {
  formatAge,
  isStaleReview,
  isUuid,
  minutesSince,
  paymentMethodLabel,
  RISK_FLAG_LABELS,
  slaState,
  SUBSCRIPTION_PAYMENT_VIEWS,
  type AttemptStatus,
} from "@/lib/subscriptionPayments";

export const dynamic = "force-dynamic";

interface DetailRow {
  payment_attempt_id: string;
  status: AttemptStatus;
  version: number;
  submitted_at: string;
  submitted_amount: string | null;
  submitted_currency: string | null;
  payment_method: string | null;
  provider_reference_masked: string | null;
  payment_date: string | null;
  merchant_note: string | null;
  has_evidence: boolean | null;
  evidence_content_type: string | null;
  risk_flags: string[] | null;
  reviewer_admin_user_id: string | null;
  reviewer_name: string | null;
  review_started_at: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  merchant_safe_message: string | null;
  receipt_number: string | null;

  partner_id: string;
  merchant_name: string | null;
  subscription_id: string | null;
  subscription_plan: string | null;
  subscription_status: string | null;
  requested_plan: string | null;
  requested_term: string | null;
  requested_change: string | null;
  active_branch_count: number | null;
  founding_status: string | null;
  activation_date: string | null;
  renewal_date: string | null;

  invoice_id: string;
  invoice_number: string | null;
  invoice_type: string | null;
  invoice_status: string | null;
  invoice_created_at: string | null;
  invoice_issued_at: string | null;
  invoice_due_at: string | null;
  invoice_grace_deadline: string | null;
  service_period_start: string | null;
  service_period_end: string | null;
  pricing_version: string | null;
  line_items: Array<{ description: string; amount: string }> | null;
  subtotal: string | null;
  discount: string | null;
  tax: string | null;
  total: string | null;
  amount_paid: string | null;
  balance: string | null;
  expected_amount: string | null;
  short_payment_reference: string | null;
  ncba_destination_snapshot: Record<string, unknown> | null;
  pending_effect: string | null;
}

const STATUS_VARIANT: Record<
  string,
  "success" | "warning" | "destructive" | "secondary"
> = {
  submitted: "warning",
  under_review: "secondary",
  confirmed: "success",
  rejected: "destructive",
};

async function loadDetail(id: string) {
  const { data, error } = await supabase
    .from(SUBSCRIPTION_PAYMENT_VIEWS.detail)
    .select("*")
    .eq("payment_attempt_id", id)
    .maybeSingle();

  if (error) {
    console.error("[finance/subscriptions] detail error:", error.message);
    return null;
  }
  if (!data) return null;

  const detail = data as unknown as DetailRow;

  const [priorRes, refUsesRes] = await Promise.all([
    supabase
      .from(SUBSCRIPTION_PAYMENT_VIEWS.priorAttempts)
      .select("*")
      .eq("invoice_id", detail.invoice_id)
      .neq("payment_attempt_id", id)
      .order("submitted_at", { ascending: false }),
    supabase
      .from(SUBSCRIPTION_PAYMENT_VIEWS.referenceUses)
      .select("*")
      .eq("payment_attempt_id", id),
  ]);

  return {
    detail,
    priorAttempts: (priorRes.data ?? []) as Array<Record<string, unknown>>,
    referenceUses: (refUsesRes.data ?? []) as Array<Record<string, unknown>>,
  };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">
        {value ?? "—"}
      </span>
    </div>
  );
}

export default async function SubscriptionPaymentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireAdminSession("finance.read");
  if (!session) redirect("/login");
  if (!isUuid(params.id)) notFound();

  const loaded = await loadDetail(params.id);
  if (!loaded) notFound();

  const { detail, priorAttempts, referenceUses } = loaded;
  const canDecide =
    session.role === "super_admin" || session.role === "finance_admin";
  const isSuperAdmin = session.role === "super_admin";
  const ageMinutes = minutesSince(detail.submitted_at);
  const sla = slaState(detail.submitted_at);
  const claimedByMe = detail.reviewer_admin_user_id === session.adminUserId;
  const stale =
    detail.status === "under_review" && isStaleReview(detail.review_started_at);
  const flags = detail.risk_flags ?? [];

  return (
    <div className="min-h-screen bg-[#FAF8FF]">
      <VoucherHeader
        title="Review payment"
        backHref="/finance/subscriptions"
        name={session.name}
        role={session.role}
      />
      <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
        <section className={voucherCard}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">
              {detail.merchant_name ?? detail.partner_id}
            </h2>
            <VoucherStatus status={detail.status} />
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {detail.requested_plan ??
              detail.subscription_plan ??
              "Subscription"}{" "}
            · {detail.requested_term ?? ""}
          </p>
        </section>
        <section className={voucherCard}>
          <h3 className="mb-5 font-semibold">Payment details</h3>
          <VoucherFacts
            items={[
              {
                label: "Invoice",
                value: detail.invoice_number ?? detail.invoice_id,
              },
              {
                label: "Amount due",
                value: `KES ${detail.balance ?? detail.expected_amount ?? "—"}`,
              },
              {
                label: "Submitted",
                value: `${detail.submitted_currency ?? "KES"} ${
                  detail.submitted_amount ?? "—"
                }`,
              },
              {
                label: "Reference",
                value: detail.provider_reference_masked ?? "—",
              },
              {
                label: "Payment date",
                value: formatDateTime(detail.payment_date),
              },
              {
                label: "Method",
                value: paymentMethodLabel(detail.payment_method),
              },
            ]}
          />
          {detail.pending_effect && (
            <p className="mt-4 rounded-control bg-[#F2F3FF] p-3 text-sm">
              {detail.pending_effect}
            </p>
          )}
        </section>
        {!!flags.length && (
          <div role="status" className="rounded-card bg-warning/10 p-4 text-sm">
            {flags.map((f) => RISK_FLAG_LABELS[f] ?? f).join(" · ")}
          </div>
        )}
        <section className={voucherCard}>
          <SubscriptionPaymentReview
            attemptId={detail.payment_attempt_id}
            version={detail.version}
            status={detail.status}
            canDecide={canDecide}
            isSuperAdmin={isSuperAdmin}
            claimedByMe={claimedByMe}
            claimedByName={detail.reviewer_name}
            staleClaim={stale}
            hasEvidence={Boolean(detail.has_evidence)}
            expectedAmount={detail.expected_amount}
            balance={detail.balance}
            submittedAmount={detail.submitted_amount}
            providerReferenceMasked={detail.provider_reference_masked}
            paymentDate={detail.payment_date}
          />
        </section>
        <details className={voucherCard}>
          <summary className="min-h-11 cursor-pointer py-2 font-medium">
            Full invoice & subscription
          </summary>
          <div className="mt-4 space-y-4">
            {" "}
            {/* 7.1 Merchant and subscription */}
            <Card>
              <CardHeader>
                <CardTitle>Merchant &amp; subscription</CardTitle>
              </CardHeader>
              <CardContent>
                <Row
                  label="Merchant"
                  value={detail.merchant_name ?? detail.partner_id}
                />
                <Row
                  label="Partner ID"
                  value={
                    <span className="font-mono text-xs">
                      {detail.partner_id}
                    </span>
                  }
                />
                <Row
                  label="Current plan / status"
                  value={`${detail.subscription_plan ?? "—"} · ${
                    detail.subscription_status ?? "—"
                  }`}
                />
                <Row
                  label="Requested plan / term"
                  value={`${detail.requested_plan ?? "—"} · ${
                    detail.requested_term ?? "—"
                  }`}
                />
                <Row label="Requested change" value={detail.requested_change} />
                <Row
                  label="Active branches"
                  value={detail.active_branch_count}
                />
                <Row label="Founding status" value={detail.founding_status} />
                <Row
                  label="Activation date"
                  value={formatDateTime(detail.activation_date)}
                />
                <Row
                  label="Renewal date"
                  value={formatDateTime(detail.renewal_date)}
                />
                <Link
                  href={`/merchants/${detail.partner_id}`}
                  className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                >
                  Open merchant detail
                </Link>
              </CardContent>
            </Card>
            {/* 7.2 Invoice */}
            <Card>
              <CardHeader>
                <CardTitle>Invoice</CardTitle>
              </CardHeader>
              <CardContent>
                <Row
                  label="Number / type"
                  value={`${detail.invoice_number ?? "—"} · ${
                    detail.invoice_type ?? "—"
                  }`}
                />
                <Row label="Status" value={detail.invoice_status} />
                <Row
                  label="Created"
                  value={formatDateTime(detail.invoice_created_at)}
                />
                <Row
                  label="Issued"
                  value={formatDateTime(detail.invoice_issued_at)}
                />
                <Row
                  label="Due"
                  value={formatDateTime(detail.invoice_due_at)}
                />
                <Row
                  label="Grace deadline"
                  value={formatDateTime(detail.invoice_grace_deadline)}
                />
                <Row
                  label="Service period"
                  value={`${formatDateTime(
                    detail.service_period_start
                  )} → ${formatDateTime(detail.service_period_end)}`}
                />
                <Row label="Pricing version" value={detail.pricing_version} />
                <div className="my-2 border-t border-slate-100" />
                {(detail.line_items ?? []).map((li, i) => (
                  <Row
                    key={i}
                    label={li.description}
                    value={`KES ${li.amount}`}
                  />
                ))}
                <Row
                  label="Subtotal"
                  value={`KES ${detail.subtotal ?? "0.00"}`}
                />
                <Row
                  label="Discount"
                  value={`KES ${detail.discount ?? "0.00"}`}
                />
                <Row
                  label="VAT"
                  value={
                    detail.tax == null
                      ? "Not supplied by Akiba Platform"
                      : `KES ${detail.tax}`
                  }
                />
                <Row
                  label="Total"
                  value={<strong>KES {detail.total ?? "0.00"}</strong>}
                />
                <Row
                  label="Paid / balance"
                  value={`KES ${detail.amount_paid ?? "0.00"} / KES ${
                    detail.balance ?? "0.00"
                  }`}
                />
                <div className="my-2 border-t border-slate-100" />
                <Row
                  label="Expected short reference"
                  value={
                    <span className="font-mono">
                      {detail.short_payment_reference ?? "—"}
                    </span>
                  }
                />
                <Row
                  label="Expected amount"
                  value={
                    <span className="font-mono">
                      KES {detail.expected_amount ?? "—"}
                    </span>
                  }
                />
                {detail.ncba_destination_snapshot && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-slate-600">
                      NCBA destination snapshot
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                      {JSON.stringify(
                        detail.ncba_destination_snapshot,
                        null,
                        2
                      )}
                    </pre>
                  </details>
                )}
                {detail.pending_effect && (
                  <p className="mt-2 rounded-card bg-primary/10 p-2 text-xs text-primary-strong">
                    On confirm: {detail.pending_effect}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </details>
        <details className={voucherCard}>
          <summary className="min-h-11 cursor-pointer py-2 font-medium">
            Invoice & review history
          </summary>
          <div className="mt-4 space-y-3 break-words text-sm">
            <p>Invoice status: {detail.invoice_status}</p>
            <p>Reviewer: {detail.reviewer_name ?? "Unclaimed"}</p>
            <p>{detail.merchant_note}</p>
            <p>{detail.merchant_safe_message}</p>
            <p>{detail.decision_reason}</p>
            <p>Due: {formatDateTime(detail.invoice_due_at)}</p>
            <p>Grace ends: {formatDateTime(detail.invoice_grace_deadline)}</p>
            {priorAttempts.map((p, i) => (
              <p key={i}>
                {String(p.status)} ·{" "}
                {formatDateTime(String(p.submitted_at ?? ""))}
              </p>
            ))}
            {referenceUses.map((u, i) => (
              <p key={i} className="text-danger">
                Reference also used:{" "}
                {String(u.invoice_number ?? u.invoice_id ?? "")}
              </p>
            ))}
            {detail.receipt_number && (
              <a
                className="inline-flex min-h-11 items-center text-primary underline"
                href={`/api/admin/subscription-receipts/${detail.payment_attempt_id}`}
                target="_blank"
                rel="noreferrer"
              >
                Receipt {detail.receipt_number}
              </a>
            )}
            <Link
              className="block py-3 text-primary"
              href={`/merchants/${detail.partner_id}`}
            >
              View merchant
            </Link>
          </div>
        </details>
      </div>
    </div>
  );
}
