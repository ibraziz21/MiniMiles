import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { VoucherTabs } from "./VoucherTabs";
import { HIDDEN_PARTNER_FILTER, isHiddenPartner } from "@/lib/akiba/hidden-partners";
import type { FundedOffer } from "@/components/vouchers/FundedOfferCard";

export const metadata = { title: "Vouchers & Rewards — Akiba Pass" };
export const revalidate = 60;

type VoucherTemplate = {
  id: string;
  title: string;
  voucher_type: "free" | "percent_off" | "fixed_off";
  miles_cost: number;
  discount_percent: number | null;
  discount_cusd: number | null;
  applicable_category: string | null;
  retail_value_cusd: number | null;
  partners: {
    id: string;
    slug: string;
    name: string;
    image_url: string | null;
  } | null;
};

async function getAllTemplates(hubUserId: string | null): Promise<VoucherTemplate[]> {
  const admin = createAdminClient();
  const { data: availability, error: availabilityError } = await admin.rpc(
    "list_available_voucher_template_ids_hub",
    { p_hub_user_id: hubUserId },
  );
  if (availabilityError) {
    console.error("[vouchers] availability query failed:", availabilityError.message);
    return [];
  }
  const templateIds = (availability ?? []).map(
    (row: { template_id: string } | string) =>
      typeof row === "string" ? row : row.template_id,
  );
  if (templateIds.length === 0) return [];

  const { data } = await admin
    .from("spend_voucher_templates")
    .select(`
      id, title, voucher_type, miles_cost, discount_percent, discount_cusd,
      applicable_category, retail_value_cusd,
      partners ( id, slug, name, image_url )
    `)
    .in("id", templateIds)
    .not("partner_id", "in", HIDDEN_PARTNER_FILTER)
    .order("miles_cost", { ascending: true });

  return ((data ?? []) as unknown[]).map((item) => {
    const d = item as Record<string, unknown>;
    const partners = Array.isArray(d.partners) ? d.partners[0] ?? null : d.partners;
    return { ...d, partners } as VoucherTemplate;
  });
}

type RawFundedAllocation = {
  id: string;
  claim_ends_at: string;
  spend_voucher_templates:
    | { title: string; description: string | null; terms_text: string | null; discount_kes: number | null; minimum_spend_kes: number | null }
    | Array<{ title: string; description: string | null; terms_text: string | null; discount_kes: number | null; minimum_spend_kes: number | null }>
    | null;
  partners:
    | { id: string; name: string; slug: string; image_url: string | null; status: string }
    | Array<{ id: string; name: string; slug: string; image_url: string | null; status: string }>
    | null;
  voucher_eligibility_rule_sets:
    | { customer_copy: string | null }
    | Array<{ customer_copy: string | null }>
    | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Active Akiba-funded voucher offers — mirrors the filter Akiba-Platform's
 * own public discovery endpoint (GET /api/v1/voucher-funding-allocations)
 * uses, queried directly since hub-page already holds a service-role client
 * for cross-service reads elsewhere (myVouchers.ts). Never Miles-priced —
 * see akiba-funded-voucher-admin-spec.md §7.3.
 */
async function getFundedOffers(): Promise<FundedOffer[]> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("voucher_funding_allocations")
    .select(`
      id, claim_ends_at,
      spend_voucher_templates!voucher_funding_allocations_voucher_template_id_fkey ( title, description, terms_text, discount_kes, minimum_spend_kes ),
      partners ( id, name, slug, image_url, status ),
      voucher_eligibility_rule_sets ( customer_copy )
    `)
    .eq("state", "active")
    .lte("claim_starts_at", nowIso)
    .gt("claim_ends_at", nowIso);

  if (error) {
    console.error("[vouchers] funded offers query failed:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as RawFundedAllocation[];
  const offers: FundedOffer[] = [];
  for (const row of rows) {
    const template = one(row.spend_voucher_templates);
    const merchant = one(row.partners);
    const ruleSet = one(row.voucher_eligibility_rule_sets);
    if (!template || !merchant) continue;
    if (merchant.status !== "active") continue;
    if (isHiddenPartner(merchant.id)) continue;
    if (template.discount_kes == null || template.minimum_spend_kes == null) continue;

    offers.push({
      allocationId: row.id,
      title: template.title,
      discountKes: template.discount_kes,
      minimumSpendKes: template.minimum_spend_kes,
      terms: template.terms_text,
      eligibilitySummary: ruleSet?.customer_copy ?? null,
      claimEndsAt: row.claim_ends_at,
      merchant: { name: merchant.name, slug: merchant.slug, imageUrl: merchant.image_url },
    });
  }
  return offers;
}

/**
 * Which of the current member's funded-offer allocations they've already
 * claimed — computed directly against the DB with the same canonical-id
 * resolution Akiba-Platform's own eligibility/claim routes use (identity_links
 * keyed by email, falling back to the Supabase user id), rather than routing
 * through Platform's HTTP+JWT chain from the client. That chain has more
 * failure points (network, session-cookie timing, Platform's own auth) for a
 * fact the page can just read straight from the same tables it already
 * queries above — see ClaimOfferButton's client-side preview for the
 * eligibility *reasons*, which still goes through Platform since that's real
 * business logic this page must not reimplement.
 */
async function getClaimedAllocationIds(userId: string | null, email: string | null): Promise<Set<string>> {
  if (!userId) return new Set();
  const admin = createAdminClient();

  let canonicalId = userId;
  if (email) {
    const { data: link } = await admin
      .from("identity_links")
      .select("canonical_id")
      .eq("identity_type", "email")
      .eq("identity_value", email)
      .maybeSingle();
    if (link?.canonical_id) canonicalId = link.canonical_id;
  }

  const { data, error } = await admin.from("voucher_claims").select("allocation_id").eq("canonical_id", canonicalId);
  if (error) {
    console.error("[vouchers] claimed-allocations query failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.allocation_id as string));
}

export default async function VouchersPage({
  searchParams,
}: {
  searchParams: { quest?: string };
}) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  const [templates, fundedOffers, claimedAllocationIds] = await Promise.all([
    getAllTemplates(user?.id ?? null),
    getFundedOffers(),
    getClaimedAllocationIds(user?.id ?? null, user?.email ?? null),
  ]);
  const questMode = searchParams.quest === "deal_viewed";

  return (
    <main className="mx-auto max-w-7xl px-4 pb-8 pt-4 sm:px-6 sm:pb-12 sm:pt-8 lg:px-8">
      <VoucherTabs
        templates={templates}
        fundedOffers={fundedOffers}
        claimedAllocationIds={[...claimedAllocationIds]}
        isSignedIn={!!user}
        questMode={questMode}
      />
    </main>
  );
}
