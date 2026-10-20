import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { isTrustedMutationRequest } from "@/lib/requestSecurity";
import { isReportResolution } from "@/lib/discoveryReports";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  const session = await requireAdminSession("discovery.write");
  if (!session) return reply({ error: "Unauthorized" }, 401);
  if (!isTrustedMutationRequest(request)) return reply({ error: "Cross-origin request rejected" }, 403);
  const actor = adminIdForWrite(session);
  if (!actor) return reply({ error: "A named admin session is required." }, 403);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.id)) return reply({ error: "Invalid report ID." }, 400);
  const body = await request.json().catch(() => null);
  if (!isReportResolution(body?.action, body?.reason)) return reply({ error: "Choose an action and resolution reason." }, 422);
  const { data, error } = await supabase.rpc("resolve_verified_visit_report", {
    p_report_id: params.id, p_action: body.action, p_reason: body.reason,
    p_actor_id: actor, p_correlation_id: randomUUID(),
  });
  if (error) return reply({ error: "Resolution failed. Refresh the queue and try again." }, 500);
  if (!data?.ok) return reply({ error: data?.error_code === "already_resolved" ? "Another moderator already resolved this report. Refresh the queue." : "The report or its photo is no longer available." }, data?.error_code === "not_found" ? 404 : 409);
  return reply({ ok: true });
}
