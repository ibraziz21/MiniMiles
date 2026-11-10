import { fundDate, fundMoney } from "@/lib/voucherFundNavigation";
/* eslint-disable @next/next/no-img-element -- Merchant media uses dynamic public URLs. */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  CheckCircle2,
  Store,
  ArrowRight,
  Info,
  CalendarDays,
} from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/types";
import { VOUCHER_FUND_RPCS, type MerchantReadiness } from "@/lib/voucherFunds";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import {
  voucherCanvas,
  voucherCard,
  VoucherStatus,
  VoucherFacts,
} from "@/components/vouchers/VoucherUi";
import { AllocationActions } from "@/components/vouchers/AllocationActions";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
import { formatNumber } from "@/lib/utils";
export default async function ReviewAllocation({
  params,
  searchParams,
}: {
  params: { fundId: string; allocationId: string };
  searchParams: { published?: string };
}) {
  const session = await requireAdminSession("voucher_funds.read");
  if (!session) redirect("/login");
  const { fundId, allocationId } = params;
  const base = `/vouchers/funds/${fundId}/allocations/${allocationId}`;
  const header = (
    <VoucherHeader
      title="Allocation Review"
      backHref={`/vouchers/funds/${fundId}`}
      name={session.name}
      role={session.role}
    />
  );
  const fail = () => (
    <div className={voucherCanvas}>
      {header}
      <div className="p-4">
        <QueueLoadError title="Couldn’t load allocation review" />
      </div>
    </div>
  );
  const r = await supabase
    .from("voucher_funding_allocations")
    .select(
      "*,spend_voucher_templates!voucher_funding_allocations_voucher_template_id_fkey(title,description,voucher_type,discount_kes,discount_percent,maximum_discount_kes,minimum_spend_kes),partners!voucher_funding_allocations_merchant_id_fkey(name,banner_url,logo_url,image_url,country),voucher_funding_programs(name,state,currency),voucher_eligibility_rule_sets(customer_copy,mode,rules)"
    )
    .eq("id", allocationId)
    .maybeSingle();
  if (r.error) return fail();
  if (!r.data || r.data.program_id !== fundId) notFound();
  const allocation = r.data;
  const template = allocation.spend_voucher_templates as unknown as {
      title: string;
      description: string | null;
      voucher_type: string;
      discount_kes: number | null;
      discount_percent: number | null;
      maximum_discount_kes: number | null;
      minimum_spend_kes: number;
    } | null,
    merchant = allocation.partners as unknown as {
      name: string;
      banner_url: string | null;
      logo_url: string | null;
      image_url: string | null;
      country: string | null;
    } | null,
    fund = allocation.voucher_funding_programs as unknown as {
      name: string;
      state: string;
      currency: string;
    } | null,
    eligibility = allocation.voucher_eligibility_rule_sets as unknown as {
      customer_copy: string | null;
      mode: string;
      rules: unknown[];
    } | null;
  const [readinessRes, locationRes] = await Promise.all([
    supabase.rpc(VOUCHER_FUND_RPCS.allocationMerchantReadiness, {
      p_allocation_id: allocationId,
    }),
    supabase
      .from("merchant_locations")
      .select("address_line_1,locality,city")
      .eq("partner_id", allocation.merchant_id)
      .eq("active", true)
      .eq("is_primary", true)
      .limit(1)
      .maybeSingle(),
  ]);
  const readiness = (readinessRes.data ?? []) as MerchantReadiness[],
    location =
      [
        locationRes.data?.address_line_1,
        locationRes.data?.locality,
        locationRes.data?.city,
      ]
        .filter(Boolean)
        .join(", ") || merchant?.country,
    photo = merchant?.banner_url || merchant?.image_url || merchant?.logo_url;
  const money = fundMoney(
      allocation.authorized_budget_minor,
      fund?.currency || "KES"
    ),
    canWrite = hasPermission(session.role, "voucher_funds.write");
  const published =
    searchParams.published === "1" &&
    ["active", "scheduled"].includes(allocation.state);
  return (
    <div className={voucherCanvas}>
      {header}
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        {published ? (
          <>
            <div role="status" className="py-5 text-center">
              <span className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-[10px] border-[#EAEDFF] bg-[#91EEFF] text-primary-strong">
                <CheckCircle2 className="h-12 w-12" aria-hidden="true" />
              </span>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight">
                Allocation published
              </h2>
              <p className="mt-4 text-base leading-7 text-ink-muted">
                {merchant?.name} has been allocated{" "}
                <strong className="text-ink">{money}</strong> (
                {formatNumber(allocation.quantity_cap)} vouchers) from{" "}
                {fund?.name}.
              </p>
            </div>
            <section className={voucherCard}>
              <VoucherFacts
                items={[
                  { label: "Merchant", value: merchant?.name ?? "Unavailable" },
                  { label: "Voucher", value: template?.title ?? "Unavailable" },
                  {
                    label: "Quantity",
                    value: formatNumber(allocation.quantity_cap),
                  },
                  {
                    label: "Effective",
                    value: `${fundDate(
                      allocation.claim_starts_at
                    )} – ${fundDate(allocation.claim_ends_at)}`,
                  },
                  {
                    label: "Status",
                    value: <VoucherStatus status={allocation.state} />,
                  },
                ]}
              />
            </section>
            <p className="flex items-start gap-2 rounded-control bg-[#F2F3FF] p-4 text-sm text-ink-muted">
              <Info
                className="h-5 w-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              Availability follows the saved claim window and eligibility rules.
            </p>
            <Link
              href={base}
              className="flex min-h-12 items-center justify-center gap-2 rounded-control bg-primary px-4 font-medium text-white"
            >
              View allocation
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href={`/vouchers/funds/${fundId}`}
              className="flex min-h-11 items-center justify-center text-sm font-medium text-primary"
            >
              Back to fund
            </Link>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold tracking-tight">
                Review allocation
              </h2>
              <VoucherStatus status={allocation.state} />
            </div>
            <p className="text-sm text-ink-muted">
              Review the saved allocation and its publication status.
            </p>
            <section className={`${voucherCard} flex items-center gap-3`}>
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  width={52}
                  height={52}
                  className="h-14 w-14 shrink-0 rounded-control object-cover"
                />
              ) : (
                <Store className="h-7 w-7 text-primary" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="font-semibold">
                  {merchant?.name ?? "Merchant unavailable"}
                </p>
                <p className="mt-1 text-sm text-ink-muted">{location}</p>
              </div>
            </section>
            <section className={voucherCard}>
              <h3 className="mb-5 font-semibold">Allocation breakdown</h3>
              <VoucherFacts
                items={[
                  { label: "Merchant", value: merchant?.name ?? "Unavailable" },
                  { label: "Voucher", value: template?.title ?? "Unavailable" },
                  {
                    label: "Benefit",
                    value:
                      template?.description ||
                      (template?.voucher_type === "percent_off"
                        ? `${template.discount_percent}% off (max KES ${template.maximum_discount_kes})`
                        : `KES ${template?.discount_kes ?? 0} off`),
                  },
                  { label: "Allocated budget", value: money },
                  {
                    label: "Voucher quantity",
                    value: formatNumber(allocation.quantity_cap),
                  },
                  {
                    label: "Eligibility",
                    value:
                      eligibility?.customer_copy ||
                      `Fund country and ${
                        eligibility?.mode ?? "all"
                      } saved rules apply`,
                  },
                  {
                    label: "Claim window",
                    value: `${fundDate(
                      allocation.claim_starts_at
                    )} – ${fundDate(allocation.claim_ends_at)}`,
                  },
                  { label: "Parent fund", value: fund?.name ?? "Unavailable" },
                ]}
              />
              {allocation.state === "draft" && canWrite && (
                <Link
                  href={`${base}/edit`}
                  className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary"
                >
                  Edit allocation
                </Link>
              )}
            </section>
            <section className={voucherCard}>
              <h3 className="mb-3 font-semibold">Validation status</h3>
              {readinessRes.error ? (
                <p role="alert" className="text-sm text-danger">
                  Merchant readiness is unavailable. Publication checks still
                  run on the server.
                </p>
              ) : !readiness.length ? (
                <p className="text-sm text-ink-muted">
                  Merchant readiness has not been reported.
                </p>
              ) : (
                <ul className="space-y-3">
                  {readiness.map((row) => (
                    <li
                      key={row.partner_id}
                      className="flex items-start gap-2 text-sm"
                    >
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          row.ready ? "bg-primary" : "bg-danger"
                        }`}
                      />
                      <span>
                        <span className="font-medium">{row.merchant_name}</span>
                        <span className="mt-1 block text-ink-muted">
                          {row.ready
                            ? "Ready to honor this offer"
                            : row.reason || "Not ready for publication"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 rounded-control bg-[#F2F3FF] p-3 text-sm text-ink-muted">
                Fund status: {fund?.state.replaceAll("_", " ") ?? "Unavailable"}
                . Submit, then publish when ready.
              </p>
            </section>
            <AllocationActions
              fundId={fundId}
              allocationId={allocationId}
              state={allocation.state}
              canWrite={canWrite}
              canApprove={hasPermission(session.role, "voucher_funds.approve")}
              canPublish={hasPermission(session.role, "voucher_funds.publish")}
            />
            <Link
              href={base}
              className="flex min-h-11 items-center justify-center text-sm font-medium text-primary"
            >
              View full allocation details
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
