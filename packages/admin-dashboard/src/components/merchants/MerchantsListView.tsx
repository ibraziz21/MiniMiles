"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RemoveMerchantControl } from "./RemoveMerchantControl";
import { Store, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber } from "@/lib/utils";

export interface MerchantRow {
  id: string;
  status: string;
  name: string;
  country: string | null;
  image_url: string | null;
  subscription: { plan: string; status: string } | null;
  voucher_types: number;
  active_voucher_types: number;
  team_count: number;
}

function SubscriptionBadge({ subscription }: { subscription: MerchantRow["subscription"] }) {
  if (!subscription) return <Badge variant="outline">No subscription</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="capitalize text-ink-muted">{subscription.plan}</span>
      <Badge variant={subscription.status === "active" ? "success" : subscription.status === "suspended" ? "destructive" : "secondary"}>
        {subscription.status.replaceAll("_", " ")}
      </Badge>
    </div>
  );
}

function MerchantAvatar({ merchant }: { merchant: MerchantRow }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-surface-subtle">
      {merchant.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={merchant.image_url} alt="" className="h-9 w-9 rounded-control object-cover" />
      ) : (
        <Store className="h-4 w-4 text-ink-muted" aria-hidden="true" />
      )}
    </div>
  );
}

export function MerchantsListView({ merchants, canManage = false }: { merchants: MerchantRow[]; canManage?: boolean }) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState("current");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return merchants.filter((m) =>
      (view === "archived" ? m.status === "archived" : m.status !== "archived")
      && (!q || m.name.toLowerCase().includes(q) || m.country?.toLowerCase().includes(q)),
    );
  }, [merchants, search, view]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search merchants…"
          aria-label="Search merchants"
          className="h-10 w-full rounded-control border border-border bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">Show
        <select className="min-h-[44px] rounded-control border border-border bg-surface px-3" value={view} onChange={(e) => setView(e.target.value)}>
          <option value="current">Current merchants</option>
          <option value="archived">Archived merchants</option>
        </select>
      </label>

      {filtered.length === 0 ? (
        <EmptyState message="No merchants match these filters. Try another search or merchant view." isHealthy={false} />
      ) : (
        <>
          {/* Mobile: cards, single primary action (spec §10.3) */}
          <div className="space-y-3 lg:hidden">
            {filtered.map((m) => (
              <div key={m.id} className="rounded-card border border-border bg-surface">
              <Link
                href={`/merchants/${m.id}`}
                className="flex items-center gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <MerchantAvatar merchant={m} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{m.name}</p>
                  <p className="text-xs text-ink-muted">{m.country ?? "—"}</p>
                  <div className="mt-1">
                    <SubscriptionBadge subscription={m.subscription} />
                  </div>
                </div>
              </Link>
              {canManage && m.status !== "archived" ? <div className="px-4 pb-4"><RemoveMerchantControl id={m.id} name={m.name} /></div> : null}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-card border border-border bg-surface lg:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                    <th className="px-4 py-3 text-left">Merchant</th>
                    <th className="px-4 py-3 text-left">Subscription</th>
                    <th className="px-4 py-3 text-right">Voucher Types</th>
                    <th className="px-4 py-3 text-right">Active</th>
                    <th className="px-4 py-3 text-right">Team</th>
                    {canManage ? <th className="px-4 py-3 text-right">Actions</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((m) => (
                    <tr key={m.id} className="transition-colors hover:bg-surface-subtle">
                      <td className="px-4 py-3">
                        <Link href={`/merchants/${m.id}`} className="flex items-center gap-2 font-medium text-ink hover:text-primary">
                          <MerchantAvatar merchant={m} />
                          <span>{m.name}</span>
                        </Link>
                        <p className="mt-0.5 pl-11 text-xs text-ink-muted">{m.country ?? "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <SubscriptionBadge subscription={m.subscription} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-muted">{formatNumber(m.voucher_types)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-muted">{formatNumber(m.active_voucher_types)}</td>
                      <td className="px-4 py-3 text-right text-ink-muted">{m.team_count}</td>
                      {canManage ? <td className="px-4 py-3 text-right">{m.status !== "archived" ? <RemoveMerchantControl id={m.id} name={m.name} /> : <Badge variant="secondary">Archived</Badge>}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
