"use client";

// One-time, app-wide announcement of Akiba's merchant/voucher direction.
// Supersedes components/games/SponsoredPrizesAnnouncement.tsx (deleted) —
// that one only covered the leaderboard-prizes change; this covers the
// same ground plus the broader "Miles everywhere + burn for value" story,
// so only one of the two should ever exist. Same one-time pattern
// (localStorage flag, MiniPay is effectively single-device) mounted
// app-wide in components/Layout.tsx instead of one specific page, since
// this isn't games-specific.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Storefront, Coins, Fire } from "@phosphor-icons/react";

const STORAGE_KEY = "akiba_evolving_announcement_v1";
const PARTNER_INTEREST_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdgfXOQrVn4hRO67K1nF4h1gWBfkFW-iu3lf9QjDkQzupOmgA/viewform?usp=publish-editor";

export function AkibaEvolvingAnnouncement() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      return;
    }
    setOpen(true);
  }, []);

  const markSeen = () => {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* noop */
    }
  };

  const dismiss = (v: boolean) => {
    setOpen(v);
    if (!v) markSeen();
  };

  const handleSeeRewards = () => {
    markSeen();
    setOpen(false);
    router.push("/games/challenge");
  };

  const handlePartnerLink = () => {
    markSeen();
    window.open(PARTNER_INTEREST_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <Sheet open={open} onOpenChange={dismiss}>
      <SheetContent side="bottom" className="rounded-t-3xl bg-white p-0">
        <div className="flex flex-col items-center px-6 pt-8 pb-9">
          <h2 className="text-center text-xl font-extrabold text-gray-900">
            Akiba is evolving 🎉
          </h2>

          <div className="mt-5 w-full space-y-2.5">
            <div className="flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <Storefront size={18} weight="fill" className="mt-0.5 shrink-0 text-[#238D9D]" />
              <p className="text-[13px] leading-snug text-gray-600">
                <span className="font-semibold text-gray-800">Real rewards from real shops.</span>{" "}
                Win and unlock vouchers and discounts from merchants — starting with our
                first partners in Kenya, more countries on the way.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <Coins size={18} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
              <p className="text-[13px] leading-snug text-gray-600">
                <span className="font-semibold text-gray-800">Earn Miles everywhere.</span>{" "}
                Shop at partner merchants, complete challenges, redeem vouchers, play
                games — everything you do earns Miles.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <Fire size={18} weight="fill" className="mt-0.5 shrink-0 text-orange-500" />
              <p className="text-[13px] leading-snug text-gray-600">
                <span className="font-semibold text-gray-800">Your prizes always have value.</span>{" "}
                Won a voucher you can't use? Burn it for Miles and unlock something you
                actually want.
              </p>
            </div>
          </div>

          <button
            onClick={handleSeeRewards}
            className="mt-6 h-12 w-full rounded-2xl bg-[#238D9D] text-sm font-bold text-white active:scale-[0.98] transition-transform"
          >
            See this week's rewards →
          </button>

          <button
            onClick={handlePartnerLink}
            className="mt-3 text-xs font-medium text-gray-400 underline-offset-2 hover:underline"
          >
            Own a business? Partner with Akiba →
          </button>

          <button
            onClick={() => dismiss(false)}
            className="mt-4 h-11 w-full rounded-2xl text-sm font-semibold text-gray-500"
          >
            Got it
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
