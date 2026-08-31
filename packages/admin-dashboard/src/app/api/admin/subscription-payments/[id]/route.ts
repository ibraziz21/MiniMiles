// GET /api/admin/subscription-payments/[id]
// Full review detail: attempt, invoice, merchant, subscription, prior attempts,
// and other uses of the normalized provider reference. Read-only; queries the
// Akiba-owned detail views. Never returns evidence signed URLs or bank
// credentials.

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isUuid, SUBSCRIPTION_PAYMENT_VIEWS } from "@/lib/subscriptionPayments";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid payment attempt id" }, { status: 400 });
  }

  const { data: detail, error } = await supabase
    .from(SUBSCRIPTION_PAYMENT_VIEWS.detail)
    .select("*")
    .eq("payment_attempt_id", params.id)
    .maybeSingle();

  if (error) {
    console.error("[admin/subscription-payments] detail error:", error.message);
    return NextResponse.json({ error: "Failed to load payment attempt" }, { status: 500 });
  }
  if (!detail) {
    return NextResponse.json({ error: "Payment attempt not found" }, { status: 404 });
  }

  const [priorRes, referenceUsesRes] = await Promise.all([
    supabase
      .from(SUBSCRIPTION_PAYMENT_VIEWS.priorAttempts)
      .select("*")
      .eq("invoice_id", detail.invoice_id)
      .neq("payment_attempt_id", params.id)
      .order("submitted_at", { ascending: false }),
    supabase
      .from(SUBSCRIPTION_PAYMENT_VIEWS.referenceUses)
      .select("*")
      .eq("payment_attempt_id", params.id),
  ]);

  return NextResponse.json(
    {
      detail,
      priorAttempts: priorRes.data ?? [],
      referenceUses: referenceUsesRes.data ?? [],
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
