"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useWeb3 } from "@/contexts/useWeb3";
import { akibaMilesSymbol } from "@/lib/svg";
import { Spinner, Tag, ShoppingBag, ArrowLeft, Ticket, Fire } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import dynamic from "next/dynamic";
import type { IssuedVoucher, SpendMerchant } from "@/components/voucher-order-sheet";
import { RewardClass } from "@/lib/clawTypes";

const VoucherOrderSheet = dynamic(() => import("@/components/voucher-order-sheet"), { ssr: false });

import { BurnVoucherSheet, type BurnableVoucher } from "@/components/vouchers/BurnVoucherSheet";

// ── Types ─────────────────────────────────────────────────────────────────────

type WinMeta = {
  game_type: string;
  week: string;
  rank: number;
  label: string;
  discount_percent: number;
  spend_cap_kes: number;
  marketplace_miles: number;
  burn_pct: number;
};

type VoucherWithMeta = IssuedVoucher & {
  created_at: string;
  acquisition_source?: string | null;
  win_meta?: WinMeta | null;
  expires_at?: string | null;
  spend_voucher_templates: {
    id: string;
    title: string;
    voucher_type: string;
    spend_merchants: SpendMerchant;
  } | null;
};

const WIN_GAME_LABELS: Record<string, string> = {
  rule_tap: "Rule Tap",
  memory_flip: "Memory Flip",
};

const WIN_RANK_LABELS: Record<number, string> = { 1: "🏆 1st", 2: "🥈 2nd", 3: "🥉 3rd" };

function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  issued: "bg-[#24E5E033] text-[#1E8C89]",
  redeemed: "bg-gray-100 text-gray-500",
  expired: "bg-red-50 text-red-400",
  void: "bg-gray-100 text-gray-400",
  burned: "bg-orange-50 text-orange-400",
};

const STATUS_LABEL: Record<string, string> = {
  issued: "Active",
  redeemed: "Used",
  expired: "Expired",
  void: "Void",
  burned: "Burned for Miles",
};

