"use client";

// One-time notice that daily challenges (Miles for MiniPay wallet activity)
// are going away — the rails are already hidden behind
// DAILY_CHALLENGES_ENABLED in lib/featureFlags.ts, so this explains where
// earning moved: games in the mini-app, and the Akiba Pass at partner shops.
//
// Same one-time pattern as AkibaEvolvingAnnouncement (localStorage flag —
// MiniPay is effectively single-device), mounted app-wide in
// components/Layout.tsx. It deliberately waits for the evolving announcement
// to have been seen so the two sheets never open on top of each other; users
// who were earning from daily challenges already cleared that one, and a
// brand-new user has no daily-challenge habit to deprecate.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Prohibit, GameController, QrCode } from "@phosphor-icons/react";

const STORAGE_KEY = "akiba_daily_challenges_deprecated_v1";
const EVOLVING_STORAGE_KEY = "akiba_evolving_announcement_v1";

export function DailyChallengesDeprecatedAnnouncement() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
      // Let the broader product-direction sheet go first.
      if (!localStorage.getItem(EVOLVING_STORAGE_KEY)) return;
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

  const go = (route: string) => {
    markSeen();
    setOpen(false);
    router.push(route);
  };

  return (
    <Sheet open={open} onOpenChange={dismiss}>
      <SheetContent side="bottom" className="rounded-t-3xl bg-white p-0">
        <div className="flex flex-col items-center px-6 pt-8 pb-9">
          <h2 className="text-center text-xl font-extrabold text-gray-900">
            Daily challenges are going away
          </h2>
          <p className="mt-2 text-center text-[13px] leading-snug text-gray-500 font-poppins">
            Earning Miles for MiniPay wallet activity — sends, receives, daily
            transactions — is being retired. Here&apos;s where earning lives now.
          </p>

          <div className="mt-5 w-full space-y-2.5">
            <div className="flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <Prohibit size={18} weight="fill" className="mt-0.5 shrink-0 text-gray-400" />
              <p className="text-[13px] leading-snug text-gray-600">
                <span className="font-semibold text-gray-800">No more daily check-ins.</span>{" "}
                The daily challenge list is gone from Home and Earn. Miles you already
                claimed stay in your balance — nothing is taken away.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <GameController size={18} weight="fill" className="mt-0.5 shrink-0 text-[#238D9D]" />
              <p className="text-[13px] leading-snug text-gray-600">
                <span className="font-semibold text-gray-800">Play games instead.</span>{" "}
                Farkle is a live 1v1 dice duel for the pot, and the weekly Skill Games
                put the top 3 in line for prizes.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <QrCode size={18} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
              <p className="text-[13px] leading-snug text-gray-600">
                <span className="font-semibold text-gray-800">Earn at real shops.</span>{" "}
                The Akiba Pass is your QR code at partner tills — one scan and you&apos;re
                earning Miles on what you already buy.
              </p>
            </div>
          </div>

          <button
            onClick={() => go("/games")}
            className="mt-6 h-12 w-full rounded-2xl bg-[#238D9D] text-sm font-bold text-white active:scale-[0.98] transition-transform"
          >
            Play games →
          </button>

          <button
            onClick={() => go("/akiba-pass?src=daily_challenge_deprecation")}
            className="mt-3 text-xs font-medium text-gray-400 underline-offset-2 hover:underline"
          >
            Get the Akiba Pass instead →
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
