import { fundDate, fundMoney } from "@/lib/voucherFundNavigation";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ChevronRight, Plus } from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { voucherReadAll } from "@/lib/voucherCatalogue";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import {
  voucherCanvas,
  voucherCard,
  VoucherStatus,
} from "@/components/vouchers/VoucherUi";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
export default async function VoucherFundsPage({
  searchParams,
}: {
  searchParams: { state?: string };
}) {
  const session = await requireAdminSession("voucher_funds.read");
  if (!session) redirect("/login");
  const state = ["active", "draft", "ended"].includes(searchParams.state ?? "")
    ? searchParams.state!
    : "all";
  let funds, budgets;
  try {
    [funds, budgets] = await Promise.all([
      voucherReadAll((from, to) =>
        supabase
          .from("voucher_funding_programs")
          .select(
            "id,name,sponsorship_label,country_code,currency,authorized_budget_minor,state,starts_at,ends_at,created_at"
          )
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to)
      ),
      voucherReadAll((from, to) =>
        supabase
          .from("v_voucher_funding_program_budget")
          .select("program_id,available_budget_minor,committed_minor")
          .order("program_id")
          .range(from, to)
      ),
    ]);
  } catch {
    return (
      <div className={voucherCanvas}>
        <VoucherHeader
          title="Voucher Funds"
          backHref="/vouchers"
          name={session.name}
          role={session.role}
        />
        <div className="p-4">
          <QueueLoadError title="Couldn’t load voucher funds" />
        </div>
      </div>
    );
  }
  const matches = (value: string, fundState: string) =>
    value === "all" ||
    (value === "ended"
      ? ["ended", "cancelled"].includes(fundState)
      : fundState === value);
  const visible = funds.filter((f) => matches(state, f.state));
  const self = `/vouchers/funds${state !== "all" ? `?state=${state}` : ""}`;
  return (
    <div className={voucherCanvas}>
      <VoucherHeader
        title="Voucher Funds"
        backHref="/vouchers"
        name={session.name}
        role={session.role}
      />
      <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">
            Voucher funds
          </h2>
          {hasPermission(session.role, "voucher_funds.write") && (
            <Link
              href="/vouchers/funds/new"
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-4 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New fund
            </Link>
          )}
        </div>
        <nav
          aria-label="Fund state"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {[
            ["all", "All"],
            ["active", "Active"],
            ["draft", "Draft"],
            ["ended", "Ended"],
          ].map(([value, label]) => (
            <Link
              key={value}
              href={`/vouchers/funds${
                value !== "all" ? `?state=${value}` : ""
              }`}
              aria-current={state === value ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm ${
                state === value
                  ? "bg-primary text-white"
                  : "bg-[#EAEDFF] text-ink"
              }`}
            >
              {label}
              <span
                className={`rounded-full px-1.5 text-xs ${
                  state === value ? "bg-white/20" : "bg-[#DAE2FD]"
                }`}
              >
                {funds.filter((f) => matches(value, f.state)).length}
              </span>
            </Link>
          ))}
        </nav>
        <ul className="space-y-3">
          {visible.map((f) => {
            const budget = budgets.find((b) => b.program_id === f.id);
            return (
              <li key={f.id}>
                <Link
                  href={`/vouchers/funds/${f.id}?returnTo=${encodeURIComponent(
                    self
                  )}`}
                  className={`${voucherCard} block space-y-5 focus-visible:ring-2 focus-visible:ring-primary`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-primary-strong">
                        {f.sponsorship_label || "Funded by Akiba"}
                      </p>
                      <h3 className="mt-1 break-words text-lg font-semibold leading-snug">
                        {f.name}
                      </h3>
                    </div>
                    <VoucherStatus status={f.state} />
                  </div>
                  <dl className="grid grid-cols-2 gap-3">
                    <div>
                      <dt className="text-xs text-ink-muted">
                        Available balance
                      </dt>
                      <dd className="mt-1 break-words text-base font-semibold tabular-nums min-[375px]:text-lg sm:text-xl">
                        {budget
                          ? fundMoney(budget.available_budget_minor, f.currency)
                          : "Unavailable"}
                      </dd>
                    </div>
                    <div className="text-right">
                      <dt className="text-xs text-ink-muted">
                        Authorized pool
                      </dt>
                      <dd className="mt-1 break-words text-sm tabular-nums">
                        {fundMoney(f.authorized_budget_minor, f.currency)}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-xs text-ink-muted">
                      <CalendarDays
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      {fundDate(f.starts_at)} – {fundDate(f.ends_at)}
                    </p>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAEDFF]">
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        {!visible.length && (
          <div className={`${voucherCard} text-sm text-ink-muted`}>
            No funds in this view.
          </div>
        )}
      </div>
    </div>
  );
}
