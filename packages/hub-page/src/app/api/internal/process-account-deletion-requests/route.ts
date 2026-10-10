// POST/GET /api/internal/process-account-deletion-requests
// AKIBA-MOB-002 §8.2. Same dual-invocation convention as the other internal
// workers (process-reward-jobs, process-photo-jobs): POST with
// x-webhook-secret for manual/cross-app calls, GET with
// Authorization: Bearer <CRON_SECRET> for Vercel Cron.
//
// Two operator controls on top of that:
//
//   - ACCOUNT_DELETION_PROCESSING_ENABLED is the §16 incident kill switch.
//     Turning it off stops *processing*; accepted requests stay durable and
//     visible, and resume on recovery.
//   - the retention inventory gate (§9) returns 409 while any inventory row
//     is unapproved, naming the row ids so the blocker is actionable without
//     reading the code.
import { NextResponse } from "next/server";

import { isInternalWorkerRequest } from "@/lib/internalWorkerAuth";
import { InventoryNotApprovedError, reviewInventory } from "@/lib/akiba/accountDeletionPolicy";
import { isProcessingEnabled } from "@/lib/akiba/accountDeletionAvailability";
import {
  processAccountDeletionRequests,
  StepOrderMismatchError,
} from "@/lib/akiba/accountDeletionWorker";

const BATCH_SIZE = 5;

async function handle(request: Request, allowCron: boolean) {
  if (!isInternalWorkerRequest(request, allowCron)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isProcessingEnabled()) {
    return NextResponse.json(
      { ok: false, reason: "processing_disabled", review: reviewInventory() },
      { status: 503 },
    );
  }

  try {
    const summary = await processAccountDeletionRequests(BATCH_SIZE);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    if (error instanceof StepOrderMismatchError) {
      // A data class exists in the inventory with no place in the
      // foreign-key order. Refusing is the only safe answer: running it at
      // an arbitrary point would fail on a constraint at best.
      console.error("[process-account-deletion-requests] step order mismatch:", error.message);
      return NextResponse.json({ ok: false, reason: "step_order_mismatch" }, { status: 500 });
    }
    if (error instanceof InventoryNotApprovedError) {
      return NextResponse.json(
        {
          ok: false,
          reason: "retention_inventory_unapproved",
          unapprovedRowIds: error.unapprovedRowIds,
        },
        { status: 409 },
      );
    }
    console.error(
      "[process-account-deletion-requests] run failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ ok: false, reason: "worker_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request, false);
}

export async function GET(request: Request) {
  return handle(request, true);
}
