/* eslint-disable @next/next/no-img-element -- Merchant media uses dynamic public URLs. */
import Link from "next/link";
import { isUuid } from "@/lib/subscriptionPayments";
import { redirect, notFound } from "next/navigation";
import { ArrowRight, Coffee, Info, ChevronDown } from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/types";
import {
  coreVoucherQuery,
  voucherReadAll,
  type VoucherOffer,
  type VoucherMerchant,
  type VoucherActivity,
} from "@/lib/voucherCatalogue";
import {
  voucherKind,
  voucherState,
  voucherReturnPath,
  voucherBenefit,
  claimDuration,
} from "@/lib/voucherPresentation";
import { safePublicUrl } from "@/lib/reviewPresentation";
import { formatDate, formatNumber } from "@/lib/utils";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import {
  voucherCanvas,
  voucherCard,
  VoucherStatus,
  VoucherFacts,
} from "@/components/vouchers/VoucherUi";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
export default async function VoucherDetails({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { returnTo?: string };
}) {
  const session = await requireAdminSession();
  if (!session) redirect("/login");
  if (!isUuid(params.id)) notFound();
  if (
    !hasPermission(session.role, "vouchers.read") &&
    !hasPermission(session.role, "voucher_funds.read")
  )
    redirect("/overview");
  const back = voucherReturnPath(searchParams.returnTo);
  const header = (
    <VoucherHeader
      title="Voucher Details"
      backHref={back}
      name={session.name}
      role={session.role}
    />
  );
  const fail = () => (
    <div className={voucherCanvas}>
      {header}
      <div className="p-4">
        <QueueLoadError title="Couldn’t load voucher details" />
      </div>
    </div>
  );
  const result = await coreVoucherQuery().eq("id", params.id).maybeSingle();
  if (result.error) return fail();
  if (!result.data) notFound();
  const offer = result.data as VoucherOffer,
    kind = voucherKind(offer);
  if (
    !hasPermission(
      session.role,
      kind === "reimbursable" ? "voucher_funds.read" : "vouchers.read"
    )
  )
    redirect("/vouchers");
  const [merchantRes, locationRes, activityRes, programRes, allocationRes] =
    await Promise.all([
      supabase
        .from("partners")
        .select("id,name,country,banner_url,logo_url,image_url")
        .eq("id", offer.partner_id)
        .maybeSingle(),
      supabase
        .from("merchant_locations")
        .select("locality,city")
        .eq("partner_id", offer.partner_id)
        .eq("active", true)
        .eq("is_primary", true)
        .limit(1)
        .maybeSingle(),
      voucherReadAll((from, to) =>
        supabase
          .from("issued_vouchers")
          .select(
            "id,voucher_template_id,status,created_at,redeemed_at,expires_at,funding_allocation_id"
          )
          .eq("voucher_template_id", offer.id)
          .order("id")
          .range(from, to)
      )
        .then((data) => ({ data, error: null }))
        .catch(() => ({ data: [], error: true })),
      supabase
        .from("v_program_inventory")
        .select("program_id,total_cap,program_consumed,program_remaining")
        .eq("template_id", offer.id),
      offer.funding_allocation_id
        ? supabase
            .from("v_voucher_funding_allocation_availability")
            .select(
              "allocation_id,program_id,quantity_cap,quantity_claimed_total,quantity_active_or_redeemed,quantity_remaining"
            )
            .eq("allocation_id", offer.funding_allocation_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  const allocationDetails = offer.funding_allocation_id
    ? await supabase
        .from("voucher_funding_allocations")
        .select(
          "eligibility_rule_set_id,voucher_validity_seconds,claim_starts_at,claim_ends_at"
        )
        .eq("id", offer.funding_allocation_id)
        .maybeSingle()
    : { data: null, error: null };
  const eligibility = allocationDetails.data?.eligibility_rule_set_id
    ? await supabase
        .from("voucher_eligibility_rule_sets")
        .select("customer_copy")
        .eq("id", allocationDetails.data.eligibility_rule_set_id)
        .maybeSingle()
    : { data: null, error: null };
  const validitySeconds =
    allocationDetails.data?.voucher_validity_seconds ??
    offer.claim_validity_seconds;
  if (merchantRes.error || locationRes.error || activityRes.error)
    return fail();
  const merchant = merchantRes.data as VoucherMerchant | null,
    location =
      [locationRes.data?.locality, locationRes.data?.city]
        .filter(Boolean)
        .join(", ") || merchant?.country;
  const activity = activityRes.data as VoucherActivity[],
    issued = activity.filter((v) =>
      ["issued", "redeemed", "expired", "revoked"].includes(v.status)
    ).length,
    redeemed = activity.filter((v) => v.status === "redeemed").length;
  const programs = [
    ...new Map((programRes.data ?? []).map((p) => [p.program_id, p])).values(),
  ];
  const pool =
    allocationRes.data ??
    (programs.length === 1
      ? {
          quantity_cap: programs[0].total_cap,
          quantity_claimed_total: programs[0].program_consumed,
          quantity_remaining: programs[0].program_remaining,
        }
      : null);
  const cap = pool?.quantity_cap ?? offer.global_cap,
    remaining = pool?.quantity_remaining ?? null;
  const consumed =
      cap != null && remaining != null ? Math.max(0, cap - remaining) : null,
    percent =
      cap && consumed != null
        ? Math.min(100, Math.round((consumed / cap) * 100))
        : null;
  const self = `/vouchers/${offer.id}?returnTo=${encodeURIComponent(back)}`,
    cover = safePublicUrl(
      merchant?.banner_url || merchant?.image_url || merchant?.logo_url
    ),
    end =
      allocationDetails.data?.claim_ends_at || offer.end_at || offer.expires_at;
  const model =
    kind === "miles"
      ? "Miles-priced voucher"
      : kind === "free"
      ? "Free offer"
      : "Reimbursable voucher";
  return (
    <div className={voucherCanvas}>
      {header}
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        {cover ? (
          <div className="relative overflow-hidden rounded-card">
            <img
              src={cover}
              alt={`${merchant?.name ?? "Merchant"} cover`}
              width={960}
              height={480}
              className="h-44 w-full object-cover sm:h-60"
            />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-4 pt-12 text-white">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-primary">
                  <Coffee className="h-4 w-4" aria-hidden="true" />
                </span>
                {merchant?.name ?? "Merchant unavailable"}
              </span>
              {location && (
                <span className="shrink-0 rounded-full bg-white/95 px-2 py-1 text-xs text-ink">
                  {locationRes.data?.city || merchant?.country}
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-primary-strong">
            {merchant?.name ?? "Merchant unavailable"}
            {location ? ` · ${location}` : ""}
          </p>
        )}
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-primary-strong">{model}</p>
            <VoucherStatus status={voucherState(offer)} />
          </div>
          <h2 className="mt-2 text-3xl font-semibold leading-tight tracking-tight">
            {offer.title}
          </h2>
          {offer.description && (
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              {offer.description}
            </p>
          )}
        </div>
        <section className="rounded-card bg-[#F2F3FF] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <h3 className="font-medium">
              Distribution pool
              {cap != null ? ` (${formatNumber(cap)} cap)` : ""}
            </h3>
            {percent != null && (
              <span className="text-primary-strong">{percent}% claimed</span>
            )}
          </div>
          {percent != null && (
            <progress
              aria-label="Distribution pool claimed"
              value={percent}
              max={100}
              className="mt-3 h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-[#DAE2FD] [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
            />
          )}
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
            {[
              ["Issued", formatNumber(issued)],
              ["Redeemed", formatNumber(redeemed)],
              [
                "Remaining",
                remaining != null
                  ? formatNumber(remaining)
                  : cap == null &&
                    !programRes.error &&
                    !allocationRes.error &&
                    programs.length === 0
                  ? "Uncapped"
                  : "Not reported",
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dd
                  className={`text-lg font-semibold tabular-nums ${
                    label === "Remaining" ? "text-primary-strong" : ""
                  }`}
                >
                  {value}
                </dd>
                <dt className="mt-1 text-xs text-ink-muted">{label}</dt>
              </div>
            ))}
          </dl>
          {(programRes.error || allocationRes.error) && (
            <p role="alert" className="mt-3 text-xs text-ink-muted">
              Remaining inventory could not be loaded.
            </p>
          )}
        </section>
        <Link
          href={`/vouchers/issued?template=${
            offer.id
          }&returnTo=${encodeURIComponent(self)}`}
          className="flex min-h-20 items-center gap-3 rounded-control bg-[#EAEDFF] px-4 py-3 focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary text-white">
            <Coffee className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">
              Issued vouchers ({formatNumber(issued)})
            </span>
            <span className="block text-sm text-ink-muted">
              View claim history & timestamps
            </span>
          </span>
          <ArrowRight
            className="h-5 w-5 shrink-0 text-primary"
            aria-hidden="true"
          />
        </Link>
        <h3 className="px-1 text-sm font-medium text-ink-muted">
          Voucher specifications
        </h3>
        <section className={voucherCard}>
          <VoucherFacts
            items={[
              {
                label: "Benefit",
                value: offer.description || voucherBenefit(offer),
              },
              {
                label: "Miles cost",
                value: (
                  <span className="rounded-full bg-[#F2F3FF] px-3 py-1">
                    {formatNumber(offer.miles_cost)} Miles
                  </span>
                ),
              },
              {
                label: "Validity",
                value: (
                  <>
                    {allocationDetails.data?.claim_starts_at || offer.start_at
                      ? formatDate(
                          allocationDetails.data?.claim_starts_at ||
                            offer.start_at
                        )
                      : "No start date"}{" "}
                    – {end ? formatDate(end) : "No end date"}
                    {claimDuration(validitySeconds) && (
                      <span className="mt-1 block text-xs font-normal">
                        {claimDuration(validitySeconds)} from claim
                      </span>
                    )}
                  </>
                ),
              },
              {
                label: "Eligibility",
                value:
                  kind === "reimbursable"
                    ? eligibility.data?.customer_copy ||
                      "Fund eligibility rules apply"
                    : offer.access_policy === "public"
                    ? "All registered Akiba members"
                    : offer.access_policy === "qualified"
                    ? "Qualified members"
                    : offer.access_policy
                    ? offer.access_policy.replaceAll("_", " ")
                    : "Not specified",
              },
              {
                label: "Claim limits",
                value:
                  offer.max_claims_per_customer != null
                    ? `${offer.max_claims_per_customer} per member`
                    : "Not specified",
              },
            ]}
          />
        </section>
        <details className={voucherCard}>
          <summary className="min-h-11 cursor-pointer font-medium focus-visible:outline-primary">
            More details
          </summary>
          <div className="mt-3 space-y-4">
            <VoucherFacts
              items={[
                { label: "Merchant", value: merchant?.name ?? "Unavailable" },
                {
                  label: "Funding",
                  value: offer.funding_mode.replaceAll("_", " "),
                },
                {
                  label: "Acquisition",
                  value: offer.acquisition_mode ?? "Not specified",
                },
                {
                  label: "Minimum spend",
                  value:
                    offer.minimum_spend_kes != null
                      ? `KES ${formatNumber(offer.minimum_spend_kes)}`
                      : "Not specified",
                },
                {
                  label: "Maximum discount",
                  value:
                    offer.maximum_discount_kes != null
                      ? `KES ${formatNumber(offer.maximum_discount_kes)}`
                      : "Not specified",
                },
              ]}
            />
            {offer.terms_text && (
              <p className="whitespace-pre-wrap text-sm leading-6 text-ink-muted">
                {offer.terms_text}
              </p>
            )}
            {allocationRes.data && (
              <Link
                href={`/vouchers/funds/${allocationRes.data.program_id}/allocations/${offer.funding_allocation_id}`}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary"
              >
                Open funding allocation
              </Link>
            )}
          </div>
        </details>
        <p className="flex items-start gap-2 text-xs text-ink-muted">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          Offer details reflect the current merchant record. Issued voucher
          terms may differ.
        </p>
      </div>
    </div>
  );
}
