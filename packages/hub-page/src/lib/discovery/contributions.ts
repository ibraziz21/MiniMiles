/**
 * Verified-visit recommendations (verified-discovery-acquisition-v1-spec.md
 * §8.3, §11.2) — loading a member's contribution request and submitting
 * their answers.
 *
 * Shared by the web visit card (/api/me/discovery-contributions/:id, cookie
 * auth) and the native app (/api/v1/me/discovery-contributions/:id, bearer
 * auth), so both clients are held to exactly one set of answer rules. The
 * database (submit_discovery_contribution) remains the final authority; this
 * only rejects malformed input before it gets there.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export const CONTRIBUTION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_LABEL_LENGTH = 80;
const MAX_ITEMS = 4;
const ALLOWED_ITEM_SOURCES = new Set(["event_confirmation", "customer_input", "existing_selection"]);

export type ContributionItemInput = {
  clientItemKey: string;
  rawLabel: string;
  source: string;
  isRecommended: boolean;
};

export type ContributionAnswers = {
  wouldRecommend: boolean | null;
  negativeReasonId: string | null;
  partySize: number | null;
  partySizeIsSixPlus: boolean;
  experienceOptionIds: string[];
  items: ContributionItemInput[];
  idempotencyKey: string;
  /** Only sent when editing; undefined leaves a saved note untouched. */
  privateNote?: string;
};

function validateItems(raw: unknown): { ok: true; items: ContributionItemInput[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, items: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "invalid_items" };
  if (raw.length > MAX_ITEMS) return { ok: false, error: "too_many_items" };

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

/** Validates a submit body. Error codes are the ones the web route has always returned. */
export function parseContributionAnswers(body: unknown): { ok: true; answers: ContributionAnswers } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };
  const { wouldRecommend, negativeReasonId, partySize, partySizeIsSixPlus, experienceOptionIds, items, idempotencyKey, privateNote } =
    body as Record<string, unknown>;

  // Required per §11.2 — a bare network retry of an identical submit must
  // be a no-op, not a second edit that bumps answer_version again.
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 200) {
    return { ok: false, error: "invalid_idempotency_key" };
  }
  // Must be sent explicitly: null means "skipped", absent is a malformed body.
  if (wouldRecommend !== null && typeof wouldRecommend !== "boolean") {
    return { ok: false, error: "invalid_would_recommend" };
  }
  if (negativeReasonId !== undefined && negativeReasonId !== null && typeof negativeReasonId !== "string") {
    return { ok: false, error: "invalid_negative_reason_id" };
  }
  if (
    partySize !== undefined &&
    partySize !== null &&
    (!Number.isInteger(partySize) || (partySize as number) < 1 || (partySize as number) > 5)
  ) {
    return { ok: false, error: "invalid_party_size" };
  }
  if (partySizeIsSixPlus !== undefined && typeof partySizeIsSixPlus !== "boolean") {
    return { ok: false, error: "invalid_party_size_is_six_plus" };
  }
  if (
    experienceOptionIds !== undefined &&
    (!Array.isArray(experienceOptionIds) || experienceOptionIds.some((id) => typeof id !== "string"))
  ) {
    return { ok: false, error: "invalid_experience_option_ids" };
  }
  if (privateNote !== undefined && (typeof privateNote !== "string" || privateNote.length > 300)) {
    return { ok: false, error: "invalid_private_note" };
  }
  const validatedItems = validateItems(items);
  if (!validatedItems.ok) return validatedItems;

  return {
    ok: true,
    answers: {
      wouldRecommend: (wouldRecommend as boolean | null | undefined) ?? null,
      negativeReasonId: (negativeReasonId as string | null | undefined) ?? null,
      partySize: (partySize as number | null | undefined) ?? null,
      partySizeIsSixPlus: Boolean(partySizeIsSixPlus),
      experienceOptionIds: (experienceOptionIds as string[] | undefined) ?? [],
      items: validatedItems.items,
      idempotencyKey,
      ...(typeof privateNote === "string" ? { privateNote } : {}),
    },
  };
}

export type SubmitOutcome =
  | { ok: true; contributionId: string | null }
  | { ok: false; status: 404 | 409 | 410 | 422 | 500; error: string };

