"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";

export interface IssuedVoucherRow {
  id: string;
  code: string;
  status: string;
  merchant_name: string;
  expires_at: string | null;
  created_at: string;
  revoked_reason: string | null;
}

const STATUS_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive"> = {
  issued: "success",
  redeemed: "secondary",
  expired: "warning",
  revoked: "destructive",
};

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
      {vouchers.map((v) => (
        <div key={v.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm">
          <span className="font-mono text-xs">{v.code}</span>
          <span className="flex-1 text-xs text-slate-500">{v.merchant_name}</span>
          <span className="text-xs text-slate-400">
            {v.status === "revoked" && v.revoked_reason ? v.revoked_reason : `expires ${formatDateTime(v.expires_at)}`}
          </span>
          <Badge variant={STATUS_VARIANT[v.status] ?? "secondary"}>{v.status}</Badge>
          {canRevoke && v.status === "issued" && (
            <Button size="sm" variant="destructive" disabled={busyId === v.id} onClick={() => void revoke(v.id)}>
              Revoke
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
