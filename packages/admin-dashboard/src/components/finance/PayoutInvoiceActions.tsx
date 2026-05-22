"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  invoiceId: string;
  defaultPaymentMethod: string;
};

export function PayoutInvoiceActions({ invoiceId, defaultPaymentMethod }: Props) {
  const router = useRouter();
  const [paymentMethod, setPaymentMethod] = useState(defaultPaymentMethod || "manual");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentTxHash, setPaymentTxHash] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState<"paid" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(status: "paid" | "rejected") {
    setLoading(status);
    setError(null);

    try {
      const res = await fetch(`/api/admin/payout-invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          payment_method: paymentMethod,
          payment_reference: paymentReference,
          payment_tx_hash: paymentTxHash,
          akiba_notes: notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update payout");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="grid gap-2 md:grid-cols-4">
        <select
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
        >
          <option value="wallet">Wallet</option>
          <option value="bank">Bank</option>
          <option value="mpesa">M-Pesa</option>
          <option value="manual">Manual</option>
        </select>
        <Input
          value={paymentReference}
          onChange={(e) => setPaymentReference(e.target.value)}
          placeholder="Payment reference"
        />
        <Input
          value={paymentTxHash}
          onChange={(e) => setPaymentTxHash(e.target.value)}
          placeholder="0x tx hash if on-chain"
          className="font-mono"
        />
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Merchant note"
        />
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => resolve("paid")} disabled={!!loading} className="gap-1.5">
          <CheckCircle className="h-3.5 w-3.5" />
          {loading === "paid" ? "Saving..." : "Mark Paid"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => resolve("rejected")} disabled={!!loading} className="gap-1.5">
          <XCircle className="h-3.5 w-3.5" />
          {loading === "rejected" ? "Saving..." : "Reject"}
        </Button>
      </div>
    </div>
  );
}
