// Next Reward Progress V1 — next-reward-progress-v1-spec.md. Turns a
// member's spendable Miles balance into progress toward one automatically
// selected, currently-available merchant voucher (§6), plus (on /me only)
// truthful "ways to get closer" (§8).
//
// Split into two entry points per design review: getNextRewardSummary()
// (balance + target + progress — cheap, used by both home and /me) and
// getNextRewardWays() (quests + games — /me only, never called from the
// home feed, so home never pays for quest-evidence or games-backend calls).
import { createAdminClient } from "@/lib/supabase/admin";
import { HIDDEN_PARTNER_FILTER } from "@/lib/akiba/hidden-partners";
import { dealLabel, type VoucherTemplate } from "@/lib/akiba/deals";
import { getVoucherSpendableBalance } from "@/lib/akiba/voucherSpendableBalance";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getPurchaseAffinity } from "@/lib/merchants/enrich";
import { normalizeCountry } from "@/lib/akiba/countryCodes";
import { getHubQuestStatuses } from "@/lib/akiba/questStatus";
import { isHubQuestsEnabledFor } from "@/lib/akiba/hubQuestRollout";
import { isGamesEnabledFor } from "@/lib/games/gamesRollout";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { gamesBackend } from "@/lib/games/backendClient";
import { GAME_TYPES, GAME_MAX_REWARD_MILES } from "@/lib/games/gameRewardRules";

export type OperatingModel = "physical" | "hybrid" | "online";

export type RewardCandidate = {
  templateId: string;
  merchantId: string;
  merchantSlug: string;
  merchantName: string;
  merchantLogoUrl: string | null;
  operatingModel: OperatingModel;
  countryCode: string | null;
  title: string;
  benefitLabel: string;
  milesCost: number;
  expiresAt: string | null;
  gapMiles: number;
  affordable: boolean;
  countryMatch: boolean;
  hasPurchaseAffinity: boolean;
};

type RawCandidate = Omit<
  RewardCandidate,
  "gapMiles" | "affordable" | "countryMatch" | "hasPurchaseAffinity"
>;

export type NextRewardTarget = {
  templateId: string;
  merchantId: string;
  merchantSlug: string;
  merchantName: string;
  merchantLogoUrl: string | null;
  title: string;
  benefitLabel: string;
  milesCost: number;
  expiresAt: string | null;
  explanation: string;
};

export type NextRewardProgressDetail = { gapMiles: number; percent: number; affordable: boolean };

export type NextRewardSummary =
  | { state: "balance_unavailable" }
  | { state: "inventory_unavailable"; balance: number }
  | { state: "no_eligible_reward"; balance: number }
  | {
      state: "recommended";
      balance: number;
      recommendationLabel: "recommended_for_you" | "easiest_to_unlock" | "available_now";
      target: NextRewardTarget;
      progress: NextRewardProgressDetail;
    };

export type NextRewardWay =
  | {
      kind: "quest";
      key: string;
      label: string;
      miles: number;
      certainty: "exact_after_verification";
      href: string;
    }
  | { kind: "game"; label: string; potentialMiles: number; certainty: "up_to"; href: "/games" }
  | { kind: "shopping"; label: string; certainty: "variable"; href: "/merchants" };

/** Zero-cost row — no lookups — so a caller that must stay cheap (home) can
 *  still show one truthful "way to get closer" line. */
export const NEXT_REWARD_SHOPPING_WAY: NextRewardWay = {
  kind: "shopping",
  label: "Shop with Akiba merchants",
  certainty: "variable",
  href: "/merchants",
};

// ─── Progress (§7) ──────────────────────────────────────────────────────────

export function computeProgress(balance: number, milesCost: number): NextRewardProgressDetail {
  const gapMiles = Math.max(milesCost - balance, 0);
  const percent = Math.min(100, Math.max(0, Math.floor((balance / milesCost) * 100)));
  return { gapMiles, percent, affordable: gapMiles === 0 };
}

// ─── Candidate loading (§6.1/§6.2) ─────────────────────────────────────────

