"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber } from "@/lib/utils";

export interface IssuedVoucherRow {
  id: string;
  code: string;
  status: string;
  merchant_name: string;
  expires_at: string | null;
  created_at: string;
  revoked_reason: string | null;
  username: string | null;
  account_created_at: string | null;
  account_age_days: number | null;
  country: string | null;
  spend_miles_earned: number;
}

const STATUS_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive"> = {
  issued: "success",
  redeemed: "secondary",
  expired: "warning",
  revoked: "destructive",
};

function formatAccountAge(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "Today";
  if (days < 30) return `${days}d`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  return remainingMonths > 0 ? `${years}y ${remainingMonths}mo` : `${years}y`;
}

// Danger zone: revoke a specific voucher with a required reason (§10). Restricted
// to fraud/error/legal cases — the RPC itself refuses once the voucher redeemed.
export function IssuedVouchersPanel({ fundId, vouchers, canRevoke }: { fundId: string; vouchers: IssuedVoucherRow[]; canRevoke: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(voucherId: string) {
    const reason = prompt("Reason for revoking this voucher (required, fraud/error/legal cases only)");
    if (!reason) return;
    setBusyId(voucherId);
    setError(null);
    const res = await fetch(`/api/admin/voucher-funds/${fundId}/vouchers/${voucherId}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const result = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(result.error ?? "Failed to revoke voucher.");
      return;
    }
    router.refresh();
  }

  if (vouchers.length === 0) {
    return <p className="text-sm text-slate-400">No vouchers issued yet.</p>;
  }

  return (
    <div className="space-y-2">
      {error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[980px] w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Voucher</th>
              <th className="px-3 py-2.5">Member</th>
              <th className="px-3 py-2.5">Account age</th>
              <th className="px-3 py-2.5">Country</th>
              <th className="px-3 py-2.5 text-right">Spend-earned AkibaMiles</th>
              <th className="px-3 py-2.5">Validity</th>
              <th className="px-3 py-2.5">Status</th>
              {canRevoke && <th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {vouchers.map((v) => (
              <tr key={v.id} className="align-middle hover:bg-slate-50/70">
                <td className="px-3 py-3">
                  <p className="font-mono text-xs font-medium text-slate-800">{v.code}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{v.merchant_name}</p>
                </td>
                <td className="px-3 py-3">
                  <p className="font-medium text-slate-900">{v.username ? `@${v.username}` : "No username"}</p>
                  <p className="mt-0.5 text-xs text-slate-400">Issued {formatDateTime(v.created_at)}</p>
                </td>
                <td className="px-3 py-3 text-slate-700" title={v.account_created_at ? `Joined ${formatDateTime(v.account_created_at)}` : undefined}>
                  {formatAccountAge(v.account_age_days)}
                </td>
                <td className="px-3 py-3 text-slate-700">{v.country ?? "—"}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">
                  {formatNumber(v.spend_miles_earned)}
                </td>
                <td className="px-3 py-3 text-xs text-slate-500">
                  {v.status === "revoked" && v.revoked_reason
                    ? v.revoked_reason
                    : v.expires_at
                      ? `Expires ${formatDateTime(v.expires_at)}`
                      : "No expiry"}
                </td>
                <td className="px-3 py-3">
                  <Badge variant={STATUS_VARIANT[v.status] ?? "secondary"}>{v.status}</Badge>
                </td>
                {canRevoke && (
                  <td className="px-3 py-3 text-right">
                    {v.status === "issued" && (
                      <Button size="sm" variant="destructive" disabled={busyId === v.id} onClick={() => void revoke(v.id)}>
                        Revoke
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
