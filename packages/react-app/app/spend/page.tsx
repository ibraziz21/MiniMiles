"use client";

// spend-earn-redesign-spec.md §1 — /spend is now a merchant-deals + voucher
// surface with a Pass handoff and a Games entry point (previously rendered
// <GamesHub />, a duplicate of /games).

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import AppHeader from "@/components/app-header";
import MerchantVoucherSheet, {
  type VoucherTemplate,
  type MerchantForVoucher,
} from "@/components/merchant-voucher-sheet";
import { useWeb3 } from "@/contexts/useWeb3";
import { useWeeklyCampaign } from "@/hooks/games/useWeeklyCampaign";
import { akibaMilesSymbol } from "@/lib/svg";
import { Ticket, Tag, ArrowRight, QrCode, GameController, Spinner } from "@phosphor-icons/react";
import posthog from "posthog-js";

// ── Types ─────────────────────────────────────────────────────────────────────

type SpendMerchant = {
  id: string;
  name: string;
  slug: string;
  image_url?: string | null;
  country?: string | null;
};

type Deal = {
  id: string;
  title: string;
  miles_cost: number;
  voucher_type: "free" | "percent_off" | "fixed_off";
  discount_percent?: number | null;
  discount_cusd?: number | null;
  applicable_category?: string | null;
  linked_product_id?: string | null;
  retail_value_cusd?: number | null;
  merchant_id: string;
  spend_merchants: SpendMerchant | null;
};

