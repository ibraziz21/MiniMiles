import { NextResponse } from "next/server";
import { isInternalWorkerRequest } from "@/lib/internalWorkerAuth";
import { createAdminClient } from "@/lib/supabase/admin";

async function handle(request: Request, allowCron: boolean) {
  if (!isInternalWorkerRequest(request, allowCron)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Expiry must keep running when new deletion submissions are paused.
  if (process.env.ACCOUNT_DELETION_EXPIRY_ENABLED !== "true") {
    return NextResponse.json({ ok: false, reason: "expiry_disabled" }, { status: 503 });
  }
  const { data, error } = await createAdminClient().rpc("expire_account_deletion_evidence", { p_limit: 500 });
  if (error) {
    console.error(`[deletion-expiry] failed sqlstate=${error.code ?? "unknown"}`);
    return NextResponse.json({ ok: false, reason: "expiry_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, evidenceRemoved: data });
}
export const GET = (request: Request) => handle(request, true);
export const POST = (request: Request) => handle(request, false);
