// GET/PUT /api/me/discovery-contributions/:id            — id = requestId
// DELETE  /api/me/discovery-contributions/:id             — id = contributionId
// (verified-discovery-acquisition-v1-spec.md §11.2). Two different id
// spaces share this path shape per the spec's own contract; Next.js can
// only bind one dynamic segment name per position anyway, so GET/PUT
// interpret :id as a contribution *request*, DELETE interprets it as a
// *contribution* (its withdrawal target).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAllRateLimits } from "@/lib/rateLimit";
import { isSameOriginRequest } from "@/lib/push/origin";
import { parseContributionAnswers, submitDiscoveryContribution } from "@/lib/discovery/contributions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: request, error } = await admin
    .from("discovery_contribution_requests")
    .select(
      "id, partner_id, template_snapshot, state, expires_at, merchant:partners(name), contribution:merchant_discovery_contributions(would_recommend, negative_reason_id, party_size, party_size_is_six_plus, experience_option_ids, answer_version, withdrawn_at)",
    )
    .eq("id", params.id)
    .eq("hub_user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[discovery-contributions/:id] query failed:", error.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!request) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    request: {
      id: request.id,
      merchantId: request.partner_id,
      merchantName: (request as { merchant?: { name?: string } | null }).merchant?.name ?? "this merchant",
      templateSnapshot: request.template_snapshot,
      state: request.state,
      expiresAt: request.expires_at,
      // request_id is UNIQUE on merchant_discovery_contributions, so
      // PostgREST returns this reverse embed as a single object (or null),
      // not an array — normalize defensively rather than assume either.
      contribution: (() => {
        const raw = (request as { contribution?: unknown }).contribution;
        return (Array.isArray(raw) ? (raw[0] ?? null) : raw) ?? null;
      })(),
    },
  });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const withinLimits = await checkAllRateLimits([
    { scope: `discovery_contribution_submit:user:${user.id}`, limit: 20, windowSeconds: 600 },
  ]);
  if (!withinLimits) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Validation and the RPC call are shared with the native route
  // (/api/v1/me/discovery-contributions/:id) via lib/discovery/contributions.
  const parsed = parseContributionAnswers(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const outcome = await submitDiscoveryContribution(user.id, params.id, parsed.answers);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ ok: true, contributionId: outcome.contributionId ?? undefined });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("withdraw_discovery_contribution", {
    p_contribution_id: params.id,
    p_hub_user_id: user.id,
  });
  if (error) {
    console.error("[discovery-contributions/:id] withdraw failed:", error.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.ok) return NextResponse.json({ error: result?.error_code ?? "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
