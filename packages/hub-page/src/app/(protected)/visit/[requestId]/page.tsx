import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { VisitCardFlow, type InitialContribution } from "./VisitCardFlow";

// Visit-card contribution flow (verified-discovery-acquisition-v1-spec.md
// §8.3) — the dedicated route entry point for the home pending-nudge and
// notification-feed surfaces (§8.2 surfaces 2-3). The in-success-surface
// bottom-sheet entry point (surface 1) is a later addition; this route also
// works fine linked to directly in the meantime.
export const metadata = { title: "Add your visit — Akiba" };

type MentionShape = { client_item_key: string; raw_label: string };

type ContributionRow = {
  would_recommend: boolean | null;
  negative_reason_id: string | null;
  party_size: number | null;
  party_size_is_six_plus: boolean;
  experience_option_ids: string[];
  withdrawn_at: string | null;
  items: Array<{
    is_recommended: boolean;
    // PostgREST's embed cardinality for a forward FK is normally a single
    // object, but without generated Database types the client can't infer
    // that for a nested embed — handle either shape defensively rather than
    // assume one.
    mention: MentionShape | MentionShape[] | null;
  }> | null;
};

// PostgREST returns a reverse-FK embed as a single object (not an array)
// when the child's FK column is UNIQUE — which request_id is here — but
// without generated Database types the client's own inference can't be
// trusted to reflect that, so normalize defensively instead of assuming
// either shape.
function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function VisitCardPage({ params }: { params: { requestId: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) redirect(`/login?next=/visit/${params.requestId}`);

  const admin = createAdminClient();
  const { data: request } = await admin
    .from("discovery_contribution_requests")
    .select(
      "id, state, expires_at, template_snapshot, merchant:partners(name, slug), contribution:merchant_discovery_contributions(would_recommend, negative_reason_id, party_size, party_size_is_six_plus, experience_option_ids, withdrawn_at, items:merchant_discovery_contribution_items(is_recommended, mention:merchant_discovery_item_mentions(client_item_key, raw_label)))",
    )
    .eq("id", params.requestId)
    .eq("hub_user_id", user.id)
    .maybeSingle();

  if (!request) notFound();

  const merchant = (request as { merchant?: { name?: string; slug?: string } | null }).merchant;
  const merchantName = merchant?.name ?? "this merchant";
  const merchantSlug = merchant?.slug ?? null;

  const contributionRow = one(
    (request as unknown as { contribution?: ContributionRow | ContributionRow[] | null }).contribution,
  );
  // Never hydrate from a withdrawn contribution — editing should start
  // fresh, not resurrect something the member deliberately took back.
  const resolvedContributionRow = contributionRow && !contributionRow.withdrawn_at ? contributionRow : null;

  const initialContribution: InitialContribution | null = resolvedContributionRow
    ? {
        wouldRecommend: resolvedContributionRow.would_recommend,
        negativeReasonId: resolvedContributionRow.negative_reason_id,
        partySize: resolvedContributionRow.party_size,
        partySizeIsSixPlus: resolvedContributionRow.party_size_is_six_plus,
        experienceOptionIds: resolvedContributionRow.experience_option_ids ?? [],
        items: (resolvedContributionRow.items ?? [])
          .map((item) => ({ mention: one(item.mention), isRecommended: item.is_recommended }))
          .filter((item): item is { mention: MentionShape; isRecommended: boolean } => item.mention !== null)
          .map((item) => ({
            clientItemKey: item.mention.client_item_key,
            rawLabel: item.mention.raw_label,
            isRecommended: item.isRecommended,
          })),
      }
    : null;

  return (
    <VisitCardFlow
      requestId={request.id}
      merchantName={merchantName}
      merchantSlug={merchantSlug}
      templateSnapshot={request.template_snapshot}
      initialState={request.state}
      expiresAt={request.expires_at}
      initialContribution={initialContribution}
    />
  );
}
