"use client";

// One-time announcement: weekly USDT prizes → merchant voucher prizes.
// Shows on the games hub when a sponsored campaign is active and the user
// hasn't seen it. Persisted in localStorage for the pilot (MiniPay is
// effectively single-device; move to a profile flag if that changes —
// see docs/skill-games-voucher-prizes-spec.md §1).

import { useEffect, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Gift, Fire, Trophy } from "@phosphor-icons/react";
import type { WeeklyCampaign } from "@/hooks/games/useWeeklyCampaign";

const STORAGE_KEY = "akiba_sponsored_prizes_announcement_v1";

export function SponsoredPrizesAnnouncement({
  campaign,
  onSeePrizes,
}: {
  campaign: WeeklyCampaign | null;
  onSeePrizes?: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!campaign?.merchant) return;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch { return; }
    setOpen(true);
  }, [campaign]);

  const dismiss = (v: boolean) => {
    setOpen(v);
    if (!v) {
      try { localStorage.setItem(STORAGE_KEY, new Date().toISOString()); } catch { /* noop */ }
    }
  };

  if (!campaign?.merchant) return null;
  const m = campaign.merchant;

  return (
    <Sheet open={open} onOpenChange={dismiss}>
      <SheetContent side="bottom" className="rounded-t-3xl bg-white p-0">
        <div className="flex flex-col items-center px-6 pt-8 pb-9">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F0FDFF]">
            <Gift size={28} weight="fill" className="text-[#238D9D]" />
          </div>
          <h2 className="mt-4 text-center text-xl font-extrabold text-gray-900">
            Leaderboard prizes are changing
          </h2>
          <p className="mt-3 max-w-sm text-center text-sm leading-relaxed text-gray-500">
            Weekly USDT prizes are being replaced by merchant reward vouchers,
            starting with <span className="font-semibold text-gray-700">{m.name}</span>
            {m.country ? ` (${m.country})` : ""}.
          </p>

          <div className="mt-5 w-full space-y-2.5">
            <div className="flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <Trophy size={18} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
              <p className="text-[13px] leading-snug text-gray-600">
                Win a top-3 spot on a weekly leaderboard → get a discount voucher.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <Fire size={18} weight="fill" className="mt-0.5 shrink-0 text-orange-500" />
              <p className="text-[13px] leading-snug text-gray-600">
                Can't use it? Burn it for Miles instead — your prize always has value.
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              dismiss(false);
              onSeePrizes?.();
            }}
            className="mt-6 h-12 w-full rounded-2xl bg-[#238D9D] text-sm font-bold text-white active:scale-[0.98] transition-transform"
          >
            See this week's prizes
          </button>
          <button
            onClick={() => dismiss(false)}
            className="mt-2 h-11 w-full rounded-2xl text-sm font-semibold text-gray-500"
          >
            Got it
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
