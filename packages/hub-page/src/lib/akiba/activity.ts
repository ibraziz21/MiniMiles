/**
 * Recent activity for a hub user, merged from every earn/award source:
 *
 *  1. daily_engagements      — daily quest claims (engagement layer, by wallet)
 *  2. partner_engagements    — partner quest claims (engagement layer, by wallet)
 *  3. minipoint_mint_jobs    — profile milestones & streak bonuses only
 *                              (all other completed jobs are already covered by
 *                              the engagement tables — same rule as react-app
 *                              /api/history to avoid double counting)
 *  4. issued_vouchers        — merchant scan grants (merchant_grant / akiba_grant /
 *                              giveaway) and voucher redemptions, by hub_user_id
 *                              or wallet address
 *
 * Server-side only (uses the service-role admin client).
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type ActivityKind =
  | "daily_quest"
  | "partner_quest"
  | "bonus"
  | "voucher_grant"
  | "voucher_redeem"
  | "merchant_award"
  | "miles_spent";

export type ActivityItem = {
  id: string;
  /** unix milliseconds */
  ts: number;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  /** miles earned, when the event awarded points */
  miles: number | null;
};

/**
 * Off-chain Miles balance from the Platform ledger (unclaimed loyalty Miles).
 * Sums credits − debits over the user's canonicals (email + wallet), excluding
 * rows already bridged on-chain. Same Supabase project — direct query.
 */
export async function getLedgerBalance(opts: {
  email: string | null;
  walletAddress: string | null;
}): Promise<number> {
  const { email, walletAddress } = opts;
  const wallet = walletAddress?.toLowerCase() ?? null;
  const admin = createAdminClient();

  const identityFilters: string[] = [];
  if (email) identityFilters.push(`and(identity_type.eq.email,identity_value.eq.${email})`);
  if (wallet) identityFilters.push(`and(identity_type.eq.wallet,identity_value.eq.${wallet})`);
  if (identityFilters.length === 0) return 0;

  try {
    const { data: links } = await admin
      .from("identity_links")
      .select("canonical_id")
      .or(identityFilters.join(","));

    const canonicalIds = [...new Set((links ?? []).map((l: any) => l.canonical_id))];
    if (canonicalIds.length === 0) return 0;

    const { data: rows } = await admin
      .from("miles_ledger")
      .select("amount, direction")
      .in("canonical_id", canonicalIds)
      .eq("on_chain", false);

    return (rows ?? []).reduce(
      (sum: number, r: any) =>
        sum + (r.direction === "credit" ? Number(r.amount) : -Number(r.amount)),
      0,
    );
  } catch (err) {
    console.error("[activity] ledger balance failed:", err);
    return 0;
  }
}

const GRANT_SOURCES: Record<string, string> = {
  merchant_grant: "Merchant gift",
  akiba_grant: "Akiba gift",
  giveaway: "Giveaway",
};

function bonusTitle(reason: string): string {
  if (reason === "profile-milestone-50") return "Profile 50% complete bonus";
  if (reason === "profile-milestone-100") return "Profile 100% complete bonus";
  if (reason.startsWith("streak:")) return `Streak reward — ${reason.slice(7)}`;
  return "Bonus reward";
}

function ts(dateStr: string): number {
  return new Date(dateStr).getTime();
}