/** Calls submit_discovery_contribution and maps its SQLSTATEs to HTTP outcomes. */
export async function submitDiscoveryContribution(
  hubUserId: string,
  requestId: string,
  answers: ContributionAnswers,
): Promise<SubmitOutcome> {
  const { data, error } = await createAdminClient().rpc("submit_discovery_contribution", {
    p_request_id: requestId,
    p_hub_user_id: hubUserId,
    p_would_recommend: answers.wouldRecommend,
    p_negative_reason_id: answers.negativeReasonId,
    p_party_size: answers.partySize,
    p_party_size_is_six_plus: answers.partySizeIsSixPlus,
    p_experience_option_ids: answers.experienceOptionIds,
    p_items: answers.items,
    p_idempotency_key: answers.idempotencyKey,
    ...(answers.privateNote !== undefined ? { p_private_note: answers.privateNote } : {}),
  });

  if (error) {
    if (error.code === "P0002") return { ok: false, status: 404, error: "not_found" };
    if (error.code === "55000") return { ok: false, status: 410, error: "expired" };
    if (error.code === "22023") return { ok: false, status: 409, error: "invalid_state" };
    if (error.code === "23514") return { ok: false, status: 422, error: error.message ?? "invalid_answer" };
    console.error("[discovery-contributions] submit failed:", error.code, error.message);
    return { ok: false, status: 500, error: "internal_error" };
  }

  const result = (Array.isArray(data) ? data[0] : data) as { contribution_id?: string } | undefined;
  return { ok: true, contributionId: result?.contribution_id ?? null };
}

export type ContributionTemplate = {
  recommendation_prompt: string;
  negative_reason_options: Array<{ id: string; label: string }>;
  party_size_prompt: string;
  item_prompt: string;
  recommendation_item_prompt: string;
  experience_prompt: string | null;
  experience_options: Array<{ id: string; inputLabel: string; publicLabel: string }>;
  max_experience_options: number;
  photo_prompt: string;
  photo_safety_guidance: string;
};

export type MemberContributionRequest = {
  id: string;
  state: string;
  expiresAt: string;
  merchant: { name: string; slug: string | null };
  template: ContributionTemplate;
  /** The saved answers, when the member already recommended (never a withdrawn one). */
  contribution: {
    id: string;
    wouldRecommend: boolean | null;
    negativeReasonId: string | null;
    partySize: number | null;
    partySizeIsSixPlus: boolean;
    experienceOptionIds: string[];
    privateNote: string;
    items: Array<{ clientItemKey: string; rawLabel: string; isRecommended: boolean }>;
  } | null;
};

type MentionShape = { client_item_key: string; raw_label: string };
type ContributionRow = {
  id: string;
  would_recommend: boolean | null;
  negative_reason_id: string | null;
  party_size: number | null;
  party_size_is_six_plus: boolean;
  experience_option_ids: string[] | null;
  withdrawn_at: string | null;
  private_note: string | null;
  items: Array<{ is_recommended: boolean; mention: MentionShape | MentionShape[] | null }> | null;
};

// PostgREST may return a to-one embed as an object or a one-element array
// without generated types; accept either.
function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** The member's own request with its template and saved answers, or null. */
export async function loadMemberContributionRequest(
  hubUserId: string,
  requestId: string,
): Promise<MemberContributionRequest | null> {
  const { data: request, error } = await createAdminClient()
    .from("discovery_contribution_requests")
    .select(
      "id, state, expires_at, template_snapshot, merchant:partners(name, slug), contribution:merchant_discovery_contributions(id, would_recommend, negative_reason_id, party_size, party_size_is_six_plus, experience_option_ids, withdrawn_at, private_note, items:merchant_discovery_contribution_items(is_recommended, mention:merchant_discovery_item_mentions(client_item_key, raw_label)))",
    )
    .eq("id", requestId)
    .eq("hub_user_id", hubUserId)
    .maybeSingle();

  if (error) throw new Error(`contribution request lookup failed: ${error.message}`);
  if (!request) return null;

  const raw = request as unknown as {
    merchant?: { name?: string; slug?: string } | Array<{ name?: string; slug?: string }> | null;
    contribution?: ContributionRow | ContributionRow[] | null;
  };
  const merchant = one(raw.merchant ?? null);
  const row = one(raw.contribution ?? null);
  // Never hydrate from a withdrawn contribution — editing should start
  // fresh, not resurrect something the member deliberately took back.
  const live = row && !row.withdrawn_at ? row : null;

  return {
    id: request.id,
    state: request.state,
    expiresAt: request.expires_at,
    merchant: { name: merchant?.name ?? "this place", slug: merchant?.slug ?? null },
    template: request.template_snapshot as ContributionTemplate,
    contribution: live
      ? {
          id: live.id,
          wouldRecommend: live.would_recommend,
          negativeReasonId: live.negative_reason_id,
          partySize: live.party_size,
          partySizeIsSixPlus: live.party_size_is_six_plus,
          experienceOptionIds: live.experience_option_ids ?? [],
          privateNote: live.private_note ?? "",
          items: (live.items ?? [])
            .map((item) => ({ mention: one(item.mention), isRecommended: item.is_recommended }))
            .filter((item): item is { mention: MentionShape; isRecommended: boolean } => item.mention !== null)
            .map((item) => ({
              clientItemKey: item.mention.client_item_key,
              rawLabel: item.mention.raw_label,
              isRecommended: item.isRecommended,
            })),
        }
      : null,
  };
}
