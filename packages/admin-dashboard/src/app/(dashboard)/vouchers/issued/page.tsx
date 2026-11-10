import { getVoucherMemberDetails } from "@/lib/voucherMemberDetails";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Search } from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { loadVoucherCatalogue, voucherReadAll } from "@/lib/voucherCatalogue";
import {
  voucherKind,
  voucherReturnPath,
  voucherDateTime,
} from "@/lib/voucherPresentation";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import {
  voucherCanvas,
  voucherCard,
  VoucherStatus,
} from "@/components/vouchers/VoucherUi";
import { QueueLoadError } from "@/components/queue/QueueLoadError";
export default async function IssuedVouchersPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const session = await requireAdminSession();
  if (!session) redirect("/login");
  const canRead = hasPermission(session.role, "vouchers.read"),
    canFunds = hasPermission(session.role, "voucher_funds.read");
  if (!canRead && !canFunds) redirect("/overview");
  const back = voucherReturnPath(searchParams.returnTo),
    header = (
      <VoucherHeader
        title="Issued Vouchers"
        backHref={back}
        name={session.name}
        role={session.role}
      />
    );
  let catalog, allocations;
  let rows: Array<{
    id: string;
    voucher_template_id: string;
    code: string;
    status: string;
    created_at: string;
    expires_at: string | null;
    username_at_claim: string | null;
    funding_allocation_id: string | null;
  }>;
  try {
    catalog = await loadVoucherCatalogue();
    const ids = catalog.offers
      .filter(
        (o) =>
          (voucherKind(o) === "reimbursable" ? canFunds : canRead) &&
          (!searchParams.template || o.id === searchParams.template)
      )
      .map((o) => o.id);
    rows = (
      await Promise.all(
        Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
          voucherReadAll((from, to) =>
            supabase
              .from("issued_vouchers")
              .select(
                "id,voucher_template_id,code,status,created_at,expires_at,username_at_claim,funding_allocation_id"
              )
              .in("voucher_template_id", ids.slice(i * 100, i * 100 + 100))
              .in("status", ["issued", "redeemed", "expired", "revoked"])
              .order("created_at", { ascending: false })
              .order("id")
              .range(from, to)
          )
        )
      )
    ).flat();
    allocations = canFunds
      ? await voucherReadAll((from, to) =>
          supabase
            .from("voucher_funding_allocations")
            .select("id,program_id")
            .order("id")
            .range(from, to)
        )
      : [];
  } catch {
    return (
      <div className={voucherCanvas}>
        {header}
        <div className="p-4">
          <QueueLoadError title="Couldn’t load issued vouchers" />
        </div>
      </div>
    );
  }
  const memberLookups = await Promise.all(
    Array.from({ length: Math.ceil(rows.length / 100) }, (_, i) =>
      getVoucherMemberDetails(
        rows.slice(i * 100, i * 100 + 100).map((row) => row.id)
      )
    )
  );
  const memberMap = new Map(
    memberLookups.flatMap((map) => Array.from(map.entries()))
  );
  rows = rows.map((row) => ({
    ...row,
    username_at_claim: memberMap.get(row.id)?.username || row.username_at_claim,
  }));
  const q = (searchParams.q ?? "").trim().toLowerCase(),
    recipient = (searchParams.recipient ?? "").replace(/^@/, "").toLowerCase();
  const visible = rows
    .filter((v) => {
      const offer = catalog.offers.find((o) => o.id === v.voucher_template_id);
      return (
        (!searchParams.status || v.status === searchParams.status) &&
        (!searchParams.allocation ||
          v.funding_allocation_id === searchParams.allocation) &&
        (!searchParams.fund ||
          allocations.find((a) => a.id === v.funding_allocation_id)
            ?.program_id === searchParams.fund) &&
        (!searchParams.merchant ||
          offer?.partner_id === searchParams.merchant) &&
        (!recipient ||
          v.username_at_claim?.toLowerCase().includes(recipient)) &&
        (!q ||
          `${v.code} ${v.username_at_claim ?? ""} ${offer?.title ?? ""}`
            .toLowerCase()
            .includes(q))
      );
    })
    .sort(
      (a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at) ||
        a.id.localeCompare(b.id)
    );
  const page = Math.max(
    1,
    Math.min(
      Math.ceil(visible.length / 25) || 1,
      Number.isInteger(Number(searchParams.page))
        ? Number(searchParams.page)
        : 1
    )
  );
  const params = new URLSearchParams();
  for (const key of [
    "template",
    "fund",
    "allocation",
    "merchant",
    "status",
    "recipient",
    "q",
    "returnTo",
  ]) {
    if (searchParams[key]) params.set(key, searchParams[key]!);
  }
  if (page > 1) params.set("page", String(page));
  const self = `/vouchers/issued${params.size ? `?${params}` : ""}`;
  const url = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (value) next.set(key, value);
    else next.delete(key);
    return `/vouchers/issued?${next}`;
  };
  return (
    <div className={voucherCanvas}>
      {header}
      <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        {searchParams.template && (
          <p className="text-lg font-semibold">
            {catalog.offers.find((o) => o.id === searchParams.template)
              ?.title ?? "Selected offer"}
          </p>
        )}
        <form className="flex items-center gap-2 rounded-control bg-white px-3 shadow-sm">
          <label htmlFor="issued-search" className="sr-only">
            Search issued vouchers
          </label>
          <input
            id="issued-search"
            name="q"
            defaultValue={searchParams.q ?? ""}
            placeholder="Code, voucher or member…"
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-primary"
          />
          {Array.from(params.entries())
            .filter(([key]) => key !== "q" && key !== "page")
            .map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
          <button
            aria-label="Search issued vouchers"
            className="flex h-11 w-11 items-center justify-center rounded-control focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Search className="h-5 w-5" />
          </button>
        </form>
        <nav
          aria-label="Issued voucher status"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {["", "issued", "redeemed", "expired", "revoked"].map((status) => (
            <Link
              key={status}
              href={url("status", status)}
              aria-current={
                (searchParams.status ?? "") === status ? "page" : undefined
              }
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm capitalize ${
                (searchParams.status ?? "") === status
                  ? "bg-primary text-white"
                  : "bg-[#F2F3FF]"
              }`}
            >
              {status || "All"}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-ink-muted">{visible.length} vouchers</p>
        <ul className="space-y-3">
          {visible.slice((page - 1) * 25, page * 25).map((v) => {
            const offer = catalog.offers.find(
                (o) => o.id === v.voucher_template_id
              ),
              merchant = catalog.merchants.find(
                (m) => m.id === offer?.partner_id
              );
            return (
              <li key={v.id}>
                <Link
                  href={`/vouchers/issued/${v.id}?returnTo=${encodeURIComponent(
                    self
                  )}`}
                  className={`${voucherCard} flex items-center gap-3 focus-visible:ring-2 focus-visible:ring-primary`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {offer?.title ?? "Voucher"}
                    </span>
                    <span className="mt-1 block text-sm text-ink-muted">
                      {merchant?.name ?? "Merchant unavailable"}
                    </span>
                    <span className="mt-2 block break-all font-mono text-xs font-medium">
                      {v.code}
                    </span>
                    <span className="mt-1 block text-xs text-ink-muted">
                      {voucherDateTime(v.created_at)}
                    </span>
                  </span>
                  <VoucherStatus status={v.status} />
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-ink-muted"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
        {!visible.length && (
          <div className={`${voucherCard} text-sm text-ink-muted`}>
            No issued vouchers match these filters.
          </div>
        )}
        <nav
          aria-label="Issued voucher pages"
          className="flex flex-wrap justify-center gap-3 text-sm"
        >
          {page > 1 && (
            <Link
              href={url("page", String(page - 1))}
              className="inline-flex min-h-11 items-center px-3 text-primary"
            >
              Previous
            </Link>
          )}
          <span className="inline-flex min-h-11 items-center text-ink-muted">
            Page {page} of {Math.ceil(visible.length / 25) || 1}
          </span>
          {page * 25 < visible.length && (
            <Link
              href={url("page", String(page + 1))}
              className="inline-flex min-h-11 items-center px-3 text-primary"
            >
              Next
            </Link>
          )}
        </nav>
        {(searchParams.fund ||
          searchParams.allocation ||
          searchParams.merchant ||
          searchParams.recipient ||
          searchParams.q) && (
          <Link
            href={`/vouchers/issued${
              searchParams.template ? `?template=${searchParams.template}` : ""
            }`}
            className="inline-flex min-h-11 items-center text-sm text-primary"
          >
            Clear filters
          </Link>
        )}
      </div>
    </div>
  );
}
