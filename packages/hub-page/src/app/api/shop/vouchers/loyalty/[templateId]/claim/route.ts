/**
 * POST /api/shop/vouchers/loyalty/:templateId/claim
 *
 * Proxies to Akiba-Platform's POST /api/v1/voucher-offers/:id/claim,
 * forwarding the signed-in member's own Supabase session token — same
 * pattern as app/api/voucher-funding/[allocationId]/claim. Qualification,
 * inventory, and Miles-balance checks all happen server-side on the
 * Platform inside claim_merchant_voucher_atomic; this route never decides
 * eligibility itself (loyalty-qualified-vouchers-spec.md §10, §16).
 *
 * The Idempotency-Key is deterministic per (member, template) — matching the
 * funded-claim route's convention — so a retried request after a network
 * error replays the original claim instead of racing a second one.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env.server";
import {
  claimIntentIsValid,
  getVoucherClaimFriction,
  isVoucherUsePlan,
  recordVoucherClaimIntent,
} from "@/lib/vouchers/claimIntent";

const DISCLOSURE_VERSION = "loyalty-claim-v1";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { templateId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const intentConfirmed = body?.intent_confirmed;
  const usePlan = body?.use_plan;
  const claimFriction = await getVoucherClaimFriction(user.id);
  if (!claimIntentIsValid(intentConfirmed, usePlan, claimFriction)) {
    return NextResponse.json(
      { error: claimFriction.requiresUsePlan ? "Confirm your intent and choose how you plan to use this voucher" : "Confirm that you intend to use this voucher before it expires" },
      { status: 400 },
    );
  }

  const { akiba } = getServerEnv();
  if (!akiba.apiUrl) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const idempotencyKey = `hub-loyalty-claim:${user.id}:${templateId}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${akiba.apiUrl}/api/v1/voucher-offers/${templateId}/claim`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Idempotency-Key": idempotencyKey,
        "Cache-Control": "no-store",
      },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[loyalty voucher claim] Platform unreachable:", err);
    return NextResponse.json({ error: "Could not reach the voucher service. Please try again." }, { status: 502 });
  }

  const data = await upstream.json().catch(() => null) as
    | { success?: boolean; data?: { voucherId: string; status: string; expiresAt: string; milesSpent: number; idempotent: boolean }; error?: { code?: string; message?: string } }
    | null;

  if (!upstream.ok || !data?.success || !data.data) {
    return NextResponse.json(
      { error: data?.error?.message ?? "Could not claim this offer.", code: data?.error?.code },
      { status: upstream.status || 502 },
    );
  }

  await recordVoucherClaimIntent({
    hubUserId: user.id,
    voucherId: data.data.voucherId,
    flow: "loyalty_claim",
    templateId,
    usePlan: isVoucherUsePlan(usePlan) ? usePlan : null,
    friction: claimFriction,
    disclosureVersion: DISCLOSURE_VERSION,
  });

  return NextResponse.json(data.data, {
    status: upstream.status,
    headers: { "Cache-Control": "no-store, private" },
  });
}