type CandidatePartnerSettings = { directory_status: string; store_presence: "physical" | "both" | "online" };
type CandidatePartner = {
  id: string;
  slug: string;
  name: string;
  image_url: string | null;
  country: string | null;
  type: string;
  status: string;
  partner_settings: CandidatePartnerSettings | CandidatePartnerSettings[];
};
type CandidateRow = {
  id: string;
  title: string;
  voucher_type: VoucherTemplate["voucher_type"];
  discount_percent: number | null;
  discount_cusd: number | null;
  miles_cost: number;
  expires_at: string | null;
  partners: CandidatePartner | CandidatePartner[];
};

function operatingModelFromStorePresence(storePresence: string | undefined): OperatingModel {
  if (storePresence === "online") return "online";
  if (storePresence === "both") return "hybrid";
  return "physical";
}

/** Returns null on a query/RPC failure (→ inventory_unavailable), distinct
 *  from a genuinely empty array (→ no_eligible_reward). */
async function loadEligibleCandidates(hubUserId: string): Promise<RawCandidate[] | null> {
  const admin = createAdminClient();

  const { data: templates, error } = await admin
    .from("spend_voucher_templates")
    .select(
      `id, title, voucher_type, discount_percent, discount_cusd, miles_cost, expires_at,
       partners!inner (
         id, slug, name, image_url, country, type, status,
         partner_settings!inner ( directory_status, store_presence )
       )`
    )
    .eq("active", true)
    .eq("partners.type", "merchant")
    .eq("partners.status", "active")
    .eq("partners.partner_settings.directory_status", "published")
    .not("partner_id", "in", HIDDEN_PARTNER_FILTER);

  if (error) {
    console.error("[nextReward] candidate query failed:", error.message);
    return null;
  }
  if (!templates || templates.length === 0) return [];

  const { data: availableRows, error: availabilityErr } = await admin.rpc(
    "list_available_voucher_template_ids_hub",
    { p_hub_user_id: hubUserId }
  );
  if (availabilityErr) {
    console.error("[nextReward] availability RPC failed:", availabilityErr.message);
    return null;
  }
  const availableIds = new Set(
    (availableRows ?? []).map((r: { template_id: string } | string) =>
      typeof r === "string" ? r : r.template_id
    )
  );

  const candidates: RawCandidate[] = [];
  for (const row of templates as unknown as CandidateRow[]) {
    if (!availableIds.has(row.id)) continue;
    if (!Number.isFinite(row.miles_cost) || row.miles_cost <= 0) continue;

    const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners;
    if (!partner?.id || !partner.name || !partner.slug) continue;

    const settings = Array.isArray(partner.partner_settings)
      ? partner.partner_settings[0]
      : partner.partner_settings;

    candidates.push({
      templateId: row.id,
      merchantId: partner.id,
      merchantSlug: partner.slug,
      merchantName: partner.name,
      merchantLogoUrl: partner.image_url,
      operatingModel: operatingModelFromStorePresence(settings?.store_presence),
      countryCode: normalizeCountry(partner.country),
      title: row.title,
      benefitLabel: dealLabel(row as unknown as VoucherTemplate),
      milesCost: row.miles_cost,
      expiresAt: row.expires_at,
    });
  }
  return candidates;
}

function decorateCandidates(
  raw: RawCandidate[],
  balance: number,
  memberCountryCode: string | null,
  purchaseAffinity: Set<string>
): RewardCandidate[] {
  return raw.map((c) => ({
    ...c,
    gapMiles: Math.max(c.milesCost - balance, 0),
    affordable: c.milesCost <= balance,
    countryMatch: memberCountryCode !== null && c.countryCode !== null && memberCountryCode === c.countryCode,
    hasPurchaseAffinity: purchaseAffinity.has(c.merchantId),
  }));
}

// ─── Selection (§6.3/§6.4) ──────────────────────────────────────────────────

function compareExpiresNameId(a: RewardCandidate, b: RewardCandidate): number {
  if (a.expiresAt !== b.expiresAt) {
    if (a.expiresAt === null) return 1;
    if (b.expiresAt === null) return -1;
    return a.expiresAt < b.expiresAt ? -1 : 1;
  }
  const nameCmp = a.merchantName.localeCompare(b.merchantName);
  if (nameCmp !== 0) return nameCmp;
  return a.templateId < b.templateId ? -1 : a.templateId > b.templateId ? 1 : 0;
}

