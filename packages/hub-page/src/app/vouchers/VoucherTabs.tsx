"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Gift,
  History,
  Loader2,
  QrCode,
  RotateCw,
  ShoppingBag,
  Sparkles,
  Tag,
  TicketCheck,
  WalletCards,
} from "lucide-react";
import clsx from "clsx";
import { GetVoucherButton } from "@/components/vouchers/GetVoucherButton";
import { FundedOfferCard, type FundedOffer } from "@/components/vouchers/FundedOfferCard";
import { LoyaltyVoucherCard, type LoyaltyOffer } from "@/components/vouchers/LoyaltyVoucherCard";
import { MilesAmount } from "@/components/MilesIcon";
import { recordDealViewProof } from "@/lib/akiba/dealViewProof";
import { dealLabel } from "@/lib/akiba/deals";

type VoucherTemplate = {
  id: string;
  title: string;
  voucher_type: "free" | "percent_off" | "fixed_off";
  miles_cost: number;
  discount_percent: number | null;
  discount_cusd: number | null;
  discount_kes?: number | null;
  applicable_category: string | null;
  retail_value_cusd: number | null;
  partners: {
    id: string;
    slug: string;
    name: string;
    image_url: string | null;
  } | null;
};

const SOURCE_LABELS: Record<string, string> = {
  miles_purchase: "Bought with Miles",
  claw: "Won in Claw Game",
  raffle: "Won in a raffle",
  giveaway: "Giveaway reward",
  merchant_grant: "Gift from merchant",
  akiba_grant: "Gift from Akiba",
  loyalty_free_claim: "Loyalty reward",
  loyalty_miles_purchase: "Loyalty reward",
};

type IssuedVoucher = {
  id: string;
  code: string;
  status: "issued" | "redeemed" | "expired" | "void" | "pending" | "claiming";
  created_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  acquisition_source?: string | null;
  sponsor?: string | null;
  voucher_programs?: { name: string } | null;
  spend_voucher_templates: VoucherTemplate | null;
};

type Tab = "active" | "claimable" | "available" | "used" | "expired";
type PrimaryTab = "mine" | "claim" | "shop";

const VALID_TABS: Tab[] = ["active", "claimable", "available", "used", "expired"];

function isTab(value: string | null): value is Tab {
  return !!value && (VALID_TABS as string[]).includes(value);
}

function primaryTabFor(tab: Tab): PrimaryTab {
  if (tab === "claimable") return "claim";
  if (tab === "available") return "shop";
  return "mine";
}

