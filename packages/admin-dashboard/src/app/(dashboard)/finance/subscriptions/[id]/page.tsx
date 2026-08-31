import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubscriptionPaymentReview } from "@/components/finance/SubscriptionPaymentReview";
import { formatDateTime } from "@/lib/utils";
import {
  formatAge,
  isStaleReview,
  isUuid,
  minutesSince,
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
  total: string | null;
  amount_paid: string | null;
  balance: string | null;
  expected_amount: string | null;
  short_payment_reference: string | null;
  ncba_destination_snapshot: Record<string, unknown> | null;
  pending_effect: string | null;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
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
      <span className="text-right font-medium text-slate-900">{value ?? "—"}</span>
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
  const canDecide = session.role === "super_admin" || session.role === "finance_admin";
  const isSuperAdmin = session.role === "super_admin";
  const ageMinutes = minutesSince(detail.submitted_at);
  const sla = slaState(detail.submitted_at);
  const claimedByMe = detail.reviewer_admin_user_id === session.adminUserId;
  const stale = detail.status === "under_review" && isStaleReview(detail.review_started_at);
  const flags = detail.risk_flags ?? [];

  return (
    <div>
      <TopBar
        title={`Subscription payment · ${detail.merchant_name ?? detail.partner_id}`}
        subtitle={`Invoice ${detail.invoice_number ?? detail.invoice_id.slice(0, 8)} · submitted ${formatDateTime(detail.submitted_at)}`}
      />
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/finance/subscriptions"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to queue
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[detail.status] ?? "secondary"}>{detail.status}</Badge>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                sla === "red"
                  ? "bg-red-100 text-red-700"
                  : sla === "amber"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {formatAge(ageMinutes)} waiting
            </span>
            {detail.receipt_number && (
              <a
                href={`/api/admin/subscription-receipts/${detail.payment_attempt_id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#176B78] hover:underline"
              >
                Receipt {detail.receipt_number} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>

        {flags.length > 0 && (
          <div className="flex flex-wrap gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            {flags.map((flag) => (
              <Badge key={flag} variant="warning">
                {RISK_FLAG_LABELS[flag] ?? flag}
              </Badge>
            ))}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* 7.1 Merchant and subscription */}
          <Card>
            <CardHeader>
              <CardTitle>Merchant &amp; subscription</CardTitle>
            </CardHeader>
            <CardContent>
              <Row label="Merchant" value={detail.merchant_name ?? detail.partner_id} />
              <Row label="Partner ID" value={<span className="font-mono text-xs">{detail.partner_id}</span>} />
              <Row
                label="Current plan / status"
                value={`${detail.subscription_plan ?? "—"} · ${detail.subscription_status ?? "—"}`}
              />
              <Row
                label="Requested plan / term"
                value={`${detail.requested_plan ?? "—"} · ${detail.requested_term ?? "—"}`}
              />
              <Row label="Requested change" value={detail.requested_change} />
              <Row label="Active branches" value={detail.active_branch_count} />
              <Row label="Founding status" value={detail.founding_status} />
              <Row label="Activation date" value={formatDateTime(detail.activation_date)} />
              <Row label="Renewal date" value={formatDateTime(detail.renewal_date)} />
              <Link
                href={`/merchants/${detail.partner_id}`}
                className="mt-2 inline-block text-sm font-medium text-[#176B78] hover:underline"
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
              <Row label="Number / type" value={`${detail.invoice_number ?? "—"} · ${detail.invoice_type ?? "—"}`} />
              <Row label="Status" value={detail.invoice_status} />
              <Row label="Created" value={formatDateTime(detail.invoice_created_at)} />
              <Row label="Issued" value={formatDateTime(detail.invoice_issued_at)} />
              <Row label="Due" value={formatDateTime(detail.invoice_due_at)} />
              <Row label="Grace deadline" value={formatDateTime(detail.invoice_grace_deadline)} />
              <Row
                label="Service period"
                value={`${formatDateTime(detail.service_period_start)} → ${formatDateTime(detail.service_period_end)}`}
              />
              <Row label="Pricing version" value={detail.pricing_version} />
              <div className="my-2 border-t border-slate-100" />
              {(detail.line_items ?? []).map((li, i) => (
                <Row key={i} label={li.description} value={`KES ${li.amount}`} />
              ))}
              <Row label="Subtotal" value={`KES ${detail.subtotal ?? "0.00"}`} />
              <Row label="Discount" value={`KES ${detail.discount ?? "0.00"}`} />
              <Row label="VAT" value="KES 0.00" />
              <Row label="Total" value={<strong>KES {detail.total ?? "0.00"}</strong>} />
              <Row label="Paid / balance" value={`KES ${detail.amount_paid ?? "0.00"} / KES ${detail.balance ?? "0.00"}`} />
              <div className="my-2 border-t border-slate-100" />
              <Row label="Expected short reference" value={<span className="font-mono">{detail.short_payment_reference ?? "—"}</span>} />
              <Row label="Expected amount" value={<span className="font-mono">KES {detail.expected_amount ?? "—"}</span>} />
              {detail.ncba_destination_snapshot && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-slate-600">
                    NCBA destination snapshot
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                    {JSON.stringify(detail.ncba_destination_snapshot, null, 2)}
                  </pre>
                </details>
              )}
              {detail.pending_effect && (
                <p className="mt-2 rounded-lg bg-[#238D9D]/10 p-2 text-xs text-[#176B78]">
                  On confirm: {detail.pending_effect}
                </p>
              )}
            </CardContent>
          </Card>

          {/* 7.3 Merchant submission */}
          <Card>
            <CardHeader>
              <CardTitle>Merchant submission</CardTitle>
            </CardHeader>
            <CardContent>
              <Row label="Payment method" value={detail.payment_method} />
              <Row
                label="Submitted amount"
                value={<span className="font-mono">{detail.submitted_amount} {detail.submitted_currency}</span>}
              />
              <Row label="Payer / provider reference" value={<span className="font-mono">{detail.provider_reference_masked ?? "—"}</span>} />
              <Row label="Payment date/time" value={formatDateTime(detail.payment_date)} />
              <Row label="Submitted" value={`${formatDateTime(detail.submitted_at)} (${formatAge(ageMinutes)} ago)`} />
              {detail.merchant_note && (
                <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">
                  <span className="text-xs text-slate-500">Merchant note: </span>
                  {detail.merchant_note}
                </p>
              )}
              <div className="mt-3">
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
              </div>

              {priorAttempts.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase text-slate-400">Prior attempts</p>
                  {priorAttempts.map((p, i) => (
                    <div key={i} className="mt-1 rounded bg-slate-50 p-2 text-xs text-slate-600">
                      {String(p.status)} · {formatDateTime(String(p.submitted_at ?? ""))} ·{" "}
                      {String(p.decision_reason ?? "")}
                    </div>
                  ))}
                </div>
              )}

              {referenceUses.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    Other uses of this reference
                  </p>
                  {referenceUses.map((u, i) => (
                    <div key={i} className="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-700">
                      {String(u.status ?? "")} · invoice {String(u.invoice_number ?? u.invoice_id ?? "")}
                      {u.same_merchant === false ? " · different merchant" : ""}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Review state */}
          <Card>
            <CardHeader>
              <CardTitle>Review state</CardTitle>
            </CardHeader>
            <CardContent>
              <Row label="Reviewer" value={detail.reviewer_name ?? detail.reviewer_admin_user_id ?? "unclaimed"} />
              <Row label="Review started" value={formatDateTime(detail.review_started_at)} />
              <Row label="Decided" value={formatDateTime(detail.decided_at)} />
              <Row label="Decision reason" value={detail.decision_reason} />
              <Row label="Merchant-safe message" value={detail.merchant_safe_message} />
              {stale && (
                <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
                  This claim has been idle for more than 30 minutes and can be taken over.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
