import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdminSession } from "@/lib/auth";
import { voucherReadAll } from "@/lib/voucherCatalogue";
import { supabase } from "@/lib/supabase";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import { MetricCard } from "@/components/ui/metric-card";
import { SubscriptionPaymentQueue } from "@/components/finance/SubscriptionPaymentQueue";
import { cn } from "@/lib/utils";
import {
  COMPLETED_ATTEMPT_STATUSES,
  formatAge,
  minutesSince,
  OPEN_ATTEMPT_STATUSES,
  SLA_BREACH_MINUTES,
  SUBSCRIPTION_PAYMENT_VIEWS,
  type QueueRow,
} from "@/lib/subscriptionPayments";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function loadQueue(searchParams: SearchParams) {
  const view: "queue" | "history" =
    searchParams.view === "history" ? "history" : "queue";
  const scope =
    view === "history" ? COMPLETED_ATTEMPT_STATUSES : OPEN_ATTEMPT_STATUSES;

  let query = supabase
    .from(SUBSCRIPTION_PAYMENT_VIEWS.queue)
    .select("*")
    .in("status", scope);

  const eq: Array<[string, string]> = [];
  if (
    typeof searchParams.status === "string" &&
    scope.includes(searchParams.status as never)
  ) {
    query = query.eq("status", searchParams.status);
  }
  if (typeof searchParams.merchant === "string")
    eq.push(["partner_id", searchParams.merchant]);
  if (typeof searchParams.reviewer === "string")
    eq.push(["reviewer_admin_user_id", searchParams.reviewer]);
  if (typeof searchParams.method === "string")
    eq.push(["payment_method", searchParams.method]);
  if (typeof searchParams.invoiceType === "string")
    eq.push(["invoice_type", searchParams.invoiceType]);
  for (const [col, val] of eq) query = query.eq(col, val);

  if (typeof searchParams.providerReference === "string") {
    query = query.ilike(
      "provider_reference_search",
      `%${searchParams.providerReference}%`
    );
  }
  if (typeof searchParams.submittedFrom === "string") {
    query = query.gte("submitted_at", searchParams.submittedFrom);
  }
  if (typeof searchParams.submittedTo === "string") {
    query = query.lte("submitted_at", searchParams.submittedTo);
  }
  if (typeof searchParams.amountMin === "string") {
    query = query.gte("submitted_amount", searchParams.amountMin);
  }
  if (typeof searchParams.amountMax === "string") {
    query = query.lte("submitted_amount", searchParams.amountMax);
  }

  query = query
    .order(view === "history" ? "decided_at" : "submitted_at", {
      ascending: view !== "history",
      nullsFirst: false,
    })
    .order("payment_attempt_id");

  const result = await voucherReadAll((from, to) => query.range(from, to))
    .then((data) => ({ data, error: null }))
    .catch(() => ({
      data: [],
      error: { message: "Payment queue unavailable" },
    }));
  const { data, error } = result;
  if (error)
    console.error("[finance/subscriptions] queue load error:", error.message);
  return {
    view,
    rows: (data ?? []) as QueueRow[],
    unavailable: Boolean(error),
  };
}

async function loadKpis() {
  const todayIso = startOfTodayIso();
  const [openRes, confirmedRes, rejectedRes] = await Promise.all([
    supabase
      .from(SUBSCRIPTION_PAYMENT_VIEWS.queue)
      .select("submitted_at")
      .in("status", OPEN_ATTEMPT_STATUSES),
    supabase
      .from(SUBSCRIPTION_PAYMENT_VIEWS.queue)
      .select("confirmed_amount")
      .eq("status", "confirmed")
      .gte("decided_at", todayIso),
    supabase
      .from(SUBSCRIPTION_PAYMENT_VIEWS.queue)
      .select("payment_attempt_id", { count: "exact", head: true })
      .eq("status", "rejected")
      .gte("decided_at", todayIso),
  ]);

  const openRows = (openRes.data ?? []) as Array<{ submitted_at: string }>;
  const ages = openRows
    .map((r) => minutesSince(r.submitted_at))
    .sort((a, b) => b - a);
  const overSla = ages.filter((m) => m >= SLA_BREACH_MINUTES).length;

  const confirmedRows = (confirmedRes.data ?? []) as Array<{
    confirmed_amount: string | null;
  }>;
  const confirmedTotal = confirmedRows.reduce(
    (sum, r) => sum + Number(r.confirmed_amount ?? 0),
    0
  );

  return {
    awaiting: openRows.length,
    oldestAgeMinutes: ages[0] ?? 0,
    confirmedTodayCount: confirmedRows.length,
    confirmedTodayKes: confirmedTotal,
    overSla,
    rejectedTodayCount: rejectedRes.count ?? 0,
  };
}

