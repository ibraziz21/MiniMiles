"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Tag, ExternalLink, ShoppingBag, Smartphone,
  QrCode, ChevronRight, Loader2,
} from "lucide-react";
import { MilesAmount } from "@/components/MilesIcon";
import clsx from "clsx";

type VoucherTemplate = {
  id: string;
  title: string;
  voucher_type: "free" | "percent_off" | "fixed_off";
  miles_cost: number;
  discount_percent: number | null;
  discount_cusd: number | null;
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
  miles_purchase: "Miles Purchase",
  claw:           "Claw Game",
  raffle:         "Raffle",
  giveaway:       "Giveaway",
  merchant_grant: "Merchant Gift",
  akiba_grant:    "Akiba Gift",
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

type Tab = "available" | "active" | "used" | "expired";

const TAB_LABELS: Record<Tab, string> = {
  available: "Available",
  active:    "Active",
  used:      "Used",
  expired:   "Expired",
};

function redeemErrorMessage(status: number, serverMessage?: string): string {
  if (status === 401) return "Sign in to redeem";
  if (status === 400 && serverMessage?.toLowerCase().includes("wallet")) return "Connect a wallet first";
  if (status === 409) return "This voucher is no longer available";
  if (status === 422) return "Not enough AkibaMiles";
  if (status === 429) return "Try again later";
  if (status === 503) return "Redemption is being reconciled. Check My vouchers shortly.";
  return serverMessage ?? "Something went wrong. Please try again.";
}

export function VoucherTabs({
  templates,
  isSignedIn,
}: {
  templates: VoucherTemplate[];
  isSignedIn: boolean;
}) {
  const [tab, setTab] = useState<Tab>("available");
  const [myVouchers, setMyVouchers] = useState<IssuedVoucher[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const needsMine = tab === "active" || tab === "used" || tab === "expired";

  useEffect(() => {
    if (needsMine && !loaded && isSignedIn) {
      setLoading(true);
      fetch("/api/shop/vouchers/my")
        .then((r) => r.json())
        .then(({ vouchers }) => {
          setMyVouchers(vouchers ?? []);
          setLoaded(true);
        })
        .finally(() => setLoading(false));
    }
  }, [needsMine, loaded, isSignedIn]);

  const active  = myVouchers.filter((v) => v.status === "issued");
  const used    = myVouchers.filter((v) => v.status === "redeemed");
  const expired = myVouchers.filter((v) => v.status === "expired");
  const current = tab === "active" ? active : tab === "used" ? used : expired;

  return (
    <div>
      {/* Sticky tab bar — sticks just below the site header (h-16 = top-16) */}
      <div className="sticky top-16 z-10 -mx-4 mb-4 bg-akiba-paper/95 px-4 pb-3 pt-0.5 backdrop-blur-sm sm:static sm:mx-0 sm:mb-6 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <div className="flex gap-1 rounded-2xl bg-akiba-card p-1">
          {(["available", "active", "used", "expired"] as Tab[]).map((tn) => (
            <button
              key={tn}
              onClick={() => setTab(tn)}
              className={clsx(
                "flex-1 rounded-xl py-2 text-xs font-semibold transition sm:py-2.5 sm:text-sm",
                tab === tn
                  ? "bg-white text-akiba-ink shadow-chip"
                  : "text-akiba-muted hover:text-akiba-ink"
              )}
            >
              {TAB_LABELS[tn]}
            </button>
          ))}
        </div>
      </div>

      {/* Available tab */}
      {tab === "available" &&
        (templates.length === 0 ? (
          <EmptyState
            icon={<Tag className="mb-3 h-10 w-10 text-akiba-line" />}
            title="No vouchers available yet"
            subtitle="Check back as merchants add new offers."
          />
        ) : (
          <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <AvailableCard key={t.id} template={t} isSignedIn={isSignedIn} />
            ))}
          </div>
        ))}

      {/* My vouchers tabs */}
      {needsMine &&
        (!isSignedIn ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white py-14 text-center">
            <Tag className="mb-3 h-10 w-10 text-akiba-line" />
            <p className="font-medium text-akiba-ink">Sign in to see your vouchers</p>
            <a
              href="/login"
              className="mt-4 rounded-full bg-akiba-teal px-5 py-2 text-sm font-semibold text-white"
            >
              Sign in
            </a>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-akiba-line border-t-akiba-teal" />
          </div>
        ) : current.length === 0 ? (
          <EmptyState
            icon={<Smartphone className="mb-3 h-10 w-10 text-akiba-line" />}
            title={
              tab === "active"
                ? "No active vouchers"
                : tab === "used"
                ? "No used vouchers yet"
                : "No expired vouchers"
            }
            subtitle={tab === "active" ? "Redeem a voucher to see it here." : undefined}
          />
        ) : (
          <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
            {current.map((v) => <IssuedCard key={v.id} voucher={v} />)}
          </div>
        ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white py-12 text-center">
      {icon}
      <p className="font-medium text-akiba-ink">{title}</p>
      {subtitle && <p className="mt-1 text-sm text-akiba-muted">{subtitle}</p>}
    </div>
  );
}

function discountLabel(t: VoucherTemplate): string {
  if (t.voucher_type === "free") {
    if (t.retail_value_cusd) return `Free (up to $${t.retail_value_cusd})`;
    return "FREE item";
  }
  if (t.voucher_type === "percent_off") return `${t.discount_percent}% off`;
  return `$${(t.discount_cusd ?? 0).toFixed(2)} off`;
}

function AvailableCard({
  template: t,
  isSignedIn,
}: {
  template: VoucherTemplate;
  isSignedIn: boolean;
}) {
  const router = useRouter();
  const merchant = t.partners;

  type RedeemStatus = "idle" | "loading" | "error";
  const [redeemStatus, setRedeemStatus] = useState<RedeemStatus>("idle");
  const [redeemError, setRedeemError] = useState<string | null>(null);

  async function handleRedeem() {
    if (!isSignedIn) {
      router.push("/login");
      return;
    }
    setRedeemStatus("loading");
    setRedeemError(null);

    try {
      const res = await fetch("/api/shop/vouchers/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: t.id }),
      });
      const data = await res.json() as { voucher?: { id: string }; error?: string };
      if (!res.ok) {
        setRedeemStatus("error");
        setRedeemError(redeemErrorMessage(res.status, data.error));
        return;
      }
      router.push(`/vouchers/${data.voucher!.id}`);
    } catch {
      setRedeemStatus("error");
      setRedeemError("Something went wrong. Please try again.");
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-akiba-line bg-white">

      {/* Merchant + discount header */}
      <div className="flex items-center gap-3 border-b border-dashed border-akiba-line bg-akiba-tint px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white sm:h-10 sm:w-10">
          {merchant?.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={merchant.image_url}
              alt={merchant.name}
              className="h-full w-full object-contain"
            />
          ) : (
            <ShoppingBag className="h-5 w-5 text-akiba-muted" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-akiba-muted">{merchant?.name ?? "All merchants"}</p>
          <p className="font-sterling text-base font-bold text-akiba-teal sm:text-lg">
            {discountLabel(t)}
          </p>
        </div>
      </div>

      {/* Description */}
      <div className="flex flex-1 flex-col space-y-0.5 px-3 py-3 text-sm text-akiba-muted sm:px-4">
        <p className="font-medium text-akiba-ink">{t.title}</p>
        {t.applicable_category && (
          <p className="text-xs">
            On:{" "}
            <span className="font-medium capitalize text-akiba-ink">
              {t.applicable_category}
            </span>
          </p>
        )}
      </div>

      {/* Error feedback */}
      {redeemStatus === "error" && redeemError && (
        <div className="mx-3 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 sm:mx-4">
          {redeemError}
          {redeemError === "Sign in to redeem" && (
            <a href="/login" className="ml-1 underline">Sign in</a>
          )}
          {redeemError === "Connect a wallet first" && (
            <a href="/me" className="ml-1 underline">Go to profile</a>
          )}
        </div>
      )}

      {/* Primary CTA */}
      <div className="px-3 pb-3 sm:px-4">
        <button
          onClick={handleRedeem}
          disabled={redeemStatus === "loading"}
          className={clsx(
            "flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition",
            redeemStatus === "loading"
              ? "cursor-not-allowed bg-akiba-teal/60 text-white"
              : "bg-akiba-teal text-white hover:bg-akiba-teal/90 active:scale-[0.98]"
          )}
        >
          {redeemStatus === "loading" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Redeeming…
            </>
          ) : (
            <>
              <MilesAmount amount={t.miles_cost} size="xs" className="text-white [&_svg]:fill-white" />
              Redeem
            </>
          )}
        </button>
      </div>

      {/* Secondary — shop link */}
      {merchant && (
        <a
          href={`/shop/${merchant.slug}`}
          className="flex items-center justify-center gap-1.5 border-t border-akiba-line bg-akiba-card py-2 text-xs font-semibold text-akiba-teal transition hover:bg-akiba-tint sm:py-2.5"
        >
          <ExternalLink className="h-3 w-3" /> Shop at {merchant.name}
        </a>
      )}
    </div>
  );
}

function IssuedCard({ voucher: v }: { voucher: IssuedVoucher }) {
  const t = v.spend_voucher_templates;
  const merchant = t?.partners;

  const statusColors: Record<string, string> = {
    issued:   "bg-akiba-tint text-akiba-teal",
    redeemed: "bg-green-50 text-green-700",
    expired:  "bg-akiba-card text-akiba-muted",
  };

  return (
    <a
      href={`/vouchers/${v.id}`}
      className={clsx(
        "group flex flex-col overflow-hidden rounded-2xl border bg-white transition hover:shadow-md",
        v.status === "expired" ? "border-akiba-line opacity-60" : "border-akiba-line"
      )}
    >
      <div className="flex items-center justify-between border-b border-dashed border-akiba-line bg-akiba-tint px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white sm:h-10 sm:w-10">
            {merchant?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={merchant.image_url}
                alt={merchant.name}
                className="h-full w-full object-contain"
              />
            ) : (
              <ShoppingBag className="h-5 w-5 text-akiba-muted" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs text-akiba-muted">
              {merchant?.name ?? "All merchants"}
            </p>
            <p className="font-sterling text-base font-bold text-akiba-teal sm:text-lg">
              {t ? discountLabel(t) : "Voucher"}
            </p>
          </div>
        </div>
        <span
          className={clsx(
            "ml-2 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize",
            statusColors[v.status]
          )}
        >
          {v.status}
        </span>
      </div>

      <div className="space-y-0.5 px-3 py-3 text-xs text-akiba-muted sm:px-4 sm:py-4">
        {t && <p className="text-sm font-medium text-akiba-ink">{t.title}</p>}
        {v.expires_at && (
          <p>Expires: {new Date(v.expires_at).toLocaleDateString()}</p>
        )}
        {v.redeemed_at && (
          <p>Used: {new Date(v.redeemed_at).toLocaleDateString()}</p>
        )}
        {v.acquisition_source && (
          <p className="text-akiba-muted/70">
            {SOURCE_LABELS[v.acquisition_source] ?? v.acquisition_source}
            {v.voucher_programs?.name ? ` · ${v.voucher_programs.name}` : ""}
          </p>
        )}
        {v.sponsor && <p className="text-purple-500">Sponsored by {v.sponsor}</p>}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-akiba-line bg-akiba-card px-3 py-2 text-xs font-semibold text-akiba-teal sm:px-4 sm:py-2.5">
        <span className="flex items-center gap-1.5">
          {v.status === "issued" ? (
            <><QrCode className="h-3.5 w-3.5" /> Show QR to redeem</>
          ) : (
            "View details"
          )}
        </span>
        <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </a>
  );
}
