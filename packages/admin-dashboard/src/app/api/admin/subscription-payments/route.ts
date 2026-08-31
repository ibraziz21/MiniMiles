// GET /api/admin/subscription-payments
// Paginated, filterable subscription payment review queue and completed history.
// Reads the Akiba-owned queue view; never exposes shared financial rows or
// cross-merchant data through a public route — authorization is the only gate.

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  COMPLETED_ATTEMPT_STATUSES,
  OPEN_ATTEMPT_STATUSES,
  PAYMENT_METHODS,
  SLA_BREACH_MINUTES,
  SLA_WARN_MINUTES,
  SUBSCRIPTION_PAYMENT_VIEWS,
  type AttemptStatus,
} from "@/lib/subscriptionPayments";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60000).toISOString();
}

export async function GET(req: NextRequest) {
  const session = await requireAdminSession("finance.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;

  const view = sp.get("view") === "history" ? "history" : "queue";
  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(sp.get("pageSize") ?? PAGE_SIZE_DEFAULT) || PAGE_SIZE_DEFAULT),
  );

  let query = supabase
    .from(SUBSCRIPTION_PAYMENT_VIEWS.queue)
    .select("*", { count: "exact" });

  // Status scope --------------------------------------------------------------
  const statusParam = sp.get("status") as AttemptStatus | null;
  const scope = view === "history" ? COMPLETED_ATTEMPT_STATUSES : OPEN_ATTEMPT_STATUSES;
  if (statusParam && scope.includes(statusParam)) {
    query = query.eq("status", statusParam);
  } else {
    query = query.in("status", scope);
  }

  // Simple equality filters -------------------------------------------------
  const merchant = sp.get("merchant");
  if (merchant) query = query.eq("partner_id", merchant);

  const reviewer = sp.get("reviewer");
  if (reviewer) query = query.eq("reviewer_admin_user_id", reviewer);

  const method = sp.get("method");
  if (method && (PAYMENT_METHODS as readonly string[]).includes(method)) {
    query = query.eq("payment_method", method);
  }

  const invoiceType = sp.get("invoiceType");
  if (invoiceType) query = query.eq("invoice_type", invoiceType);

  // Reference search (masked/normalized columns only) ----------------------
  const providerRef = sp.get("providerReference");
  if (providerRef) query = query.ilike("provider_reference_search", `%${providerRef}%`);

  const invoiceRef = sp.get("invoiceReference");
  if (invoiceRef) {
    query = query.or(
      `invoice_number.ilike.%${invoiceRef}%,short_payment_reference.ilike.%${invoiceRef}%`,
    );
  }

  // Submitted-date range --------------------------------------------------
  const submittedFrom = sp.get("submittedFrom");
  if (submittedFrom) query = query.gte("submitted_at", submittedFrom);
  const submittedTo = sp.get("submittedTo");
  if (submittedTo) query = query.lte("submitted_at", submittedTo);

  // Exact amount range --------------------------------------------------
  const amountMin = sp.get("amountMin");
  if (amountMin) query = query.gte("submitted_amount", amountMin);
  const amountMax = sp.get("amountMax");
  if (amountMax) query = query.lte("submitted_amount", amountMax);

  // SLA state (open queue only) ---------------------------------------------
  const slaFilter = sp.get("sla");
  if (slaFilter === "breached") {
    query = query.lte("submitted_at", iso(SLA_BREACH_MINUTES));
  } else if (slaFilter === "warning") {
    query = query
      .lte("submitted_at", iso(SLA_WARN_MINUTES))
      .gt("submitted_at", iso(SLA_BREACH_MINUTES));
  } else if (slaFilter === "ontime") {
    query = query.gt("submitted_at", iso(SLA_WARN_MINUTES));
  }

  // Ordering: oldest submission first; never prioritize larger payments.
  const ascending = view !== "history";
  query = query.order(view === "history" ? "decided_at" : "submitted_at", {
    ascending,
    nullsFirst: false,
  });

  const from = (page - 1) * pageSize;
  query = query.range(from, from + pageSize - 1);

  const { data, error, count } = await query;
  if (error) {
    console.error("[admin/subscription-payments] list error:", error.message);
    return NextResponse.json({ error: "Failed to load subscription payments" }, { status: 500 });
  }

  return NextResponse.json(
    {
      rows: data ?? [],
      page,
      pageSize,
      total: count ?? 0,
      hasMore: (count ?? 0) > from + (data?.length ?? 0),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