export default async function SubscriptionPaymentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAdminSession("finance.read");
  if (!session) redirect("/login");

  const { view, rows, unavailable } = await loadQueue(searchParams);
  const requestedPage = Number(searchParams.page ?? 1);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const pageHref = (n: number) => {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams))
      if (typeof v === "string") query.set(k, v);
    query.set("page", String(n));
    return `/finance/subscriptions?${query}`;
  };
  const canDecide =
    session.role === "super_admin" || session.role === "finance_admin";

  return (
    <div className="min-h-screen bg-[#FAF8FF]">
      <VoucherHeader
        title="Subscription payments"
        name={session.name}
        role={session.role}
      />
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Link
              href="/finance/subscriptions"
              className={cn(
                "flex min-h-11 items-center rounded-full px-4 py-2 text-sm font-medium",
                view === "queue"
                  ? "bg-primary text-white"
                  : "bg-surface-subtle text-ink-muted"
              )}
            >
              Pending
            </Link>
            <Link
              href="/finance/subscriptions?view=history"
              className={cn(
                "flex min-h-11 items-center rounded-full px-4 py-2 text-sm font-medium",
                view === "history"
                  ? "bg-primary text-white"
                  : "bg-surface-subtle text-ink-muted"
              )}
            >
              Accepted / rejected
            </Link>
            <Link
              href="/finance/subscriptions/collections"
              className="rounded-control bg-surface-subtle px-3 py-1.5 text-sm font-medium text-ink-muted"
            >
              Overdue invoices
            </Link>
          </div>
        </div>

        {unavailable && (
          <p
            role="alert"
            className="rounded-card bg-danger/5 p-4 text-sm text-danger"
          >
            Payment reviews could not be loaded. Refresh to try again.
          </p>
        )}
        <SubscriptionPaymentQueue
          rows={rows.slice((page - 1) * 50, page * 50)}
          view={view}
          canDecide={canDecide}
          initialFilters={{
            status:
              typeof searchParams.status === "string"
                ? searchParams.status
                : "",
            method:
              typeof searchParams.method === "string"
                ? searchParams.method
                : "",
            invoiceType:
              typeof searchParams.invoiceType === "string"
                ? searchParams.invoiceType
                : "",
            merchant:
              typeof searchParams.merchant === "string"
                ? searchParams.merchant
                : "",
            reviewer:
              typeof searchParams.reviewer === "string"
                ? searchParams.reviewer
                : "",
            providerReference:
              typeof searchParams.providerReference === "string"
                ? searchParams.providerReference
                : "",
            submittedFrom:
              typeof searchParams.submittedFrom === "string"
                ? searchParams.submittedFrom
                : "",
            submittedTo:
              typeof searchParams.submittedTo === "string"
                ? searchParams.submittedTo
                : "",
            amountMin:
              typeof searchParams.amountMin === "string"
                ? searchParams.amountMin
                : "",
            amountMax:
              typeof searchParams.amountMax === "string"
                ? searchParams.amountMax
                : "",
          }}
        />
        <nav
          aria-label="Payment queue pages"
          className="flex flex-wrap justify-between gap-3 text-sm text-primary"
        >
          <span className="py-3">
            Page {page} · {rows.length} payments
          </span>
          {page > 1 && (
            <Link className="py-3" href={pageHref(page - 1)}>
              Previous
            </Link>
          )}
          {rows.length > page * 50 && (
            <Link className="py-3" href={pageHref(page + 1)}>
              Next
            </Link>
          )}
        </nav>
      </div>
    </div>
  );
}