/** Ignores affinity/country entirely — used only to test whether those
 *  signals actually changed the outcome (see selectRewardCandidate). */
function baselineSort(a: RewardCandidate, b: RewardCandidate): number {
  if (a.gapMiles !== b.gapMiles) return a.gapMiles - b.gapMiles;
  return compareExpiresNameId(a, b);
}

function fullSort(a: RewardCandidate, b: RewardCandidate): number {
  if (a.gapMiles !== b.gapMiles) return a.gapMiles - b.gapMiles;
  if (a.hasPurchaseAffinity !== b.hasPurchaseAffinity) return a.hasPurchaseAffinity ? -1 : 1;
  if (a.countryMatch !== b.countryMatch) return a.countryMatch ? -1 : 1;
  return compareExpiresNameId(a, b);
}

export type SelectionResult = {
  candidate: RewardCandidate;
  recommendationLabel: "recommended_for_you" | "easiest_to_unlock" | "available_now";
  explanation: string;
};

export function selectRewardCandidate(
  candidates: RewardCandidate[],
  ctx: { memberCountryName: string | null }
): SelectionResult | null {
  if (candidates.length === 0) return null;

  const affordablePool = candidates.filter((c) => c.affordable);
  const isAffordablePool = affordablePool.length > 0;
  const pool = isAffordablePool ? affordablePool : candidates;

  const relevant = pool.filter((c) => c.countryMatch || c.hasPurchaseAffinity || c.operatingModel === "online");
  const rankPool = relevant.length > 0 ? relevant : pool;

  const winner = [...rankPool].sort(fullSort)[0];

  if (isAffordablePool) {
    return { candidate: winner, recommendationLabel: "available_now", explanation: "Available with your current balance" };
  }

  // A candidate merely *having* affinity/a country match doesn't prove it
  // changed the outcome — compare against a baseline pick that ignores both
  // signals entirely (same pool, no relevant-subset restriction).
  const baselineWinner = [...pool].sort(baselineSort)[0];
  if (winner.templateId === baselineWinner.templateId) {
    return { candidate: winner, recommendationLabel: "easiest_to_unlock", explanation: "Easiest available reward to unlock" };
  }

  const explanation = winner.hasPurchaseAffinity
    ? "You have shopped here before"
    : winner.countryMatch
      ? `Available from a merchant in ${ctx.memberCountryName ?? "your country"}`
      : "Available online";
  return { candidate: winner, recommendationLabel: "recommended_for_you", explanation };
}

// ─── Member country resolution ─────────────────────────────────────────────

async function resolveMemberCountry(opts: {
  hubUserId: string;
  email: string | null;
  /** Pass the caller's already-resolved legacy country (e.g. home's
   *  resolveHubProfile().activeRow.country) to skip a redundant lookup. */
  legacyCountry?: string | null;
}): Promise<{ code: string | null; name: string | null }> {
  const admin = createAdminClient();
  const [{ data: hubProfile }, legacyCountry] = await Promise.all([
    admin.from("hub_user_profiles").select("country").eq("user_id", opts.hubUserId).maybeSingle(),
    opts.legacyCountry !== undefined
      ? Promise.resolve(opts.legacyCountry)
      : resolveHubProfile({ userId: opts.hubUserId, email: opts.email }).then((p) => p.activeRow?.country ?? null),
  ]);
  const name = hubProfile?.country ?? legacyCountry ?? null;
  return { code: normalizeCountry(name), name };
}

// ─── Summary (balance + target + progress) — home + /me ────────────────────

