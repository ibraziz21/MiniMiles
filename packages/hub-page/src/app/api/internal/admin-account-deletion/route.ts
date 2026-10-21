import { NextResponse } from "next/server";
import { isDeletionAdminRequest } from "@/lib/internalWorkerAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminDeletionReadiness, runAdminAccountDeletion, retryAdminDeletionEmail } from "@/lib/akiba/adminAccountDeletion";

export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request: Request) {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  if (!isDeletionAdminRequest(request)) return reply({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  if (!uuid.test(body?.requestId ?? "") || !uuid.test(body?.actorId ?? "") || !["inspect", "run", "retry_email"].includes(body?.action)) return reply({ error: "Invalid request" }, 400);
  const admin = createAdminClient();
  // A server-authenticated dashboard actor is revalidated against current DB
  // roles here as well. Cron credentials cannot invoke this operator endpoint.
  const actor = await admin.rpc("require_deletion_operator", { p_actor: body.actorId });
  if (actor.error) return reply({ error: "Named deletion operator required" }, 403);
  if (body.action === "inspect") {
    const plan = await admin.rpc("admin_deletion_blockers", { p_request: body.requestId });
    if (plan.error) return reply({ error: "Inspection unavailable" }, 503);
    return reply({ ok: true, blockers: [...adminDeletionReadiness(), ...(plan.data ?? [])] });
  }
  if (body.action === "retry_email") return reply({ ok: true, delivered: await retryAdminDeletionEmail(body.requestId, admin) });
  const result = await runAdminAccountDeletion(body.requestId, body.actorId, admin);
  return reply(result, result.ok ? 200 : 409);
}