function discountLabel(rules: IssuedVoucher["rules_snapshot"] | null | undefined): string {
  if (!rules) return "Voucher";
  if (rules.voucher_type === "free") {
    if (rules.linked_product_id) return "FREE — product included";
    const cap = rules.retail_value_cusd ?? 15;
    return `FREE product (≤$${Number(cap).toFixed(0)})`;
  }
  if (rules.voucher_type === "percent_off") return `${rules.discount_percent ?? 0}% off`;
  if (rules.voucher_type === "fixed_off") return `$${rules.discount_cusd ?? 0} off`;
  return "Voucher";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Voucher card ──────────────────────────────────────────────────────────────

function VoucherCard({
  voucher,
  onOrder,
  onBurn,
}: {
  voucher: VoucherWithMeta;
  onOrder: (v: IssuedVoucher, m: SpendMerchant) => void;
  onBurn?: (v: VoucherWithMeta) => void;
}) {
  const merchant = voucher.spend_voucher_templates?.spend_merchants ?? null;
  const templateName = voucher.spend_voucher_templates?.title ?? "Voucher";
  const isActive = voucher.status === "issued";
  const win = voucher.acquisition_source === "leaderboard_win" ? voucher.win_meta ?? null : null;
  const expiry = isActive && win ? daysLeft(voucher.expires_at) : null;
  const burnValue = win ? Math.round(win.marketplace_miles * (win.burn_pct ?? 0.8)) : 0;

  return (
    <div
      className={`border rounded-2xl p-4 bg-white transition-all ${
        isActive ? "border-[#238D9D33]" : "border-gray-100 opacity-70"
      }`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`text-xs rounded-full px-2.5 py-0.5 font-medium ${
              STATUS_STYLE[voucher.status] ?? "bg-gray-100 text-gray-400"
            }`}
          >
            {STATUS_LABEL[voucher.status] ?? voucher.status}
          </span>
          {win && (
            <span className="text-xs rounded-full px-2 py-0.5 font-semibold bg-amber-50 text-amber-600 truncate">
              Won · {WIN_RANK_LABELS[win.rank] ?? `#${win.rank}`} · {WIN_GAME_LABELS[win.game_type] ?? win.game_type}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400 shrink-0">{formatDate(voucher.created_at)}</span>
      </div>

      {/* Expiry countdown for won vouchers */}
      {expiry !== null && (
        <p className="mb-2 text-[11px] font-medium text-orange-500">
          {expiry > 0
            ? `${expiry} day${expiry === 1 ? "" : "s"} left — auto-burns for ${Math.round((voucher.win_meta?.marketplace_miles ?? 0) * 0.5)} Miles if unused`
            : "Expiring — will auto-burn for Miles"}
        </p>
      )}

      {/* Merchant + template */}
      <div className="flex items-center gap-2 mb-2">
        {merchant?.image_url ? (
          <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0">
            <Image src={merchant.image_url} alt="" fill className="object-cover" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center">
            <Tag size={14} className="text-gray-300" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs text-gray-400 truncate">{merchant?.name ?? "—"}</p>
          <p className="font-semibold text-sm truncate">{templateName}</p>
        </div>
      </div>

      {/* Discount highlight */}
      <p className="text-[#238D9D] font-bold text-base mb-1">{discountLabel(voucher.rules_snapshot)}</p>

      {/* Scope: product chip, category, or all */}
      {voucher.linked_product_id ? (
        <div className="flex items-center gap-2 mb-3">
          {voucher.product_image_url && (
            <div className="relative w-7 h-7 rounded-lg overflow-hidden shrink-0">
              <Image src={voucher.product_image_url} alt="" fill className="object-cover" />
            </div>
          )}
          <p className="text-xs font-medium text-[#238D9D]">
            📦 {voucher.product_name ?? "Specific product"}
          </p>
        </div>
      ) : voucher.rules_snapshot?.applicable_category ? (
        <p className="text-xs text-gray-400 mb-3">
          Applies to{" "}
          <span className="font-medium text-gray-600">
            {voucher.rules_snapshot.applicable_category}
          </span>{" "}
          products only
        </p>
      ) : null}

      {/* Code */}
      <div className="bg-gray-50 rounded-xl px-3 py-2 mb-3 flex items-center justify-between">
        <span className="font-mono text-sm tracking-widest text-gray-700 font-bold">
          {voucher.code}
        </span>
        <button
          onClick={() => navigator.clipboard.writeText(voucher.code)}
          className="text-xs text-[#238D9D] font-medium"
        >
          Copy
        </button>
      </div>

      {/* Actions */}
      {isActive && merchant && (
        <div className="space-y-2">
          <button
            onClick={() => onOrder(voucher, merchant)}
            className="w-full bg-[#238D9D] text-white rounded-xl h-10 text-sm font-medium flex items-center justify-center gap-1.5"
          >
            <ShoppingBag size={15} />
            {voucher.linked_product_id ? "Use voucher" : "Order goods"}
          </button>
          {win && onBurn && (
            <button
              onClick={() => onBurn(voucher)}
              className="w-full rounded-xl h-10 text-sm font-medium border border-[#238D9D44] text-[#238D9D] flex items-center justify-center gap-1.5"
            >
              <Fire size={15} weight="bold" />
              Burn for {burnValue} Miles
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Claw voucher types ─────────────────────────────────────────────────────

type ClawVoucherRaw = {
  voucherId: string;
  sessionId: string;
  owner: string;
  tierId: number;
  rewardClass: number;
  discountBps: number;
  maxValue: string;
  expiresAt: number;
  redeemed: boolean;
  burned: boolean;
  merchantId: string;
  voucherStatus: "active" | "redeemed" | "expired" | "burned";
};

const CLAW_TIER_NAMES: Record<number, string> = { 0: "Basic", 1: "Boosted", 2: "Premium" };
const CLAW_STATUS_STYLE: Record<string, string> = {
  active:   "bg-[#06B6D433] text-[#0891B2]",
  redeemed: "bg-gray-100 text-gray-500",
  expired:  "bg-red-50 text-red-400",
  burned:   "bg-gray-100 text-gray-400",
};
const CLAW_STATUS_LABEL: Record<string, string> = {
  active:   "Active",
  redeemed: "Used",
  expired:  "Expired",
  burned:   "Burned",
};

function clawDiscountLabel(v: ClawVoucherRaw): string {
  if (v.rewardClass === RewardClass.Legendary) return "100% off (capped)";
  if (v.rewardClass === RewardClass.Rare)      return "20% off";
  return `${(v.discountBps / 100).toFixed(0)}% off`;
}

function ClawVoucherCard({
  voucher,
  onBurn,
  burning,
}: {
  voucher: ClawVoucherRaw;
  onBurn: (sessionId: string) => void;
  burning: boolean;
}) {
  const [confirmBurn, setConfirmBurn] = useState(false);
  const isActive = voucher.voucherStatus === "active";
  const expiresDate = new Date(voucher.expiresAt * 1000).toLocaleDateString("en-KE", {
    day: "numeric", month: "short", year: "numeric",
  });
  const burnLabel = voucher.rewardClass === RewardClass.Legendary
    ? "Burn for USDT fallback"
    : "Burn for AkibaMiles";

  return (
    <div
      className={`border rounded-2xl p-4 bg-white transition-all ${
        isActive ? "border-[#06B6D433]" : "border-gray-100 opacity-70"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className={`text-xs rounded-full px-2.5 py-0.5 font-medium ${
            CLAW_STATUS_STYLE[voucher.voucherStatus] ?? "bg-gray-100 text-gray-400"
          }`}
        >
          {CLAW_STATUS_LABEL[voucher.voucherStatus] ?? voucher.voucherStatus}
        </span>
        <span className="text-xs text-gray-400">Expires {expiresDate}</span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg bg-[#06B6D411] shrink-0 flex items-center justify-center">
          {voucher.rewardClass === RewardClass.Legendary ? (
            <span className="text-base">⭐</span>
          ) : (
            <span className="text-[#0891B2]"><Ticket size={16} /></span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-400 truncate">
            Akiba Claw · {CLAW_TIER_NAMES[voucher.tierId] ?? "—"} tier
          </p>
          <p className="font-semibold text-sm">
            {voucher.rewardClass === RewardClass.Legendary ? "Legendary Voucher" : "Rare Voucher"}
          </p>
        </div>
      </div>

      <p className="text-[#0891B2] font-bold text-base mb-1">{clawDiscountLabel(voucher)}</p>
      <p className="text-xs text-gray-400 mb-3">Valid at any participating merchant</p>

      <div className="bg-gray-50 rounded-xl px-3 py-2 mb-3 flex items-center justify-between">
        <span className="font-mono text-xs tracking-widest text-gray-700 font-bold truncate">
          #{voucher.voucherId}
        </span>
        <button
          onClick={() => navigator.clipboard.writeText(voucher.voucherId)}
          className="text-xs text-[#0891B2] font-medium shrink-0 ml-2"
        >
          Copy ID
        </button>
      </div>

      {isActive && (
        <div className="flex gap-2">
          <Link
            href="/spend"
            className="flex-1 border border-[#06B6D4] text-[#0891B2] rounded-xl h-10 text-sm font-medium flex items-center justify-center gap-1.5"
          >
            <ShoppingBag size={15} weight="bold" />
            Use at merchant
          </Link>

          {confirmBurn ? (
            <div className="flex gap-1.5">
              <button
                onClick={() => setConfirmBurn(false)}
                className="h-10 px-3 rounded-xl border border-gray-200 text-xs text-gray-500 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => { onBurn(voucher.sessionId); setConfirmBurn(false); }}
                disabled={burning}
                className="h-10 px-3 rounded-xl bg-red-500 text-white text-xs font-medium flex items-center gap-1 disabled:opacity-60"
              >
                {burning ? <span className="animate-spin inline-flex"><Spinner size={12} /></span> : <Fire size={13} weight="bold" />}
                Confirm
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmBurn(true)}
              className="h-10 px-3 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium flex items-center gap-1.5"
            >
              <Fire size={15} weight="bold" />
              {burnLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VouchersPage() {
  const { address, getUserAddress, burnClawVoucherReward } = useWeb3();

  const [vouchers, setVouchers] = useState<VoucherWithMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [clawVouchers, setClawVouchers] = useState<ClawVoucherRaw[]>([]);
  const [clawLoading, setClawLoading] = useState(false);
  const [burningId, setBurningId] = useState<string | null>(null);

  // Order sheet state
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderMerchant, setOrderMerchant] = useState<SpendMerchant | null>(null);
  const [orderVoucher, setOrderVoucher] = useState<IssuedVoucher | null>(null);

  const [burnOpen, setBurnOpen] = useState(false);
  const [burnVoucher, setBurnVoucher] = useState<BurnableVoucher | null>(null);

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setFetchError(null);
    fetch(`/api/Spend/vouchers/user/${address}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Failed to load vouchers");
        setVouchers(d.vouchers ?? []);
      })
      .catch((err) => {
        setFetchError(err?.message ?? "Could not load vouchers");
        setVouchers([]);
      })
      .finally(() => setLoading(false));
  }, [address]);

  // Load claw vouchers
  useEffect(() => {
    if (!address) return;
    setClawLoading(true);
    fetch(`/api/claw/vouchers/user/${address}`)
      .then(async (r) => {
        if (!r.ok) return;
        const d = await r.json();
        setClawVouchers(d.vouchers ?? []);
      })
      .catch(() => {})
      .finally(() => setClawLoading(false));
  }, [address]);

  const handleOrder = (voucher: IssuedVoucher, merchant: SpendMerchant) => {
    setOrderVoucher(voucher);
    setOrderMerchant(merchant);
    setOrderOpen(true);
  };

  // Burn a WON voucher for Miles (spec §5) — opens the reason-survey sheet.
  const handleWonBurn = (v: VoucherWithMeta) => {
    const win = v.win_meta;
    if (!win) return;
    setBurnVoucher({
      id: v.id,
      merchantName: v.spend_voucher_templates?.spend_merchants?.name ?? "the merchant",
      merchantCountry: null,
      label: win.label,
      marketplaceMiles: win.marketplace_miles,
      burnMiles: Math.round(win.marketplace_miles * (win.burn_pct ?? 0.8)),
    });
    setBurnOpen(true);
  };

  const refreshSpendVouchers = async () => {
    if (!address) return;
    try {
      const r = await fetch(`/api/Spend/vouchers/user/${address}`);
      if (r.ok) {
        const d = await r.json();
        setVouchers(d.vouchers ?? []);
      }
    } catch { /* non-fatal */ }
  };

  const handleClawBurn = async (sessionId: string) => {
    if (!address) return;
    setBurningId(sessionId);
    try {
      await burnClawVoucherReward(BigInt(sessionId));
      // Refresh claw vouchers after burn
      const r = await fetch(`/api/claw/vouchers/user/${address}`);
      if (r.ok) {
        const d = await r.json();
        setClawVouchers(d.vouchers ?? []);
      }
    } catch (e) {
      console.error("[VouchersPage] burn error", e);
    } finally {
      setBurningId(null);
    }
  };

  // Split by status
  const activeVouchers = vouchers.filter((v) => v.status === "issued");
  const pastVouchers = vouchers.filter((v) => v.status !== "issued");

  return (
    <main className="pb-24 font-sterling bg-onboarding min-h-screen">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-3">
        <Link href="/spend" className="text-gray-500">
          <ArrowLeft size={22} />
        </Link>
        <h1 className="text-2xl font-semibold">My Vouchers</h1>
      </div>

      <Tabs defaultValue="spend" className="px-4 mt-2">
        <TabsList className="w-full mb-4 rounded-xl bg-gray-100 p-1">
          <TabsTrigger
            value="spend"
            className="flex-1 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm text-sm"
          >
            Spend Vouchers
          </TabsTrigger>
          <TabsTrigger
            value="claw"
            className="flex-1 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm text-sm"
          >
            Claw Prizes
          </TabsTrigger>
        </TabsList>

        {/* ── SPEND VOUCHERS ─────────────────────────────────────── */}
        <TabsContent value="spend">
          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner size={32} className="animate-spin text-[#238D9D]" />
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <p className="text-sm text-red-400 mb-4">{fetchError}</p>
              <button
                onClick={() => {
                  if (!address) return;
                  setLoading(true);
                  setFetchError(null);
                  fetch(`/api/Spend/vouchers/user/${address}`)
                    .then(async (r) => {
                      const d = await r.json();
                      if (!r.ok) throw new Error(d.error ?? "Failed to load vouchers");
                      setVouchers(d.vouchers ?? []);
                    })
                    .catch((err) => setFetchError(err?.message ?? "Could not load vouchers"))
                    .finally(() => setLoading(false));
                }}
                className="text-sm text-[#238D9D] underline"
              >
                Try again
              </button>
            </div>
          ) : !address ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-16 h-16 rounded-full bg-[#238D9D0D] flex items-center justify-center mb-4">
                <Tag size={28} className="text-[#238D9D]" />
              </div>
              <h3 className="font-semibold text-base mb-1">Connect your wallet</h3>
              <p className="text-sm text-gray-400">Open AkibaMiles in MiniPay to see your vouchers.</p>
            </div>
          ) : vouchers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-16 h-16 rounded-full bg-[#238D9D0D] flex items-center justify-center mb-4">
                <Tag size={28} className="text-[#238D9D]" />
              </div>
              <h3 className="font-semibold text-base mb-1">No vouchers yet</h3>
              <p className="text-sm text-gray-400 mb-5">
                Visit a merchant on the Spend page to buy your first voucher.
              </p>
              <Link href="/spend">
                <Button title="Browse merchants" className="bg-[#238D9D] text-white rounded-xl px-6 h-11 font-medium" />
              </Link>
            </div>
          ) : (
            <>
              {activeVouchers.length > 0 && (
                <section className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                    Active
                  </h3>
                  <div className="space-y-3">
                    {activeVouchers.map((v) => (
                      <VoucherCard key={v.id} voucher={v} onOrder={handleOrder} onBurn={handleWonBurn} />
                    ))}
                  </div>
                </section>
              )}

              {pastVouchers.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                    Past
                  </h3>
                  <div className="space-y-3">
                    {pastVouchers.map((v) => (
                      <VoucherCard key={v.id} voucher={v} onOrder={handleOrder} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </TabsContent>

        {/* ── CLAW PRIZES ────────────────────────────────────────── */}
        <TabsContent value="claw">
          {clawLoading ? (
            <div className="flex justify-center py-16">
              <span className="animate-spin inline-flex text-[#06B6D4]"><Spinner size={32} /></span>
            </div>
          ) : !address ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-16 h-16 rounded-full bg-[#06B6D40D] flex items-center justify-center mb-4">
                <span className="text-[#06B6D4]"><Ticket size={28} /></span>
              </div>
              <h3 className="font-semibold text-base mb-1">Connect your wallet</h3>
              <p className="text-sm text-gray-400">Open AkibaMiles in MiniPay to see your claw prizes.</p>
            </div>
          ) : clawVouchers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-16 h-16 rounded-full bg-[#06B6D40D] flex items-center justify-center mb-4">
                <Image src={akibaMilesSymbol} alt="" width={32} height={32} />
              </div>
              <h3 className="font-semibold text-base mb-1">No claw prizes yet</h3>
              <p className="text-sm text-gray-400 mb-5">
                Win a Rare or Legendary item in the Claw game to earn a prize voucher.
              </p>
              <Link href="/claw">
                <Button title="Play Akiba Claw" className="bg-[#06B6D4] text-white rounded-xl px-6 h-11 font-medium" />
              </Link>
            </div>
          ) : (
            <>
              {clawVouchers.filter((v) => v.voucherStatus === "active").length > 0 && (
                <section className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Active</h3>
                  <div className="space-y-3">
                    {clawVouchers
                      .filter((v) => v.voucherStatus === "active")
                      .map((v) => (
                        <ClawVoucherCard
                          key={v.voucherId}
                          voucher={v}
                          onBurn={handleClawBurn}
                          burning={burningId === v.sessionId}
                        />
                      ))}
                  </div>
                </section>
              )}
              {clawVouchers.filter((v) => v.voucherStatus !== "active").length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Past</h3>
                  <div className="space-y-3">
                    {clawVouchers
                      .filter((v) => v.voucherStatus !== "active")
                      .map((v) => (
                        <ClawVoucherCard
                          key={v.voucherId}
                          voucher={v}
                          onBurn={handleClawBurn}
                          burning={burningId === v.sessionId}
                        />
                      ))}
                  </div>
                </section>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Order sheet — triggered from a voucher card */}
      <VoucherOrderSheet
        open={orderOpen}
        onOpenChange={setOrderOpen}
        merchant={orderMerchant}
        preloadVoucher={orderVoucher}
      />

      <BurnVoucherSheet
        open={burnOpen}
        onOpenChange={(v) => {
          setBurnOpen(v);
          if (!v) setBurnVoucher(null);
        }}
        voucher={burnVoucher}
        onBurned={() => { refreshSpendVouchers(); }}
      />
    </main>
  );
}
