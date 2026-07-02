import Link from "next/link";

export function CrackPotHomeWidget() {
  return (
    <section className="mx-4 mt-4 rounded-2xl border border-[#E3ECEE] bg-white px-4 py-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7C80]">
            CrackPot · Coming soon
          </p>
          <p className="mt-0.5 text-sm font-bold text-[#0D2B30]">
            Jackpot code game under stabilization.
          </p>
        </div>
        <Link
          href="/games"
          className="shrink-0 rounded-lg border border-[#DDE7EA] bg-[#F8FBFB] px-3 py-2 text-xs font-bold text-[#238D9D]"
        >
          View games
        </Link>
      </div>
    </section>
  );
}