export async function getRecentActivity(opts: {
  userId: string;
  walletAddress: string | null;
  /** Enables merchant scan-award events from the Platform miles ledger */
  email?: string | null;
  limit?: number;
}): Promise<ActivityItem[]> {
  const { userId, walletAddress, email = null, limit = 20 } = opts;
  const admin = createAdminClient();
  const wallet = walletAddress?.toLowerCase() ?? null;

  const voucherFilter = wallet
    ? `hub_user_id.eq.${userId},user_address.eq.${wallet}`
    : `hub_user_id.eq.${userId}`;

  const [dailyRes, partnerRes, mintRes, voucherRes] = await Promise.allSettled([
    wallet
      ? admin
          .from("daily_engagements")
          .select("id, claimed_at, points_awarded, quests(title)")
          .eq("user_address", wallet)
          .order("claimed_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [], error: null }),

    wallet
      ? admin
          .from("partner_engagements")
          .select("id, claimed_at, points_awarded, partner_quests(title)")
          .eq("user_address", wallet)
          .order("claimed_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [], error: null }),

    wallet
      ? admin
          .from("minipoint_mint_jobs")
          .select("id, points, reason, created_at")
          .eq("user_address", wallet)
          .eq("status", "completed")
          .or("reason.like.profile-milestone-%,reason.like.streak:%")
          .order("created_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [], error: null }),

    admin
      .from("issued_vouchers")
      .select(
        `id, created_at, redeemed_at, acquisition_source, sponsor,
         spend_voucher_templates ( title, partners ( name ) )`
      )
      .or(voucherFilter)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const items: ActivityItem[] = [];

  if (dailyRes.status === "fulfilled" && !dailyRes.value.error) {
    for (const row of (dailyRes.value.data ?? []) as any[]) {
      items.push({
        id: `daily-${row.id}`,
        ts: ts(row.claimed_at),
        kind: "daily_quest",
        title: row.quests?.title ?? "Daily quest reward",
        detail: "Daily quest",
        miles: Number(row.points_awarded ?? 0),
      });
    }
  }

  if (partnerRes.status === "fulfilled" && !partnerRes.value.error) {
    for (const row of (partnerRes.value.data ?? []) as any[]) {
      items.push({
        id: `partner-${row.id}`,
        ts: ts(row.claimed_at),
        kind: "partner_quest",
        title: row.partner_quests?.title ?? "Partner quest reward",
        detail: "Partner quest",
        miles: Number(row.points_awarded ?? 0),
      });
    }
  }

  if (mintRes.status === "fulfilled" && !mintRes.value.error) {
    for (const row of (mintRes.value.data ?? []) as any[]) {
      items.push({
        id: `mint-${row.id}`,
        ts: ts(row.created_at),
        kind: "bonus",
        title: bonusTitle(row.reason ?? ""),
        detail: "Bonus",
        miles: Number(row.points ?? 0),
      });
    }
  }

  if (voucherRes.status === "fulfilled" && !voucherRes.value.error) {
    for (const row of (voucherRes.value.data ?? []) as any[]) {
      const tpl = row.spend_voucher_templates;
      const voucherTitle: string = tpl?.title ?? "Voucher";
      const partnerName: string | null = tpl?.partners?.name ?? null;
      const sourceLabel = GRANT_SOURCES[row.acquisition_source ?? ""];

      // Grant event — only for awarded (scanned/gifted) vouchers, not purchases
      if (sourceLabel) {
        items.push({
          id: `vgrant-${row.id}`,
          ts: ts(row.created_at),
          kind: "voucher_grant",
          title: partnerName
            ? `${partnerName} awarded you “${voucherTitle}”`
            : `You received “${voucherTitle}”`,
          detail: row.sponsor ? `${sourceLabel} · ${row.sponsor}` : sourceLabel,
          miles: null,
        });
      }

      // Redemption event — any voucher, any source
      if (row.redeemed_at) {
        items.push({
          id: `vredeem-${row.id}`,
          ts: ts(row.redeemed_at),
          kind: "voucher_redeem",
          title: `Redeemed “${voucherTitle}”`,
          detail: partnerName ?? "Voucher",
          miles: null,
        });
      }
    }
  }

  // ── 5. Platform miles ledger — merchant scan-awards & loyalty spends ───────
  // (Same Supabase project. Canonical IDs resolved via identity_links for the
  //  user's email and wallet — covers awards issued before identities linked.)
  try {
    const identityFilters: string[] = [];
    if (email) identityFilters.push(`and(identity_type.eq.email,identity_value.eq.${email})`);
    if (wallet) identityFilters.push(`and(identity_type.eq.wallet,identity_value.eq.${wallet})`);

    if (identityFilters.length > 0) {
      const { data: links } = await admin
        .from("identity_links")
        .select("canonical_id")
        .or(identityFilters.join(","));

      const canonicalIds = [...new Set((links ?? []).map((l: any) => l.canonical_id))];

      if (canonicalIds.length > 0) {
        const { data: ledger } = await admin
          .from("miles_ledger")
          .select("id, amount, direction, source_type, partner_id, note, created_at, partners ( name )")
          .in("canonical_id", canonicalIds)
          .neq("source_type", "reversal") // internal bookkeeping (bridge), not user activity
          .order("created_at", { ascending: false })
          .limit(limit);

        for (const row of (ledger ?? []) as any[]) {
          const partnerName: string | null = row.partners?.name ?? null;
          const isCredit = row.direction === "credit";
          items.push({
            id: `ledger-${row.id}`,
            ts: ts(row.created_at),
            kind: isCredit ? "merchant_award" : "miles_spent",
            title: isCredit
              ? partnerName
                ? `Earned at ${partnerName}`
                : "Miles awarded"
              : partnerName
                ? `Spent at ${partnerName}`
                : "Miles spent",
            detail: isCredit ? "In-store award" : "Redemption",
            miles: isCredit ? Number(row.amount) : -Number(row.amount),
          });
        }
      }
    }
  } catch (err) {
    console.error("[activity] miles_ledger source failed:", err);
  }

  return items
    .filter((i) => Number.isFinite(i.ts))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}
