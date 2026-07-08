import Link from "next/link";
import { ArrowLeft, LockKey } from "@phosphor-icons/react/dist/ssr";
import { CrackPotGamePage } from "@/components/crackpot/CrackPotGamePage";
import { isCrackPotLive } from "@/lib/server/crackpotComingSoon";

export default function CrackPotPage() {
  if (isCrackPotLive()) {
    return <CrackPotGamePage />;
  }

  // Feature-flag fallback for emergency disablement.
  return (
    <main className="min-h-screen bg-[#F7FAFA] pb-28 font-sterling">
      <div className="px-4 pt-8 pb-2 flex items-center gap-3">
        <Link
          href="/games"
          aria-label="Back to games"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-gray-200 shadow-sm"
        >
          <ArrowLeft size={16} className="text-[#238D9D]" />
        </Link>
        <h1 className="text-xl font-bold text-[#1A1A1A]">CrackPot</h1>
      </div>

      <section className="px-4 pt-10">
        <div className="rounded-lg border border-[#E3ECEE] bg-white px-5 py-6 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-[#238D9D]/15 bg-[#EAF7F8] text-[#238D9D]">
            <LockKey size={28} weight="duotone" />
          </div>

          <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-[#6E7C80]">
            Temporarily offline
          </p>
          <h2 className="mt-1 text-2xl font-bold text-[#0D2B30]">
            CrackPot is paused
          </h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#667579] font-poppins">
            CrackPot is temporarily unavailable. Farkle Reward Duel and the
            other games remain available.
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link
              href="/games/farkle?mode=reward"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[#238D9D] px-4 text-sm font-bold text-white"
            >
              Play Farkle Reward Duel
            </Link>
            <Link
              href="/games"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-[#DDE7EA] bg-white px-4 text-sm font-bold text-[#238D9D]"
            >
              Back to games
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
