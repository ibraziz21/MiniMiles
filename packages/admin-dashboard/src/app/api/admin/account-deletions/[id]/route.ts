import { NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { isTrustedMutationRequest } from "@/lib/requestSecurity";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  const session = await requireAdminSession("deletions.write");
  if (!session) return reply({ error: "Unauthorized" }, 401);
  if (!isTrustedMutationRequest(request)) return reply({ error: "Cross-origin request rejected" }, 403);
  const actor = adminIdForWrite(session);
  if (!actor) return reply({ error: "A named admin session is required." }, 403);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.id)) return reply({ error: "Invalid request ID." }, 400);
  const body = await request.json().catch(() => null);
  if (!["assign", "inspect", "run", "retry_email"].includes(body?.action)) return reply({ error: "Invalid action." }, 422);
  if (body.action === "run" && body.confirmation !== "DELETE SHARED ACCOUNT") return reply({ error: "Confirm deletion of the entire shared account." }, 422);
  if (body.action === "assign") {
    const result = await supabase.rpc("assign_admin_account_deletion", { p_request: params.id, p_actor: actor });
    return result.error ? reply({ error: "Assignment failed. The request may be busy or no longer eligible." }, 409) : reply({ ok: true });
  }
  // The cleanup and contact-decryption code lives only on Hub. Never forward
  // cookies, member tokens, ciphertext or provider secrets to the browser.
  const base = process.env.AKIBA_HUB_INTERNAL_URL?.trim();
  const secret = process.env.ACCOUNT_DELETION_ADMIN_SECRET?.trim() || process.env.INTERNAL_WEBHOOK_SECRET?.trim();
  if (!base || !secret) return reply({ error: "Deletion service is not configured." }, 503);
  let url: URL;
  try {
    url = new URL("/api/internal/admin-account-deletion", base);
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error();
  } catch { return reply({ error: "Deletion service URL is invalid." }, 503); }
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-webhook-secret": secret }, body: JSON.stringify({ action: body.action, requestId: params.id, actorId: actor }), cache: "no-store", signal: AbortSignal.timeout(55_000) });
    const result = await response.json();
    // Only bounded status/verification codes from the dedicated internal API.
    return reply({ ok: result.ok === true, blockers: Array.isArray(result.blockers) ? result.blockers.filter((code: unknown) => typeof code === "string" && /^[a-z0-9_:.]{1,128}$/.test(code)) : [], verified: result.verified === true, delivered: result.delivered === true, emailDelivered: result.emailDelivered === true }, response.ok ? 200 : 409);
  } catch {
    return reply({ error: "No final response received. Refresh to check progress before retrying. Active runs remain leased for 15 minutes." }, 503);
  }
}
