/**
 * POST /api/voucher-funding/:allocationId/claim
 *
 * Proxies to Akiba-Platform's POST /api/v1/voucher-funding-allocations/:id/claim,
 * forwarding the signed-in member's own Supabase session token as the
 * Authorization bearer — the same forward-the-session pattern
 * /api/me/pass/token uses. Eligibility is evaluated on the Platform side
 * (same evaluator self-claim always uses); this route never decides
 * eligibility itself (akiba-funded-founding-merchant-vouchers-spec.md §10.4,
 * §11.1).
 *
 * The Idempotency-Key is deterministic per (member, allocation) — not a
 * per-request random value — so a retried request after a network error
 * replays the original claim instead of racing a second one.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env.server";
import { evaluateFundedVoucherCountryEligibility } from "@/lib/akiba/fundedVoucherCountryEligibility";
import {
  claimIntentIsValid,
  getVoucherClaimFriction,
  isVoucherUsePlan,
  recordVoucherClaimIntent,
} from "@/lib/vouchers/claimIntent";
import { akibaFundedVouchersHubFlag } from "@/lib/featureFlags.server";
import { getActiveUsernameForHubUser } from "@/lib/akiba/voucherUsername";

const DISCLOSURE_VERSION = "funded-claim-v1";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ allocationId: string }> },
) {
  // Phase 1 kill switch — see the eligibility route for why this is checked
  // first. Platform independently enforces the same flag on its own claim
  // endpoint so a direct call there cannot bypass this.
  if (!akibaFundedVouchersHubFlag().enabled) {
    return NextResponse.json({ error: "This offer is not currently available." }, { status: 503 });
  }

  const { allocationId } = await params;
  const supabase = await createClient();

  // getUser() re-verifies the session against the Auth server — required
  // before trusting the member's id for the idempotency key below.
  // getSession() alone would just decode the (possibly stale/tampered)
  // storage cookie; its access_token is still needed to forward, but never
  // its .user field.
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

  // Username requirement (voucher-web2-username-identity-spec.md §3.4) — a
  // new claim must never reach Platform without one. The client-supplied
  // body never carries a username; this reads the authenticated session's
  // own server-resolved value, so it can never become an ownership credential.
  const username = await getActiveUsernameForHubUser({ hubUserId: user.id, email: user.email ?? null });
  if (!username) {
    return NextResponse.json(
      { error: "Choose an Akiba username to claim this offer.", code: "USERNAME_REQUIRED" },
      { status: 422 },
    );
  }

  const countryEligibility = await evaluateFundedVoucherCountryEligibility({
    allocationId,
    hubUserId: user.id,
    email: user.email ?? null,
  });
  if (!countryEligibility.ok) {
    const status = countryEligibility.reason === "allocation_not_found" ? 404 : 503;
    return NextResponse.json({ error: "This offer is not currently available." }, { status });
  }
  if (!countryEligibility.eligible) {
    const required = countryEligibility.reasonCode === "profile_country_required";
    return NextResponse.json(
      {
        error: required
          ? "Set your profile country to Kenya to claim this offer."
          : "This offer is available only to members whose profile country is Kenya.",
        code: required ? "COUNTRY_PROFILE_REQUIRED" : "COUNTRY_NOT_ELIGIBLE",
      },
      { status: 422 },
    );
  }

  const { akiba } = getServerEnv();
  if (!akiba.apiUrl) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const idempotencyKey = `hub-claim:${user.id}:${allocationId}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${akiba.apiUrl}/api/v1/voucher-funding-allocations/${allocationId}/claim`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Idempotency-Key": idempotencyKey,
        "Cache-Control": "no-store",
      },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[voucher-funding claim] Platform unreachable:", err);
    return NextResponse.json({ error: "Could not reach the voucher service. Please try again." }, { status: 502 });
  }

  const data = await upstream.json().catch(() => null) as
    | { success?: boolean; data?: { voucherId: string; status: string; expiresAt: string; idempotent: boolean }; error?: { code?: string; message?: string } }
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
    flow: "funded_claim",
    allocationId,
    usePlan: isVoucherUsePlan(usePlan) ? usePlan : null,
    friction: claimFriction,
    disclosureVersion: DISCLOSURE_VERSION,
  });

  return NextResponse.json(data.data, {
    status: upstream.status,
    headers: { "Cache-Control": "no-store, private" },
  });
}
