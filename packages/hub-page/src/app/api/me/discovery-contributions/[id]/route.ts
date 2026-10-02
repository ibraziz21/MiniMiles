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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LABEL_LENGTH = 80;
const ALLOWED_ITEM_SOURCES = new Set(["event_confirmation", "customer_input", "existing_selection"]);

function rpcErrorResponse(error: { code?: string; message?: string }) {
  if (error.code === "P0002") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (error.code === "55000") {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }
  if (error.code === "22023") {
    return NextResponse.json({ error: "invalid_state" }, { status: 409 });
  }
  if (error.code === "23514") {
    return NextResponse.json({ error: error.message ?? "invalid_answer" }, { status: 422 });
  }
  console.error("[discovery-contributions] submit failed:", error.code, error.message);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

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

type ContributionItemInput = {
  clientItemKey: string;
  rawLabel: string;
  source: string;
  isRecommended: boolean;
};

function validateItems(raw: unknown): { ok: true; items: ContributionItemInput[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, items: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "invalid_items" };
  if (raw.length > 4) return { ok: false, error: "too_many_items" };

  const items: ContributionItemInput[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return { ok: false, error: "invalid_items" };
    const { clientItemKey, rawLabel, source, isRecommended } = entry as Record<string, unknown>;
    if (typeof clientItemKey !== "string" || !clientItemKey.trim()) return { ok: false, error: "invalid_items" };
    if (typeof rawLabel !== "string" || !rawLabel.trim() || rawLabel.length > MAX_LABEL_LENGTH) {
      return { ok: false, error: "invalid_items" };
    }
    if (typeof source !== "string" || !ALLOWED_ITEM_SOURCES.has(source)) return { ok: false, error: "invalid_items" };
    if (isRecommended !== undefined && typeof isRecommended !== "boolean") return { ok: false, error: "invalid_items" };
    items.push({ clientItemKey, rawLabel, source, isRecommended: Boolean(isRecommended) });
  }
  return { ok: true, items };
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

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { wouldRecommend, negativeReasonId, partySize, partySizeIsSixPlus, experienceOptionIds, items, idempotencyKey } =
    body as Record<string, unknown>;

  // Required per §11.2 — a bare network retry of an identical submit must
  // be a no-op, not a second edit that bumps answer_version again.
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 200) {
    return NextResponse.json({ error: "invalid_idempotency_key" }, { status: 400 });
  }

  if (wouldRecommend !== null && typeof wouldRecommend !== "boolean") {
    return NextResponse.json({ error: "invalid_would_recommend" }, { status: 400 });
  }
  if (negativeReasonId !== undefined && negativeReasonId !== null && typeof negativeReasonId !== "string") {
    return NextResponse.json({ error: "invalid_negative_reason_id" }, { status: 400 });
  }
  if (
    partySize !== undefined &&
    partySize !== null &&
    (!Number.isInteger(partySize) || (partySize as number) < 1 || (partySize as number) > 5)
  ) {
    return NextResponse.json({ error: "invalid_party_size" }, { status: 400 });
  }
  if (partySizeIsSixPlus !== undefined && typeof partySizeIsSixPlus !== "boolean") {
    return NextResponse.json({ error: "invalid_party_size_is_six_plus" }, { status: 400 });
  }
  if (
    experienceOptionIds !== undefined &&
    (!Array.isArray(experienceOptionIds) || experienceOptionIds.some((id) => typeof id !== "string"))
  ) {
    return NextResponse.json({ error: "invalid_experience_option_ids" }, { status: 400 });
  }

  const validatedItems = validateItems(items);
  if (!validatedItems.ok) {
    return NextResponse.json({ error: validatedItems.error }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("submit_discovery_contribution", {
    p_request_id: params.id,
    p_hub_user_id: user.id,
    p_would_recommend: wouldRecommend ?? null,
    p_negative_reason_id: negativeReasonId ?? null,
    p_party_size: partySize ?? null,
    p_party_size_is_six_plus: Boolean(partySizeIsSixPlus),
    p_experience_option_ids: (experienceOptionIds as string[] | undefined) ?? [],
    p_items: validatedItems.items,
    p_idempotency_key: idempotencyKey,
  });

  if (error) return rpcErrorResponse(error);

  const result = (Array.isArray(data) ? data[0] : data) as { ok: boolean; contribution_id: string } | undefined;
  return NextResponse.json({ ok: true, contributionId: result?.contribution_id });
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
  const { data: contribution, error: fetchError } = await admin
    .from("merchant_discovery_contributions")
    .select("id")
    .eq("id", params.id)
    .eq("hub_user_id", user.id)
    .is("withdrawn_at", null)
    .maybeSingle();

  if (fetchError) {
    console.error("[discovery-contributions/:id] withdraw lookup failed:", fetchError.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!contribution) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const now = new Date().toISOString();
  const { error: withdrawError } = await admin
    .from("merchant_discovery_contributions")
    .update({ withdrawn_at: now })
    .eq("id", params.id);

  if (withdrawError) {
    console.error("[discovery-contributions/:id] withdraw failed:", withdrawError.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // Withdrawing a contribution withdraws its photos too (§8.5); deleting
  // one photo separately does not require withdrawing the contribution.
  await admin
    .from("merchant_visit_photos")
    .update({ moderation_status: "withdrawn", withdrawn_at: now })
    .eq("contribution_id", params.id)
    .not("moderation_status", "in", "(rejected,withdrawn)");

  return NextResponse.json({ ok: true });
}