type VoucherSummary = {
  status: string;
  acquisition_source?: string | null;
  expires_at?: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function discountLabel(d: Deal): string {
  if (d.voucher_type === "free") {
    if (d.linked_product_id) return "FREE — product included";
    const cap = d.retail_value_cusd ?? 15;
    return `FREE product (≤$${Number(cap).toFixed(0)})`;
  }
  if (d.voucher_type === "percent_off") return `${d.discount_percent ?? 0}% off`;
  if (d.voucher_type === "fixed_off") return `$${d.discount_cusd ?? 0} off`;
  return "Voucher";
}

function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SpendPage() {
  const web3 = useWeb3() as any;
  const { address, getUserAddress } = web3;
  const { campaign } = useWeeklyCampaign();

  const [vouchers, setVouchers] = useState<VoucherSummary[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMerchant, setSheetMerchant] = useState<MerchantForVoucher | null>(null);
  const [sheetTemplates, setSheetTemplates] = useState<VoucherTemplate[]>([]);

  useEffect(() => {
    getUserAddress?.();
  }, [getUserAddress]);

  useEffect(() => {
    posthog.capture("spend_page_view");
  }, []);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/Spend/vouchers/user/${address}`)
      .then((r) => r.json())
      .then((d) => setVouchers(d.vouchers ?? []))
      .catch(() => setVouchers([]));
  }, [address]);

  useEffect(() => {
    setDealsLoading(true);
    fetch("/api/Spend/deals")
      .then((r) => r.json())
      .then((d) => setDeals(d.deals ?? []))
      .catch(() => setDeals([]))
      .finally(() => setDealsLoading(false));
  }, []);

  const activeVouchers = useMemo(() => vouchers.filter((v) => v.status === "issued"), [vouchers]);

  // No "seen" flag exists on issued_vouchers yet — approximate the amber dot
  // with "expiring within 7 days" for won vouchers, per spec §1b.
  const expiringSoon = useMemo(
    () =>
      activeVouchers.some((v) => {
        if (v.acquisition_source !== "leaderboard_win") return false;
        const left = daysLeft(v.expires_at);
        return left !== null && left <= 7;
      }),
    [activeVouchers],
  );

  const openDeal = (deal: Deal) => {
    posthog.capture("deal_card_tap", { template_id: deal.id });
    if (!deal.spend_merchants) return;
    setSheetMerchant({
      id: deal.spend_merchants.id,
      slug: deal.spend_merchants.slug,
      name: deal.spend_merchants.name,
      image_url: deal.spend_merchants.image_url,
    });
    setSheetTemplates([
      {
        id: deal.id,
        title: deal.title,
        miles_cost: deal.miles_cost,
        voucher_type: deal.voucher_type,
        discount_percent: deal.discount_percent,
        discount_cusd: deal.discount_cusd,
        applicable_category: deal.applicable_category,
        linked_product_id: deal.linked_product_id,
        retail_value_cusd: deal.retail_value_cusd,
      },
    ]);
    setSheetOpen(true);
  };

  return (
    <main className="min-h-screen bg-[#F7FAFA] pb-28 font-sterling">
      <AppHeader />

      <div className="px-4 pt-5 pb-2">
        <h1 className="text-2xl font-bold text-[#0D2B30]">Spend</h1>
        <p className="mt-1 text-sm text-[#667579] font-poppins">
          Turn your Miles into real deals.
        </p>
      </div>

      {/* My vouchers strip */}
      <div className="px-4 mt-3">
        <Link
          href="/vouchers"
          onClick={() => posthog.capture("my_vouchers_tap")}
          className="flex items-center gap-3 rounded-xl border border-[#238D9D33] bg-white p-4 shadow-sm transition-transform active:scale-[0.99]"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#EAF7F8] text-[#238D9D]">
            <Ticket size={22} weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-[#0D2B30]">My vouchers</p>
              {expiringSoon && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />}
            </div>
            <p className="truncate text-xs text-[#667579] font-poppins">
              {activeVouchers.length > 0
                ? expiringSoon
                  ? "1 expiring soon"
                  : `${activeVouchers.length} active voucher${activeVouchers.length === 1 ? "" : "s"}`
                : "Win them in games or grab a deal below"}
            </p>
          </div>
          <ArrowRight size={16} weight="bold" className="shrink-0 text-[#667579]" />
        </Link>
      </div>

      {/* Merchant deals */}
      <div className="mt-6 px-4">
        <p className="mb-2 text-[11px] font-semibold uppercase text-[#6E7C80]">Merchant deals</p>

        {dealsLoading ? (
          <div className="flex justify-center py-10">
            <Spinner size={24} className="animate-spin text-[#238D9D]" />
          </div>
        ) : deals.length === 0 ? (
          <div className="rounded-xl border border-[#E5ECEE] bg-white p-5 text-center">
            <p className="text-sm text-[#667579]">New deals landing soon.</p>
            <Link
              href="/akiba-pass?src=spend_page"
              onClick={() => posthog.capture("pass_cta_tap", { src: "spend_page" })}
              className="mt-2 inline-block text-sm font-semibold text-[#238D9D]"
            >
              Get your Akiba Pass →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {deals.map((deal) => (
              <button
                key={deal.id}
                type="button"
                onClick={() => openDeal(deal)}
                className="flex flex-col rounded-xl border border-[#E5ECEE] bg-white p-3 text-left shadow-sm transition-transform active:scale-[0.99]"
              >
                <div className="mb-2 flex items-center gap-2">
                  {deal.spend_merchants?.image_url ? (
                    <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg">
                      <Image src={deal.spend_merchants.image_url} alt="" fill className="object-cover" />
                    </div>
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                      <Tag size={14} className="text-gray-300" />
                    </div>
                  )}
                  <p className="truncate text-xs text-[#667579]">{deal.spend_merchants?.name ?? "Merchant"}</p>
                </div>
                <p className="truncate text-sm font-semibold text-[#0D2B30]">{deal.title}</p>
                <p className="mt-0.5 text-sm font-bold text-[#238D9D]">{discountLabel(deal)}</p>
                {deal.applicable_category && !deal.linked_product_id && (
                  <p className="mt-0.5 truncate text-[11px] text-[#667579]">{deal.applicable_category}</p>
                )}
                <div className="mt-2 flex items-center gap-1">
                  <Image src={akibaMilesSymbol} alt="" width={13} height={13} />
                  <span className="text-xs font-bold text-[#0D2B30]">{deal.miles_cost.toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Akiba Pass CTA */}
      <div className="mt-6 px-4">
        <Link
          href="/akiba-pass?src=spend_page"
          onClick={() => posthog.capture("pass_cta_tap", { src: "spend_page" })}
          className="block overflow-hidden rounded-2xl bg-[#062329] p-4 shadow-lg transition-transform active:scale-[0.99]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#83E8F2]">
              <QrCode size={22} weight="fill" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">Use your Miles in real shops</p>
              <p className="mt-0.5 text-xs text-white/70 font-poppins">Get your Akiba Pass</p>
            </div>
            <ArrowRight size={16} weight="bold" className="shrink-0 text-white/70" />
          </div>
        </Link>
      </div>

      {/* Games nav card */}
      <div className="mt-4 px-4">
        <Link
          href="/games"
          onClick={() => posthog.capture("games_card_tap")}
          className="flex items-center gap-3 rounded-xl border border-[#E5ECEE] bg-white p-4 shadow-sm transition-transform active:scale-[0.99]"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#EAF7F8] text-[#238D9D]">
            <GameController size={22} weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[#0D2B30]">Play &amp; win merchant vouchers</p>
            <p className="truncate text-xs text-[#667579] font-poppins">
              {campaign?.merchant
                ? `This week: ${campaign.merchant.name}${campaign.tiers[0]?.label ? ` — ${campaign.tiers[0].label}` : ""}`
                : "Games with real-world prizes"}
            </p>
          </div>
          <ArrowRight size={16} weight="bold" className="shrink-0 text-[#667579]" />
        </Link>
      </div>

      <MerchantVoucherSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        merchant={sheetMerchant}
        templates={sheetTemplates}
        onIssued={(template) => posthog.capture("deal_purchase", { template_id: template.id })}
      />
    </main>
  );
}
