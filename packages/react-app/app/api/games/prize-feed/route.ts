// GET /api/games/prize-feed
// Session-authed. Cross-game "My Prizes" feed for the games hub (spend-earn
// companion spec games-hub-redesign-spec.md §3) — merges leaderboard voucher
// wins and Claw vouchers into one newest-first list, capped 10. This is a
// read-only feed with deep links; each game keeps its own claim flow.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { requireSession } from "@/lib/auth";
import { getClawVouchersForPlayer } from "@/lib/server/clawVouchers";
import { RewardClass } from "@/lib/clawTypes";

export type PrizeFeedEntry = {
  id: string;
  kind: "leaderboard_voucher" | "claw_voucher";
  title: string;
  subtitle: string;
  status: "action_needed" | "active" | "done" | "expired";
  cta: { label: string; href: string } | null;
  created_at: string;
  expires_at: string | null;
  // Extra fields beyond the minimal feed shape — only leaderboard_voucher
  // entries carry these, so the strip can drive claim/burn inline without a
  // second fetch.
  voucherId?: string;
  winMeta?: {
    game_type: string;
    week: string;
    rank: number;
    label: string;
    discount_percent: number;
    spend_cap_kes: number;
    marketplace_miles: number;
    burn_pct: number;
  } | null;
  merchant?: { name: string; country: string | null } | null;
};

const GAME_LABELS: Record<string, string> = {
  rule_tap: "Rule Tap",
  memory_flip: "Memory Flip",
};

const RANK_EMOJI: Record<number, string> = { 1: "🏆", 2: "🥈", 3: "🥉" };
const RANK_PLACE: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

const CLAW_TIER_NAMES: Record<number, string> = { 0: "Basic", 1: "Boosted", 2: "Premium" };

function clawDiscountLabel(rewardClass: number, discountBps: number): string {
  if (rewardClass === RewardClass.Legendary) return "100% off (capped)";
  if (rewardClass === RewardClass.Rare) return "20% off";
  return `${(discountBps / 100).toFixed(0)}% off`;
}

const LEADERBOARD_SELECT = `
  id, code, status, created_at, expires_at, win_seen_at, win_meta, merchant_id,
  spend_merchants ( slug, name, country, image_url )
`;

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const address = session.walletAddress.toLowerCase();

  const [leaderboardRes, clawRes] = await Promise.all([
    supabase
      .from("issued_vouchers")
      .select(LEADERBOARD_SELECT)
      .eq("user_address", address)
      .eq("acquisition_source", "leaderboard_win")
      .neq("status", "void")
      .order("created_at", { ascending: false })
      .limit(10),
    getClawVouchersForPlayer(address).catch((err) => {
      console.error("[prize-feed] claw lookup failed", err);
      return { vouchers: [] };
    }),
  ]);

  if (leaderboardRes.error) {
    console.error("[prize-feed] leaderboard vouchers query", leaderboardRes.error.message);
  }

  const leaderboardEntries: PrizeFeedEntry[] = (leaderboardRes.data ?? [])
    .filter((v: any) => v.win_meta)
    .map((v: any) => {
      const meta = v.win_meta;
      const merchant = v.spend_merchants;
      const rankEmoji = RANK_EMOJI[meta.rank] ?? "🎖️";
      const rankPlace = RANK_PLACE[meta.rank] ?? `#${meta.rank}`;
      const gameLabel = GAME_LABELS[meta.game_type] ?? meta.game_type;

      const status: PrizeFeedEntry["status"] =
        v.status === "expired"
          ? "expired"
          : v.status === "redeemed" || v.status === "burned"
          ? "done"
          : v.win_seen_at == null
          ? "action_needed"
          : "active";

      const cta: PrizeFeedEntry["cta"] =
        status === "active" || status === "done"
          ? { label: status === "active" ? "View voucher" : "View", href: "/vouchers" }
          : null;

      return {
        id: v.id,
        kind: "leaderboard_voucher",
        title: `${meta.label} at ${merchant?.name ?? "merchant"}`,
        subtitle: `${rankEmoji} ${rankPlace} — ${gameLabel} · week ${meta.week}`,
        status,
        cta,
        created_at: v.created_at,
        expires_at: v.expires_at,
        voucherId: v.id,
        winMeta: meta,
        merchant: merchant ? { name: merchant.name, country: merchant.country ?? null } : null,
      };
    });

  const clawEntries: PrizeFeedEntry[] = (clawRes.vouchers ?? []).map((v) => {
    const status: PrizeFeedEntry["status"] =
      v.voucherStatus === "expired" ? "expired" : v.voucherStatus === "active" ? "active" : "done";

    const cta: PrizeFeedEntry["cta"] =
      status === "expired" ? null : { label: status === "active" ? "Use at merchant" : "View", href: "/claw" };

    return {
      id: `claw-${v.voucherId}`,
      kind: "claw_voucher",
      title: `${clawDiscountLabel(v.rewardClass, v.discountBps)} — Claw prize`,
      subtitle: `${CLAW_TIER_NAMES[v.tierId] ?? "—"} tier · Akiba Claw`,
      status,
      cta,
      created_at: v.createdAt ?? new Date(0).toISOString(),
      expires_at: new Date(v.expiresAt * 1000).toISOString(),
    };
  });

  const feed = [...leaderboardEntries, ...clawEntries]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10);

  return NextResponse.json({ feed });
}
