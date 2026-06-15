import { ArrowUpRight } from "lucide-react";
import { PARTNER_WITH_AKIBA_URL } from "@/constants/links";

export function PartnerStrip() {
  return (
    <div className="border-t border-akiba-line bg-akiba-ink px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="font-sterling text-lg font-semibold text-white">
            Launch a campaign with Akiba
          </p>
          <p className="mt-1 text-sm text-white/50">
            Reach users through quests, vouchers, games, raffles, and reward recommendations.
          </p>
        </div>
        <a
          href={PARTNER_WITH_AKIBA_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 px-4 py-2.5 text-sm font-semibold text-white no-underline transition hover:border-white hover:bg-white/10"
        >
          Partner With Akiba
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}
