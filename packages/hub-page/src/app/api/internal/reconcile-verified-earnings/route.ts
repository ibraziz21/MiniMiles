import { NextResponse } from "next/server";
import { reconcileRecentVerifiedEarnings } from "@/lib/akiba/verifiedEarningReconciliation";
import { isInternalWorkerRequest } from "@/lib/internalWorkerAuth";

async function reconcile() {
  try {
    const result = await reconcileRecentVerifiedEarnings();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "verified_earning_reconciliation_failed";
    console.error("[reconcile-verified-earnings] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isInternalWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return reconcile();
}

export async function GET(request: Request) {
  if (!isInternalWorkerRequest(request, true)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return reconcile();
}
