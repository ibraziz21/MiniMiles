"use client";

import { FormEvent, useState } from "react";
import { CheckCircle, QrCode, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type RedeemResult = {
  txHash?: string;
  discountBps?: number;
  maxValue?: string;
};

function parsePayload(raw: string) {
  const parsed = JSON.parse(raw);
  return {
    type: parsed.type,
    voucherId: String(parsed.voucherId ?? ""),
    owner: String(parsed.owner ?? ""),
    expiresAt: Number(parsed.expiresAt ?? 0),
  };
}

export function ClawVoucherRedeemer() {
  const [payload, setPayload] = useState("");
  const [voucherId, setVoucherId] = useState("");
  const [owner, setOwner] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RedeemResult | null>(null);

  function fillFromPayload() {
    setError(null);
    try {
      const parsed = parsePayload(payload);
      setVoucherId(parsed.voucherId);
      setOwner(parsed.owner);
      setExpiresAt(parsed.expiresAt ? String(parsed.expiresAt) : "");
    } catch {
      setError("Paste the full claw voucher payload JSON from the customer screen.");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    let body: Record<string, unknown>;
    try {
      body = payload.trim()
        ? parsePayload(payload)
        : { type: "claw_voucher", voucherId, owner, expiresAt: Number(expiresAt) };
    } catch {
      setError("Voucher payload is not valid JSON.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/merchant/claw-vouchers/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Voucher redemption failed");
        return;
      }
      setResult(data);
      setPayload("");
      setVoucherId("");
      setOwner("");
      setExpiresAt("");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-[#238D9D22] bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#238D9D11]">
            <QrCode className="h-4 w-4 text-[#238D9D]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Redeem Claw Voucher</p>
            <p className="text-xs text-gray-400">Paste the QR payload or enter the fields manually.</p>
          </div>
        </div>
        <button type="button" onClick={fillFromPayload} className="text-xs font-medium text-[#238D9D] hover:underline">
          Parse payload
        </button>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          placeholder='{"type":"claw_voucher","voucherId":"...","owner":"0x...","expiresAt":...}'
          rows={3}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
        />
        <div className="grid gap-2 md:grid-cols-3">
          <Input value={voucherId} onChange={(e) => setVoucherId(e.target.value)} placeholder="Voucher ID" />
          <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner 0x..." className="font-mono" />
          <Input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} placeholder="Expires at unix" />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {result && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <p className="flex items-center gap-1 font-semibold"><CheckCircle className="h-3.5 w-3.5" /> Voucher redeemed.</p>
            {result.txHash && <p className="mt-1 break-all font-mono">{result.txHash}</p>}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={loading}>{loading ? "Redeeming..." : "Redeem Voucher"}</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setPayload("");
              setVoucherId("");
              setOwner("");
              setExpiresAt("");
              setError(null);
              setResult(null);
            }}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Clear
          </Button>
        </div>
      </form>
    </div>
  );
}
