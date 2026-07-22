"use client";

// Win reveal sheet for weekly leaderboard voucher prizes.
// Shown once per prize (win_seen_at). The voucher is ALREADY the user's —
// this is a reveal, not a claim gate:
//   • Claim  → toast/route to wallet
//   • Burn   → BurnVoucherSheet (reason survey)
//   • Dismiss → soft claim; voucher stays in /vouchers until expiry
// Handles multiple prizes (user placed in 2+ games) in one sheet.
// Cloned from the claw's VoucherWinSheet pattern.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Confetti, Fire, MapPin, Ticket, X } from "@phosphor-icons/react";
import { BurnVoucherSheet, type BurnableVoucher } from "@/components/vouchers/BurnVoucherSheet";

type PrizeRow = {
  id: string;
  code: string;
  status: string;
  expires_at: string | null;
  win_meta: {
    game_type: string;
    week: string;
    rank: number;
    label: string;
    discount_percent: number;
    spend_cap_kes: number;
    marketplace_miles: number;
    burn_pct: number;
  } | null;
  spend_merchants: {
    slug: string;
    name: string;
    country: string | null;
    image_url: string | null;
  } | null;
};

const GAME_LABELS: Record<string, string> = {
  rule_tap: "Rule Tap",
  memory_flip: "Memory Flip",
};

const RANK_META: Record<number, { emoji: string; place: string; accent: string; bg: string }> = {
  1: { emoji: "🏆", place: "1st", accent: "#B7791F", bg: "#FFFBEB" },
  2: { emoji: "🥈", place: "2nd", accent: "#64748B", bg: "#F8FAFC" },
  3: { emoji: "🥉", place: "3rd", accent: "#C2662D", bg: "#FFF7ED" },
};

function burnMiles(p: PrizeRow): number {
  const mkt = p.win_meta?.marketplace_miles ?? 0;
  return Math.round(mkt * (p.win_meta?.burn_pct ?? 0.8));
}

export function LeaderboardWinSheet() {
  const router = useRouter();
  const [prizes, setPrizes] = useState<PrizeRow[]>([]);
  const [open, setOpen] = useState(false);
  const [burnTarget, setBurnTarget] = useState<BurnableVoucher | null>(null);
  const [burnOpen, setBurnOpen] = useState(false);

  // Fetch unseen prizes on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/games/my-prizes?unseen=1")
      .then((r) => (r.ok ? r.json() : { prizes: [] }))
      .then((data) => {
        if (!cancelled && Array.isArray(data.prizes) && data.prizes.length > 0) {
          setPrizes(data.prizes);
          setOpen(true);
        }
      })
      .catch(() => { /* silent — reveal is best-effort, wallet is source of truth */ });
    return () => { cancelled = true; };
  }, []);

  const markSeen = useCallback(() => {
    const ids = prizes.map((p) => p.id);
    if (ids.length === 0) return;
    fetch("/api/games/my-prizes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voucherIds: ids }),
    }).catch(() => { /* non-fatal */ });
  }, [prizes]);

  // Any way the sheet closes (claim, dismiss, swipe) = soft claim.
  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) markSeen();
  };

  const claim = () => {
    markSeen();
    setOpen(false);
    router.push("/vouchers");
  };

  const startBurn = (p: PrizeRow) => {
    if (!p.win_meta) return;
    setBurnTarget({
      id: p.id,
      merchantName: p.spend_merchants?.name ?? "the merchant",
      merchantCountry: p.spend_merchants?.country ?? null,
      label: p.win_meta.label,
      marketplaceMiles: p.win_meta.marketplace_miles,
      burnMiles: burnMiles(p),
    });
    setBurnOpen(true);
  };

  if (prizes.length === 0) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="bottom" className="rounded-t-3xl p-0 overflow-hidden bg-[#F0FDFF]">
          <button
            onClick={() => handleOpenChange(false)}
            className="absolute top-4 right-4 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-gray-100 bg-white/90 shadow-sm"
            aria-label="Close"
          >
            <X size={14} weight="bold" className="text-gray-500" />
          </button>

          <div className="px-5 pt-8 pb-10 flex flex-col items-center max-h-[85dvh] overflow-y-auto">
            <div className="mb-4 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#238D9D] ring-1 ring-[#238D9D33]">
              <Confetti size={12} weight="fill" className="inline -mt-0.5 mr-1" />
              Weekly leaderboard prize{prizes.length > 1 ? "s" : ""}
            </div>

            {prizes.map((p) => {
              const meta = p.win_meta;
              if (!meta) return null;
              const rank = RANK_META[meta.rank] ?? RANK_META[3];
              const merchant = p.spend_merchants;
              return (
                <div
                  key={p.id}
                  className="mb-4 w-full overflow-hidden rounded-3xl border bg-white shadow-lg"
                  style={{ borderColor: `${rank.accent}44` }}
                >
                  <div
                    className="flex items-center justify-between px-5 py-4"
                    style={{ background: rank.bg, borderBottom: `1px dashed ${rank.accent}33` }}
                  >
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: rank.accent }}>
                        {rank.emoji} {rank.place} — {GAME_LABELS[meta.game_type] ?? meta.game_type} this week
                      </p>
                      <p className="mt-0.5 text-3xl font-black" style={{ color: rank.accent }}>
                        {meta.label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        on purchases up to KES {meta.spend_cap_kes.toLocaleString()}
                      </p>
                    </div>
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl text-3xl" style={{ background: `${rank.accent}18` }}>
                      {rank.emoji}
                    </div>
                  </div>

                  <div className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-1.5 text-sm font-bold text-gray-700">
                      <MapPin size={14} weight="fill" className="text-[#238D9D]" />
                      {merchant?.name ?? "Merchant"}
                      {merchant?.country ? `, ${merchant.country}` : ""}
                    </div>
                    <p className="text-[11px] text-gray-400">Valid 30 days</p>
                  </div>

                  <div className="flex gap-2 px-5 pb-4">
                    <button
                      onClick={claim}
                      className="h-11 flex-1 rounded-xl bg-[#238D9D] text-sm font-bold text-white flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                    >
                      <Ticket size={15} weight="fill" /> Claim voucher
                    </button>
                    <button
                      onClick={() => startBurn(p)}
                      className="h-11 flex-1 rounded-xl border border-[#238D9D44] bg-white text-sm font-semibold text-[#238D9D] flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                    >
                      <Fire size={15} weight="bold" /> Burn for {burnMiles(p)} Miles
                    </button>
                  </div>
                </div>
              );
            })}

            <p className="mt-1 max-w-xs text-center text-xs leading-relaxed text-gray-400">
              Your voucher is already saved — find it anytime in My Vouchers.
              Unused vouchers auto-burn for 50% of their Miles value at expiry.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <BurnVoucherSheet
        open={burnOpen}
        onOpenChange={(v) => {
          setBurnOpen(v);
          if (!v) setBurnTarget(null);
        }}
        voucher={burnTarget}
        onBurned={() => {
          markSeen();
          setOpen(false);
        }}
      />
    </>
  );
}