export async function getNextRewardSummary(opts: {
  hubUserId: string;
  email: string | null;
  /** Reuse a caller's already-computed purchase-affinity set (e.g. home's
   *  buildForYouSection()) instead of re-querying merchant_transactions. */
  purchaseAffinity?: Set<string>;
  legacyCountry?: string | null;
}): Promise<NextRewardSummary> {
  const [spendable, country, rawCandidates, affinity] = await Promise.all([
    getVoucherSpendableBalance({ hubUserId: opts.hubUserId, email: opts.email }),
    resolveMemberCountry({ hubUserId: opts.hubUserId, email: opts.email, legacyCountry: opts.legacyCountry }),
    loadEligibleCandidates(opts.hubUserId),
    opts.purchaseAffinity ? Promise.resolve(opts.purchaseAffinity) : getPurchaseAffinity(opts.hubUserId),
  ]);

  if (!spendable.ok || spendable.balance === null) {
    return { state: "balance_unavailable" };
  }
  const balance = spendable.balance;

  if (rawCandidates === null) {
    return { state: "inventory_unavailable", balance };
  }
  if (rawCandidates.length === 0) {
    return { state: "no_eligible_reward", balance };
  }

  const candidates = decorateCandidates(rawCandidates, balance, country.code, affinity);
  const selection = selectRewardCandidate(candidates, { memberCountryName: country.name });
  if (!selection) {
    return { state: "no_eligible_reward", balance };
  }

  return {
    state: "recommended",
    balance,
    recommendationLabel: selection.recommendationLabel,
    target: {
      templateId: selection.candidate.templateId,
      merchantId: selection.candidate.merchantId,
      merchantSlug: selection.candidate.merchantSlug,
      merchantName: selection.candidate.merchantName,
      merchantLogoUrl: selection.candidate.merchantLogoUrl,
      title: selection.candidate.title,
      benefitLabel: selection.candidate.benefitLabel,
      milesCost: selection.candidate.milesCost,
      expiresAt: selection.candidate.expiresAt,
      explanation: selection.explanation,
    },
    progress: computeProgress(balance, selection.candidate.milesCost),
  };
}

// ─── Ways to earn (§8) — /me only ───────────────────────────────────────────

export async function getNextRewardWays(opts: { hubUserId: string; email: string | null }): Promise<NextRewardWay[]> {
  const identifier = opts.email ?? opts.hubUserId;
  const eligibleWays: NextRewardWay[] = [];
  const needsActionWays: NextRewardWay[] = [];
  const otherWays: NextRewardWay[] = [];

  if (isHubQuestsEnabledFor(identifier)) {
    try {
      const quests = await getHubQuestStatuses({ hubUserId: opts.hubUserId, email: opts.email });
      for (const quest of quests) {
        // Circular per the spec's own example: redeeming a voucher can't be
        // "the way to get" a first voucher.
        if (quest.key === "voucher_redeemed") continue;
        if (quest.state === "eligible") {
          // The Claim button lives on /quests, not the quest's own actionHref.
          eligibleWays.push({
            kind: "quest",
            key: quest.key,
            label: quest.title,
            miles: quest.miles,
            certainty: "exact_after_verification",
            href: "/quests",
          });
        } else if (quest.state === "needs_action") {
          needsActionWays.push({
            kind: "quest",
            key: quest.key,
            label: quest.title,
            miles: quest.miles,
            certainty: "exact_after_verification",
            href: quest.actionHref,
          });
        }
      }
    } catch (err) {
      console.error("[nextReward] quest ways lookup failed:", err);
    }
  }

  if (isGamesEnabledFor(identifier)) {
    try {
      const canonicalId = await resolveHubQuestCanonical({ hubUserId: opts.hubUserId, email: opts.email });
      const identity = { canonicalId, hubUserId: opts.hubUserId };
      const results = await Promise.allSettled(
        GAME_TYPES.map((gameType) => gamesBackend.status(identity, gameType))
      );
      let potentialMiles = 0;
      let anyFulfilled = false;
      for (const result of results) {
        if (result.status === "fulfilled") {
          anyFulfilled = true;
          potentialMiles += Math.max(result.value.playsRemaining, 0) * GAME_MAX_REWARD_MILES;
        }
      }
      if (anyFulfilled && potentialMiles > 0) {
        otherWays.push({
          kind: "game",
          label: "Play today's skill games",
          potentialMiles,
          certainty: "up_to",
          href: "/games",
        });
      }
    } catch (err) {
      console.error("[nextReward] game ways lookup failed:", err);
    }
  }

  otherWays.push(NEXT_REWARD_SHOPPING_WAY);

  return [...eligibleWays, ...needsActionWays, ...otherWays].slice(0, 3);
}