export function VoucherTabs({
  templates,
  fundedOffers,
  loyaltyOffers,
  claimedAllocationIds,
  isSignedIn,
  questMode = false,
}: {
  templates: VoucherTemplate[];
  fundedOffers: FundedOffer[];
  loyaltyOffers: LoyaltyOffer[];
  claimedAllocationIds: string[];
  isSignedIn: boolean;
  questMode?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTabState] = useState<Tab>(isSignedIn ? "active" : "available");
  const [myVouchers, setMyVouchers] = useState<IssuedVoucher[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const urlTab = new URLSearchParams(window.location.search).get("tab");
    if (isTab(urlTab)) setTabState(urlTab);
  }, []);

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    const params = new URLSearchParams(window.location.search);
    if ((next === "active" && isSignedIn) || (next === "available" && !isSignedIn)) {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [isSignedIn, pathname, router]);

  const primaryTab = primaryTabFor(tab);
  const needsMine = primaryTab === "mine";

  useEffect(() => {
    if (!needsMine || loaded || !isSignedIn) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);

    fetch("/api/shop/vouchers/my", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load vouchers");
        return response.json() as Promise<{ vouchers?: IssuedVoucher[] }>;
      })
      .then(({ vouchers }) => {
        setMyVouchers(vouchers ?? []);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [needsMine, loaded, isSignedIn, loadAttempt]);

  const active = myVouchers.filter((voucher) =>
    ["pending", "issued", "claiming"].includes(voucher.status),
  );
  const used = myVouchers.filter((voucher) => voucher.status === "redeemed");
  const expired = myVouchers.filter((voucher) => voucher.status === "expired");
  const current = tab === "used" ? used : tab === "expired" ? expired : active;
  const claimedIds = useMemo(() => new Set(claimedAllocationIds), [claimedAllocationIds]);
  const sortedFundedOffers = useMemo(
    () => [...fundedOffers].sort((a, b) => Number(claimedIds.has(a.allocationId)) - Number(claimedIds.has(b.allocationId))),
    [fundedOffers, claimedIds],
  );

  // Loyalty offers split by acquisition mode: free ones join the funded
  // offers in "Claim free offers", Miles-priced ones join the catalogue in
  // "Shop with Miles" — same tab structure, one more card type in each grid.
  const freeLoyaltyOffers = useMemo(
    () => [...loyaltyOffers.filter((offer) => offer.acquisitionMode === "free")]
      .sort((a, b) => Number(a.alreadyClaimed) - Number(b.alreadyClaimed)),
    [loyaltyOffers],
  );
  const milesLoyaltyOffers = useMemo(
    () => [...loyaltyOffers.filter((offer) => offer.acquisitionMode === "miles")]
      .sort((a, b) => Number(a.alreadyClaimed) - Number(b.alreadyClaimed)),
    [loyaltyOffers],
  );
  const unclaimedOfferCount = fundedOffers.filter((offer) => !claimedIds.has(offer.allocationId)).length
    + freeLoyaltyOffers.filter((offer) => !offer.alreadyClaimed).length;
  const availableMilesOfferCount = templates.length
    + milesLoyaltyOffers.filter((offer) => !offer.alreadyClaimed).length;

  const selectPrimary = (next: PrimaryTab) => {
    setTab(next === "mine" ? "active" : next === "claim" ? "claimable" : "available");
  };

  return (
    <div>
      <div
        className="grid gap-2 sm:grid-cols-3 sm:gap-3"
        role="tablist"
        aria-label="Choose a voucher action"
      >
        <HubTab
          id="mine"
          selected={primaryTab === "mine"}
          icon={<TicketCheck className="h-5 w-5" />}
          title="My vouchers"
          description={loaded ? `${active.length} ready to use` : "Vouchers you own"}
          badge={loaded && active.length > 0 ? String(active.length) : undefined}
          onClick={() => selectPrimary("mine")}
        />
        <HubTab
          id="claim"
          selected={primaryTab === "claim"}
          icon={<Gift className="h-5 w-5" />}
          title="Claim free offers"
          description={freeLoyaltyOffers.length > 0 ? "No Miles needed" : "Funded by Akiba"}
          badge={unclaimedOfferCount > 0 ? String(unclaimedOfferCount) : undefined}
          onClick={() => selectPrimary("claim")}
        />
        <HubTab
          id="shop"
          selected={primaryTab === "shop"}
          icon={<WalletCards className="h-5 w-5" />}
          title="Shop with Miles"
          description={`${availableMilesOfferCount} ${availableMilesOfferCount === 1 ? "reward" : "rewards"} available`}
          onClick={() => selectPrimary("shop")}
        />
      </div>

      <div
        id={`voucher-panel-${primaryTab}`}
        role="tabpanel"
        aria-labelledby={`voucher-hub-tab-${primaryTab}`}
        className="mt-7 sm:mt-10"
      >
        {primaryTab === "mine" && (
          <section>
            <SectionHeading
              eyebrow="Your wallet"
              title="My vouchers"
              description="Everything you own, ready when you need it."
              action={active.length === 0 && loaded ? (
                <button type="button" onClick={() => setTab("available")} className="inline-flex items-center gap-1 text-sm font-semibold text-akiba-teal hover:text-akiba-tealDark">
                  Browse rewards <ArrowRight className="h-4 w-4" />
                </button>
              ) : undefined}
            />

            {isSignedIn && (
              <div className="mb-5 flex w-full gap-1 rounded-2xl bg-akiba-card p-1 sm:w-fit" role="tablist" aria-label="My voucher status">
                <StatusTab selected={tab === "active"} onClick={() => setTab("active")} icon={<TicketCheck className="h-3.5 w-3.5" />} label="Ready to use" count={loaded ? active.length : undefined} />
                <StatusTab selected={tab === "used"} onClick={() => setTab("used")} icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Used" count={loaded ? used.length : undefined} />
                <StatusTab selected={tab === "expired"} onClick={() => setTab("expired")} icon={<History className="h-3.5 w-3.5" />} label="Expired" count={loaded ? expired.length : undefined} />
              </div>
            )}

            {!isSignedIn ? (
              <SignInState />
            ) : loading ? (
              <VoucherSkeleton />
            ) : loadError ? (
              <LoadError onRetry={() => setLoadAttempt((attempt) => attempt + 1)} />
            ) : current.length === 0 ? (
              <EmptyState
                icon={tab === "active" ? <TicketCheck className="h-7 w-7" /> : <History className="h-7 w-7" />}
                title={tab === "active" ? "No vouchers ready yet" : tab === "used" ? "Nothing used yet" : "No expired vouchers"}
                subtitle={tab === "active" ? "Claim a free offer or use your Miles to get your first voucher." : "Your voucher history will appear here."}
                action={tab === "active" ? (
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {(fundedOffers.length > 0 || freeLoyaltyOffers.length > 0) && <button type="button" onClick={() => setTab("claimable")} className="rounded-full border border-akiba-teal/25 bg-akiba-tint px-4 py-2 text-sm font-semibold text-akiba-teal">Claim free offer</button>}
                    <button type="button" onClick={() => setTab("available")} className="rounded-full bg-akiba-ink px-4 py-2 text-sm font-semibold text-white">Shop with Miles</button>
                  </div>
                ) : undefined}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {current.map((voucher) => <IssuedCard key={voucher.id} voucher={voucher} />)}
              </div>
            )}
          </section>
        )}

        {primaryTab === "claim" && (
          <section>
            <SectionHeading
              eyebrow="No Miles needed"
              title="Claim free offers"
              description={freeLoyaltyOffers.length > 0
                ? "Free vouchers you can claim — funded by Akiba or by the merchant, depending on the offer."
                : "If you qualify, Akiba covers the voucher value and reimburses the merchant."}
            />
            {fundedOffers.length === 0 && freeLoyaltyOffers.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="h-7 w-7" />}
                title="No free offers right now"
                subtitle="New free offers will appear here when they become available."
                action={<button type="button" onClick={() => setTab("available")} className="mt-5 rounded-full bg-akiba-ink px-4 py-2 text-sm font-semibold text-white">Shop with Miles instead</button>}
              />
            ) : (
              <>
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                  <p><span className="font-semibold">How it works:</span> Choose an offer and we’ll confirm its availability and any requirements, then add it straight to My vouchers. You never pay Miles for these offers.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {sortedFundedOffers.map((offer) => (
                    <FundedOfferCard
                      key={offer.allocationId}
                      offer={offer}
                      isSignedIn={isSignedIn}
                      alreadyClaimed={claimedIds.has(offer.allocationId)}
                    />
                  ))}
                  {freeLoyaltyOffers.map((offer) => (
                    <LoyaltyVoucherCard key={offer.templateId} offer={offer} isSignedIn={isSignedIn} />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {primaryTab === "shop" && (
          <section>
            <SectionHeading
              eyebrow="AkibaMiles marketplace"
              title="Shop with Miles"
              description="Exchange your AkibaMiles for vouchers from participating merchants."
            />
            {templates.length === 0 && milesLoyaltyOffers.length === 0 ? (
              <EmptyState
                icon={<Tag className="h-7 w-7" />}
                title="No Miles rewards available yet"
                subtitle="Check back as merchants add new vouchers."
              />
            ) : (
              <>
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-akiba-teal/15 bg-akiba-tint/70 px-4 py-3 text-sm text-akiba-ink">
                  <WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-akiba-teal" />
                  <p>Choose a reward, review the Miles price, then confirm. Your balance is only charged after confirmation.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {milesLoyaltyOffers.map((offer) => (
                    <LoyaltyVoucherCard key={offer.templateId} offer={offer} isSignedIn={isSignedIn} />
                  ))}
                  {templates.map((template) => (
                    <AvailableCard key={template.id} template={template} isSignedIn={isSignedIn} questMode={questMode} />
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function HubTab({
  id,
  selected,
  icon,
  title,
  description,
  badge,
  onClick,
}: {
  id: PrimaryTab;
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`voucher-hub-tab-${id}`}
      aria-selected={selected}
      aria-controls={`voucher-panel-${id}`}
      onClick={onClick}
      className={clsx(
        "group flex min-w-0 items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition sm:items-start sm:px-4 sm:py-4",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2",
        selected
          ? "border-akiba-ink bg-akiba-ink text-white shadow-soft"
          : "border-akiba-line bg-white text-akiba-ink hover:border-akiba-teal/40 hover:shadow-chip",
      )}
    >
      <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition", selected ? "bg-white/15 text-white" : "bg-akiba-tint text-akiba-teal")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold sm:text-base">{title}</span>
          {badge && <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-bold", selected ? "bg-akiba-teal text-white" : "bg-akiba-tint text-akiba-teal")}>{badge}</span>}
        </span>
        <span className={clsx("mt-0.5 block truncate text-xs", selected ? "text-white/65" : "text-akiba-muted")}>{description}</span>
      </span>
      <ChevronRight className={clsx("mt-2 h-4 w-4 shrink-0 transition sm:mt-3", selected ? "text-white/70" : "text-akiba-line group-hover:translate-x-0.5 group-hover:text-akiba-teal")} />
    </button>
  );
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-akiba-teal">{eyebrow}</p>
        <h2 className="font-sterling text-2xl font-semibold text-akiba-ink sm:text-3xl">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-akiba-muted">{description}</p>
      </div>
      {action && <div className="hidden shrink-0 sm:block">{action}</div>}
    </div>
  );
}

function StatusTab({ selected, onClick, icon, label, count }: { selected: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={clsx(
        "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold transition sm:flex-none sm:px-4 sm:text-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal",
        selected ? "bg-white text-akiba-ink shadow-chip" : "text-akiba-muted hover:text-akiba-ink",
      )}
    >
      <span className="hidden sm:block">{icon}</span>
      {label}
      {count !== undefined && <span className={clsx("rounded-full px-1.5 py-0.5 text-[10px]", selected ? "bg-akiba-tint text-akiba-teal" : "bg-white text-akiba-muted")}>{count}</span>}
    </button>
  );
}

function EmptyState({ icon, title, subtitle, action }: { icon: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-akiba-line bg-white px-6 py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-akiba-card text-akiba-muted">{icon}</div>
      <h3 className="font-sterling text-xl font-semibold text-akiba-ink">{title}</h3>
      {subtitle && <p className="mt-1.5 max-w-sm text-sm text-akiba-muted">{subtitle}</p>}
      {action}
    </div>
  );
}

function SignInState() {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-akiba-ink px-6 py-10 text-center sm:px-10 sm:py-12">
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full border-[32px] border-white/5" />
      <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white"><TicketCheck className="h-7 w-7" /></div>
      <h3 className="relative mt-4 font-sterling text-2xl font-semibold text-white">Your vouchers live here</h3>
      <p className="relative mx-auto mt-2 max-w-sm text-sm text-white/65">Sign in to see vouchers you own, open their QR codes, and check your redemption history.</p>
      <a href="/login" className="relative mt-6 inline-flex items-center gap-2 rounded-full bg-akiba-teal px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-akiba-tealDark">
        Sign in to continue <ArrowRight className="h-4 w-4" />
      </a>
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-3xl border border-red-100 bg-red-50/50 px-6 text-center">
      <CircleAlert className="h-7 w-7 text-red-500" />
      <p className="mt-3 font-semibold text-akiba-ink">We couldn&apos;t load your vouchers</p>
      <p className="mt-1 text-sm text-akiba-muted">Your vouchers are safe. Try loading them again.</p>
      <button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-full bg-akiba-ink px-4 py-2 text-sm font-semibold text-white"><RotateCw className="h-4 w-4" /> Try again</button>
    </div>
  );
}

function VoucherSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading your vouchers" role="status">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-56 animate-pulse rounded-3xl border border-akiba-line bg-white p-5">
          <div className="h-10 w-10 rounded-xl bg-akiba-card" />
          <div className="mt-6 h-5 w-2/3 rounded bg-akiba-card" />
          <div className="mt-3 h-3 w-1/2 rounded bg-akiba-card" />
          <div className="mt-10 h-10 rounded-xl bg-akiba-card" />
        </div>
      ))}
      <span className="sr-only">Loading your vouchers…</span>
    </div>
  );
}

function MerchantMark({ imageUrl, name }: { imageUrl: string | null | undefined; name: string }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/5 bg-white shadow-chip">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={name} className="h-full w-full object-contain p-0.5" />
      ) : (
        <ShoppingBag className="h-5 w-5 text-akiba-muted" />
      )}
    </div>
  );
}

function AvailableCard({ template: t, isSignedIn, questMode }: { template: VoucherTemplate; isSignedIn: boolean; questMode: boolean }) {
  const merchant = t.partners;
  const [interacted, setInteracted] = useState(false);

  return (
    <article className="group flex min-h-[300px] flex-col overflow-hidden rounded-3xl border border-akiba-line bg-white transition hover:-translate-y-0.5 hover:border-akiba-teal/30 hover:shadow-soft">
      <div className="relative border-b border-dashed border-akiba-line bg-gradient-to-br from-akiba-tint to-white px-4 pb-5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <MerchantMark imageUrl={merchant?.image_url} name={merchant?.name ?? "Akiba merchant"} />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-akiba-muted">{merchant?.name ?? "All merchants"}</p>
              <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-akiba-teal"><WalletCards className="h-3 w-3" /> Miles reward</span>
            </div>
          </div>
          <span className="rounded-full border border-akiba-teal/15 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-akiba-teal">Available</span>
        </div>
        <p className="mt-5 font-sterling text-2xl font-bold leading-none text-akiba-ink">{dealLabel(t)}</p>
      </div>

      <div className="flex flex-1 flex-col px-4 py-4">
        <h3 className="text-sm font-semibold leading-snug text-akiba-ink">{t.title}</h3>
        {t.applicable_category && <p className="mt-1.5 text-xs capitalize text-akiba-muted">For {t.applicable_category}</p>}
        <div className="mt-auto pt-5">
          <div className="mb-2.5 flex items-center justify-between text-xs text-akiba-muted">
            <span>Miles price</span>
            <MilesAmount amount={t.miles_cost} size="sm" className="text-akiba-ink" />
          </div>
          <GetVoucherButton templateId={t.id} milesCost={t.miles_cost} isSignedIn={isSignedIn} onInteract={questMode ? () => setInteracted(true) : undefined} />
          {questMode && interacted && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-akiba-teal"><CheckCircle2 className="h-3.5 w-3.5" /> Quest progress saved — <a href="/quests" className="underline">go to Quests</a></p>
          )}
        </div>
      </div>

      {merchant && (
        <a
          href={`/merchants/${merchant.slug}`}
          onClick={() => {
            recordDealViewProof(t.id);
            if (questMode) setInteracted(true);
          }}
          className="flex items-center justify-center gap-1.5 border-t border-akiba-line bg-akiba-card/70 py-2.5 text-xs font-semibold text-akiba-muted transition hover:bg-akiba-tint hover:text-akiba-teal"
        >
          <ExternalLink className="h-3 w-3" /> View merchant
        </a>
      )}
    </article>
  );
}

function IssuedCard({ voucher: v }: { voucher: IssuedVoucher }) {
  const template = v.spend_voucher_templates;
  const merchant = template?.partners;
  const isReady = v.status === "issued";
  const isProcessing = v.status === "pending" || v.status === "claiming";

  return (
    <a
      href={`/vouchers/${v.id}`}
      className={clsx(
        "group relative flex min-h-[250px] flex-col overflow-hidden rounded-3xl border bg-white transition hover:-translate-y-0.5 hover:shadow-soft",
        v.status === "expired" ? "border-akiba-line opacity-65" : "border-akiba-teal/20",
      )}
    >
      <span className={clsx("absolute inset-y-0 left-0 w-1.5", isReady ? "bg-akiba-teal" : isProcessing ? "bg-amber-400" : "bg-akiba-line")} />
      <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <MerchantMark imageUrl={merchant?.image_url} name={merchant?.name ?? "Akiba merchant"} />
          <div className="min-w-0">
            <p className="truncate text-xs text-akiba-muted">{merchant?.name ?? "All merchants"}</p>
            <p className="mt-0.5 font-sterling text-xl font-bold text-akiba-ink">{template ? dealLabel(template) : "Voucher"}</p>
          </div>
        </div>
        <span className={clsx(
          "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
          isReady ? "bg-akiba-tint text-akiba-teal" : isProcessing ? "bg-amber-50 text-amber-700" : v.status === "redeemed" ? "bg-emerald-50 text-emerald-700" : "bg-akiba-card text-akiba-muted",
        )}>
          {isProcessing ? "Processing" : isReady ? "Ready" : v.status === "redeemed" ? "Used" : v.status}
        </span>
      </div>

      <div className="flex-1 border-t border-dashed border-akiba-line px-5 py-4">
        {template && <h3 className="text-sm font-semibold text-akiba-ink">{template.title}</h3>}
        <div className="mt-2 space-y-1 text-xs text-akiba-muted">
          {v.expires_at && <p className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> Expires {new Date(v.expires_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</p>}
          {v.redeemed_at && <p>Used {new Date(v.redeemed_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</p>}
          {v.acquisition_source && <p className="text-akiba-muted/75">{SOURCE_LABELS[v.acquisition_source] ?? v.acquisition_source}{v.voucher_programs?.name ? ` · ${v.voucher_programs.name}` : ""}</p>}
          {v.sponsor && <p className="font-medium text-purple-600">Sponsored by {v.sponsor}</p>}
        </div>
      </div>

      <div className={clsx("mt-auto flex items-center justify-between border-t px-5 py-3 text-xs font-semibold", isReady ? "border-akiba-teal/15 bg-akiba-tint text-akiba-teal" : "border-akiba-line bg-akiba-card/70 text-akiba-muted")}>
        <span className="flex items-center gap-1.5">
          {isReady ? <><QrCode className="h-4 w-4" /> Open voucher &amp; QR</> : isProcessing ? <><Loader2 className="h-4 w-4 animate-spin" /> Preparing your voucher</> : "View voucher details"}
        </span>
        <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </a>
  );
}
