import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  Search,
  ChevronRight,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { formatDate, formatNumber } from "@/lib/utils";
import {
  loadVoucherCatalogue,
  voucherCodeMatches,
} from "@/lib/voucherCatalogue";
import {
  inVoucherPeriod,
  voucherKind,
  voucherPeriod,
  voucherState,
  voucherBenefit,
} from "@/lib/voucherPresentation";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import {
  voucherCanvas,
  voucherCard,
  VoucherSymbol,
  VoucherStatus,
} from "@/components/vouchers/VoucherUi";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
export default async function VouchersPage({
  searchParams,
}: {
  searchParams: { q?: string; kind?: string; period?: string; page?: string };
}) {
  const session = await requireAdminSession();
  if (!session) redirect("/login");
  const canRead = hasPermission(session.role, "vouchers.read"),
    canFunds = hasPermission(session.role, "voucher_funds.read");
  if (!canRead && !canFunds) redirect("/overview");
  const q = (searchParams.q ?? "").trim().slice(0, 100),
    kind = ["free", "miles", "reimbursable"].includes(searchParams.kind ?? "")
      ? searchParams.kind!
      : "all",
    period = voucherPeriod(searchParams.period);
  let data, matches;
  try {
    [data, matches] = await Promise.all([
      loadVoucherCatalogue(),
      voucherCodeMatches(q),
    ]);
  } catch {
    return (
      <div className={voucherCanvas}>
        <VoucherHeader
          title="Vouchers"
          name={session.name}
          role={session.role}
        />
        <div className="p-4">
          <QueueLoadError title="Couldn’t load vouchers" />
        </div>
      </div>
    );
  }
  const allowed = data.offers.filter((v) =>
    voucherKind(v) === "reimbursable" ? canFunds : canRead
  );
  const ids = new Set(allowed.map((v) => v.id));
  const activity = data.activity.filter((v) => ids.has(v.voucher_template_id));
  const issued = activity.filter(
    (v) =>
      ["issued", "redeemed", "expired", "revoked"].includes(v.status) &&
      inVoucherPeriod(v.created_at, period.from)
  ).length;
  const redeemed = activity.filter(
    (v) =>
      v.status === "redeemed" && inVoucherPeriod(v.redeemed_at, period.from)
  ).length;
  const offers = allowed
    .filter(
      (v) =>
        (kind === "all" || voucherKind(v) === kind) &&
        (!q ||
          `${v.title} ${
            data.merchants.find((m) => m.id === v.partner_id)?.name ?? ""
          }`
            .toLowerCase()
            .includes(q.toLowerCase()) ||
          matches.has(v.id))
    )
    .sort(
      (a, b) =>
        Number(voucherState(b) === "Active") -
        Number(voucherState(a) === "Active")
    );
  const page = Math.max(
    1,
    Math.min(
      Math.ceil(offers.length / 20) || 1,
      Number.isInteger(Number(searchParams.page))
        ? Number(searchParams.page)
        : 1
    )
  );
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (kind !== "all") params.set("kind", kind);
  if (period.key !== "month") params.set("period", period.key);
  if (page > 1) params.set("page", String(page));
  const self = `/vouchers${params.size ? `?${params}` : ""}`;
  const url = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (value === "all" && key === "kind") next.delete(key);
    else next.set(key, value);
    return `/vouchers?${next}`;
  };
  return (
    <div className={voucherCanvas}>
      <VoucherHeader title="Vouchers" name={session.name} role={session.role} />
      <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <form className="flex min-h-11 items-center gap-2 rounded-full bg-[#F2F3FF] px-3 text-sm">
            <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
            <label className="sr-only" htmlFor="voucher-period">
              Reporting period
            </label>
            <select
              id="voucher-period"
              name="period"
              defaultValue={period.key}
              className="min-h-11 min-w-0 bg-transparent text-sm outline-primary"
            >
              <option value="month">This month</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>
            {q && <input type="hidden" name="q" value={q} />}
            <input type="hidden" name="kind" value={kind} />
            <button className="min-h-11 rounded-control px-2 text-xs font-medium text-primary focus-visible:ring-2 focus-visible:ring-primary">
              Apply
            </button>
          </form>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-strong">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Updated now
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            [
              "Active offers",
              allowed.filter((v) => voucherState(v) === "Active").length,
            ],
            ["Issued", issued],
            ["Redeemed", redeemed],
          ].map(([label, value]) => (
            <section
              key={String(label)}
              className="rounded-card bg-white p-3 shadow-sm sm:p-4"
            >
              <h2 className="text-xs text-ink-muted sm:text-sm">{label}</h2>
              <p
                className={`mt-2 flex items-center gap-1 text-xl font-semibold tabular-nums sm:text-2xl ${
                  label === "Redeemed" ? "text-primary-strong" : "text-ink"
                }`}
              >
                {formatNumber(Number(value))}
                {label === "Active offers" && (
                  <CheckCircle2
                    className="h-3.5 w-3.5 text-primary"
                    aria-hidden="true"
                  />
                )}
              </p>
            </section>
          ))}
        </div>
        <form className="flex min-h-12 items-center gap-2 rounded-control bg-white px-3 shadow-sm">
          <button
            aria-label="Search vouchers"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Search className="h-5 w-5 text-ink-muted" />
          </button>
          <label className="sr-only" htmlFor="voucher-search">
            Search merchant, voucher name or code
          </label>
          <input
            id="voucher-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Merchant, voucher name or code…"
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="period" value={period.key} />
        </form>
        <nav
          aria-label="Voucher model"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {[
            ["all", "All"],
            ["free", "Free"],
            ["miles", "Miles"],
            ["reimbursable", "Reimbursable"],
          ]
            .filter(
              ([value]) =>
                value === "all" ||
                (value === "reimbursable" ? canFunds : canRead)
            )
            .map(([value, label]) => (
              <Link
                key={value}
                href={url("kind", value)}
                aria-current={kind === value ? "page" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary ${
                  kind === value
                    ? "bg-[#005C55] text-white"
                    : "bg-[#F2F3FF] text-ink"
                }`}
              >
                {label}
              </Link>
            ))}
        </nav>
        <ul className="space-y-3">
          {offers.slice((page - 1) * 20, page * 20).map((v) => {
            const merchant = data.merchants.find((m) => m.id === v.partner_id),
              k = voucherKind(v),
              end = v.end_at || v.expires_at;
            return (
              <li key={v.id}>
                <Link
                  href={`/vouchers/${v.id}?returnTo=${encodeURIComponent(
                    self
                  )}`}
                  className={`${voucherCard} flex items-start gap-3 hover:bg-[#F2F3FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
                >
                  <VoucherSymbol kind={k} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold">
                        {v.title}
                      </span>
                      <VoucherStatus status={voucherState(v)} />
                    </span>
                    <span className="mt-1 block text-sm text-ink-muted">
                      {merchant?.name ?? "Merchant unavailable"}
                    </span>
                    <span className="mt-2 block text-sm font-medium text-primary-strong">
                      {k === "miles"
                        ? `${formatNumber(v.miles_cost)} Miles`
                        : k === "free"
                        ? voucherBenefit(v) === "Merchant offer"
                          ? "Free offer"
                          : `Free offer (${voucherBenefit(v)})`
                        : `Reimbursable (${voucherBenefit(v)})`}
                    </span>
                    {end && (
                      <span className="mt-1 block text-xs text-ink-muted">
                        {Date.parse(end) <= Date.now() ? "Expired" : "Expires"}{" "}
                        {formatDate(end)}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    className="mt-7 h-4 w-4 shrink-0 text-ink-muted"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
        {!offers.length && (
          <div className={`${voucherCard} text-sm text-ink-muted`}>
            No voucher offers match. Try another search or model.
          </div>
        )}
        <nav
          aria-label="Voucher offer pages"
          className="flex flex-wrap items-center justify-center gap-3 py-2 text-sm text-ink-muted"
        >
          <span>
            Showing {offers.length ? (page - 1) * 20 + 1 : 0}–
            {Math.min(page * 20, offers.length)} of {offers.length} offers
          </span>
          {page > 1 && (
            <Link
              href={url("page", String(page - 1))}
              className="inline-flex min-h-11 items-center px-3 font-medium text-primary"
            >
              Previous
            </Link>
          )}
          {page * 20 < offers.length && (
            <Link
              href={url("page", String(page + 1))}
              className="inline-flex min-h-11 items-center px-3 font-medium text-primary"
            >
              Next
            </Link>
          )}
        </nav>
        <details className={voucherCard}>
          <summary className="min-h-11 cursor-pointer text-sm font-medium focus-visible:outline-primary">
            Voucher tools
          </summary>
          <nav
            aria-label="Voucher tools"
            className="mt-3 grid divide-y divide-[#EAEDFF]"
          >
            {[
              ["/vouchers/issued", "Issued vouchers", canFunds || canRead],
              ["/vouchers/funds", "Reimbursable funds", canFunds],
              ["/vouchers/allocations", "Merchant allocations", canFunds],
              [
                "/vouchers/grants",
                "Issue voucher",
                hasPermission(session.role, "voucher_funds.grant"),
              ],
              ["/vouchers/programs", "Voucher programs", canRead],
              ["/vouchers/pricing", "Miles pricing", canRead],
              [
                "/referrals",
                "Referral rewards",
                hasPermission(session.role, "referrals.read"),
              ],
            ]
              .filter(([, , allowed]) => allowed)
              .map(([path, label]) => (
                <Link
                  key={String(path)}
                  href={String(path)}
                  className="flex min-h-12 items-center justify-between gap-2 text-sm text-primary"
                >
                  {label}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              ))}
          </nav>
        </details>
      </div>
    </div>
  );
}
