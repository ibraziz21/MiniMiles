import { NextResponse } from "next/server";
import { isInternalWorkerRequest } from "@/lib/internalWorkerAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingCompletionEmails } from "@/lib/akiba/accountDeletionWorker";

// Notice delivery remains active when submission/automated cleanup is paused.
export const maxDuration = 60;
async function handle(request: Request, cron: boolean) {
  if (!isInternalWorkerRequest(request, cron)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await processPendingCompletionEmails(createAdminClient(), 3);
  return NextResponse.json({ ok: true, ...summary }, { headers: { "Cache-Control": "private, no-store" } });
}
export const POST = (request: Request) => handle(request, false);
export const GET = (request: Request) => handle(request, true);
