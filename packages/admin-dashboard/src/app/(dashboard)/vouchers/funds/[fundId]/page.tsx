import { fundDate, fundMoney } from "@/lib/voucherFundNavigation";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarDays, Wallet, Plus, Store, ChevronRight } from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { voucherReadAll } from "@/lib/voucherCatalogue";
import { fundReturnPath } from "@/lib/voucherFundNavigation";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import {
  voucherCanvas,
  voucherCard,
  VoucherStatus,
  VoucherFacts,
} from "@/components/vouchers/VoucherUi";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
import { FundActions } from "@/components/vouchers/FundActions";
export default async function VoucherFundDetailPage({
  params,
  searchParams,
}: {
  params: { fundId: string };
  searchParams: { returnTo?: string };
}) {
  const session = await requireAdminSession("voucher_funds.read");
  if (!session) redirect("/login");
  const { fundId } = params;
  const back = fundReturnPath(searchParams.returnTo);
  const header = (
    <VoucherHeader
      title="Fund Detail"
      backHref={back}
      name={session.name}
      role={session.role}
    />
  );
  const fail = () => (
    <div className={voucherCanvas}>
      {header}
      <div className="p-4">
        <QueueLoadError title="Couldn’t load fund" />
      </div>
    </div>
  );
  const fundRes = await supabase
    .from("voucher_funding_programs")
    .select("*")
    .eq("id", fundId)
    .maybeSingle();
  if (fundRes.error) return fail();
  if (!fundRes.data) notFound();
  const fund = fundRes.data;
  const [budgetRes, allocationsRes, rulesRes] = await Promise.all([
    supabase
      .from("v_voucher_funding_program_budget")
      .select("*")
      .eq("program_id", fundId)
      .maybeSingle(),
    voucherReadAll((from, to) =>
      supabase
        .from("voucher_funding_allocations")
        .select(
          "id,state,merchant_id,authorized_budget_minor,quantity_cap,partners!voucher_funding_allocations_merchant_id_fkey(name),spend_voucher_templates!voucher_funding_allocations_voucher_template_id_fkey(title)"
        )
        .eq("program_id", fundId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    )
      .then((data) => ({ data, error: null }))
      .catch(() => ({ data: [], error: true })),
    supabase
      .from("voucher_eligibility_rule_sets")
      .select("id,version,mode,customer_copy")
      .eq("program_id", fundId)
      .order("version", { ascending: false }),
  ]);
  if (allocationsRes.error) return fail();
  const budget = budgetRes.data,
    allocations = allocationsRes.data,
    percent =
      budget && fund.authorized_budget_minor > 0
        ? Math.min(
            100,
            Math.max(
              0,
              Math.round(
                (Number(budget.committed_minor) /
                  Number(fund.authorized_budget_minor)) *
                  100
              )
            )
          )
        : null;
  const canWrite = hasPermission(session.role, "voucher_funds.write"),
    canAdd =
      canWrite &&
      ["approved", "scheduled", "active", "paused"].includes(fund.state);
  const money = (minor: number) => fundMoney(minor, fund.currency);
  return (
    <div className={voucherCanvas}>
      {header}
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <VoucherStatus status={fund.state} />
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
            {fundDate(fund.starts_at)} – {fundDate(fund.ends_at)}
          </p>
        </div>
        <h2 className="text-3xl font-semibold leading-tight tracking-tight">
          {fund.name}
        </h2>
        {typeof fund.metadata?.notes === "string" && fund.metadata.notes && (
          <p className="text-sm leading-6 text-ink-muted">
            {fund.metadata.notes}
          </p>
        )}
        <section className="rounded-card bg-[#F2F3FF] p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-ink-muted">
              Total fund budget
            </h3>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EAEDFF] text-primary">
              <Wallet className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-2 break-words text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
            {money(fund.authorized_budget_minor)}
          </p>
          {percent != null && (
            <progress
              aria-label="Fund budget committed"
              value={percent}
              max={100}
              className="mt-5 h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-[#DAE2FD] [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
            />
          )}
          <dl className="mt-5 grid grid-cols-2 gap-3">
            {[
              [
                "Committed",
                budget ? money(budget.committed_minor) : "Unavailable",
                percent != null ? `${percent}% committed` : null,
              ],
              [
                "Available",
                budget ? money(budget.available_budget_minor) : "Unavailable",
                percent != null
                  ? `${Math.round(
                      (Number(budget.available_budget_minor) /
                        Number(fund.authorized_budget_minor)) *
                        100
                    )}% remaining`
                  : null,
              ],
            ].map(([label, value, description]) => (
              <div
                key={label}
                className="rounded-control bg-white p-3 shadow-sm"
              >
                <dt className="text-sm text-ink-muted">{label}</dt>
                <dd
                  className={`mt-2 break-words text-lg font-semibold tabular-nums ${
                    label === "Available" ? "text-primary-strong" : ""
                  }`}
                >
                  {value}
                  {description && (
                    <span className="mt-1 block text-xs font-normal text-ink-muted">
                      {description}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {(!budget || budgetRes.error) && (
            <p role="alert" className="mt-3 text-sm text-ink-muted">
              Budget availability could not be loaded.
            </p>
          )}
        </section>
        {canAdd && (
          <Link
            href={`/vouchers/funds/${fund.id}/allocations/new`}
            className="flex min-h-12 items-center justify-center gap-2 rounded-control bg-[#005C55] px-4 text-base font-medium text-white focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
            Add allocation
          </Link>
        )}
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold">Merchant allocations</h3>
          <span className="rounded-full bg-[#DAE2FD] px-2 py-0.5 text-sm">
            {allocations.length}
          </span>
        </div>
        <ul className="space-y-3">
          {allocations.map((allocation) => {
            const merchant = allocation.partners as unknown as {
              name: string;
            } | null;
            return (
              <li key={allocation.id}>
                <Link
                  href={`/vouchers/funds/${fund.id}/allocations/${allocation.id}/review`}
                  className={`${voucherCard} flex items-center gap-3 focus-visible:ring-2 focus-visible:ring-primary`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-[#EAEDFF] text-primary">
                    <Store className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold">
                      {merchant?.name ?? "Merchant unavailable"}
                    </span>
                    <span className="mt-1 block text-sm text-ink-muted">
                      Allocated ·{" "}
                      <span className="font-medium text-ink">
                        {money(allocation.authorized_budget_minor)}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-2">
                    <VoucherStatus status={allocation.state} />
                    <ChevronRight
                      className="h-4 w-4 text-ink-muted"
                      aria-hidden="true"
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {!allocations.length && (
          <div className={`${voucherCard} text-sm text-ink-muted`}>
            {canAdd
              ? "No merchant allocations yet."
              : "Publish the fund before adding merchant allocations."}
          </div>
        )}
        <details className={voucherCard}>
          <summary className="min-h-11 cursor-pointer font-medium focus-visible:outline-primary">
            Fund details & actions
          </summary>
          <div className="mt-3 space-y-5">
            <VoucherFacts
              items={[
                {
                  label: "Sponsorship",
                  value: fund.sponsorship_label || "Funded by Akiba",
                },
                { label: "Country", value: fund.country_code },
                {
                  label: "Cost center",
                  value: fund.cost_center_reference || "Not supplied",
                },
                {
                  label: "Publication revision",
                  value: String(fund.approval_revision),
                },
              ]}
            />
            <FundActions
              fundId={fund.id}
              state={fund.state}
              approvalRevision={fund.approval_revision}
              version={fund.version}
              startsAt={fund.starts_at}
              endsAt={fund.ends_at}
              canWrite={canWrite}
              canApprove={hasPermission(session.role, "voucher_funds.approve")}
              canPublish={hasPermission(session.role, "voucher_funds.publish")}
            />
            <Link
              href={`/vouchers/issued?fund=${fund.id}`}
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary"
            >
              Issued vouchers
            </Link>
            <div>
              <h4 className="text-sm font-medium">Eligibility rule sets</h4>
              {rulesRes.error ? (
                <p role="alert" className="mt-2 text-sm text-ink-muted">
                  Eligibility rules could not be loaded.
                </p>
              ) : (
                (rulesRes.data ?? []).map((rule) => (
                  <p key={rule.id} className="mt-2 text-sm text-ink-muted">
                    v{rule.version} ·{" "}
                    {rule.customer_copy || `Match ${rule.mode}`}
                  </p>
                ))
              )}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
