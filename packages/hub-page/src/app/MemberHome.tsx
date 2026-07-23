import Link from "next/link";
import { ArrowRight, Tag } from "lucide-react";
import { CompactPassCard } from "@/components/akiba/CompactPassCard";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { HomeViewTracker } from "@/components/akiba/HomeViewTracker";
import { getUserBalance } from "@/lib/akiba/balance";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getOrCreatePass } from "@/lib/akiba/pass";
import { getActiveDeals, sortByAffordability, cheapestAffordable, cheapestOverall, dealLabel } from "@/lib/akiba/deals";
import { getActiveVoucherSummary, getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";
import { MilesIcon } from "@/components/MilesIcon";
import type { User } from "@supabase/supabase-js";

// The tool for members — home-redesign-spec.md §2. Pass card first, then a
// denominated balance (purchasing power, not a bare number), then "use it
// today" deals, then a conditional vouchers strip. Nothing else — Shop/
// Rewards/Quests discovery lives in the nav, not re-advertised here.
export async function MemberHome({ user }: { user: User }) {
  const email = user.email ?? null;

  const [{ walletAddress, displayName }, deals] = await Promise.all([
    resolveHubProfile({ userId: user.id, email }),
    getActiveDeals(),
  ]);

  const [{ balance }, { publicPassId }, walletAddresses] = await Promise.all([
    getUserBalance({ walletAddress, email }),
    getOrCreatePass({ userId: user.id, email, walletAddress }),
    getLinkedWalletAddresses(user.id),
  ]);

  const voucherSummary = await getActiveVoucherSummary({ userId: user.id, walletAddresses });

  const rail = sortByAffordability(deals, balance).slice(0, 6);
  const affordable = cheapestAffordable(deals, balance);
  const overall = cheapestOverall(deals);

  return (
    <main className="mx-auto max-w-2xl px-4 py-5 sm:py-8">
      <HomeViewTracker variant="member" />

      {/* 2a — Pass card, always first */}
      {publicPassId && (
        <div className="mb-4">
          <CompactPassCard passId={publicPassId} displayLabel={displayName} />
        </div>
      )}

      {/* 2b — Denominated balance */}
      <TrackedLink
        href="/shop"
        event="balance_tap"
        eventProps={{ affordable: !!affordable }}
        className="mb-4 block rounded-2xl border border-akiba-line bg-white px-5 py-4 transition active:scale-[0.99]"
      >
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-akiba-muted">
          <MilesIcon className="h-3.5 w-3.5" /> Your Miles
        </p>
        <p className="mt-1.5 font-sterling text-2xl font-semibold text-akiba-ink">
          {balance.toLocaleString("en-KE")} Miles
          {affordable ? (
            <span className="ml-1.5 font-sans text-base font-normal text-akiba-muted">
              — enough for {affordable.title}
            </span>
          ) : overall ? (
            <span className="ml-1.5 font-sans text-base font-normal text-akiba-muted">
              — {Math.max(0, overall.miles_cost - balance).toLocaleString("en-KE")} more to unlock {overall.title}
            </span>
          ) : null}
        </p>
      </TrackedLink>

      {/* 2c — "Use it today" deals rail */}
      {rail.length > 0 && (
        <section className="mb-4">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-akiba-muted">
              Use it today
            </h2>
            <Link href="/shop" className="flex items-center gap-1 text-xs font-semibold text-akiba-teal">
              See all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {rail.map((deal) => (
              <TrackedLink
                key={deal.id}
                href={deal.partners ? `/shop/${deal.partners.slug}` : "/shop"}
                event="deals_rail_tap"
                eventProps={{ template_id: deal.id }}
                className="flex w-40 shrink-0 flex-col rounded-2xl border border-akiba-line bg-white p-3.5 transition active:scale-[0.98]"
              >
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-akiba-card">
                  {deal.partners?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={deal.partners.image_url} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <Tag className="h-4 w-4 text-akiba-muted" />
                  )}
                </div>
                <p className="mt-2 truncate text-xs text-akiba-muted">{deal.partners?.name ?? "Merchant"}</p>
                <p className="truncate text-sm font-semibold text-akiba-ink">{dealLabel(deal)}</p>
                <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-akiba-teal">
                  <MilesIcon className="h-3 w-3" /> {deal.miles_cost.toLocaleString("en-KE")} · Unlock with Miles
                </p>
              </TrackedLink>
            ))}
          </div>
        </section>
      )}

      {/* 2d — Vouchers strip, conditional */}
      {voucherSummary.activeCount > 0 && (
        <TrackedLink
          href="/vouchers"
          event="vouchers_strip_tap"
          className="flex items-center gap-2 rounded-2xl border border-akiba-line bg-white px-4 py-3 text-sm transition active:scale-[0.99]"
        >
          <Tag className="h-4 w-4 shrink-0 text-akiba-teal" />
          <span className="flex-1 text-akiba-ink">
            🎟 {voucherSummary.activeCount} active
            {voucherSummary.expiringSoonCount > 0 && ` · ${voucherSummary.expiringSoonCount} expiring soon`}
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-akiba-muted" />
        </TrackedLink>
      )}
    </main>
  );
}
