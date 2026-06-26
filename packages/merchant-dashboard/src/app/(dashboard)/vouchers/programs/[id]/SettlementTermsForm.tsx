"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SettlementTermsForm({
  programId,
  initial,
}: {
  programId: string;
  initial: {
    funding_party_type: "merchant" | "sponsor" | "none";
    funding_party_reference: string | null;
    reimbursement_rate: number;
  };
}) {
  const router = useRouter();
  const [type, setType] = useState(initial.funding_party_type);
  const [reference, setReference] = useState(initial.funding_party_reference ?? "");
  const [rate, setRate] = useState(String(initial.reimbursement_rate));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true); setMessage(null);
    const response = await fetch(`/api/programs/${programId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        funding_party_type: type,
        funding_party_reference: type === "sponsor" ? reference.trim() : null,
        settlement_currency: "cUSD",
        reimbursement_rate: type === "none" ? 0 : Number(rate),
      }),
    });
    const body = await response.json();
    setMessage(response.ok ? "Settlement terms saved." : body.error ?? "Save failed");
    if (response.ok) router.refresh();
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      <select className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" value={type}
        onChange={(e) => setType(e.target.value as typeof type)}>
        <option value="merchant">Merchant funded</option>
        <option value="sponsor">Sponsor funded</option>
        <option value="none">No reimbursement</option>
      </select>
      {type === "sponsor" && (
        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Sponsor reference" />
      )}
      {type !== "none" && (
        <Input type="number" min="0" max="1" step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} />
      )}
      <Button size="sm" disabled={saving || (type === "sponsor" && !reference.trim())} onClick={() => void save()}>
        {saving ? "Saving…" : "Save settlement terms"}
      </Button>
      {message && <p className="text-xs text-gray-500">{message}</p>}
    </div>
  );
}
