"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Data = {
  balances: Array<{ partner_id: string; currency: string; pending_amount: number; batched_amount: number; paid_amount: number }>;
  unbatched: Array<{ id: string; merchant_id: string; payable_amount: number; currency: string; created_at: string }>;
  batches: Array<{ id: string; partner_id: string; state: string; item_count: number; total_payable_amount: number; currency: string; payment_reference: string | null; failure_reason: string | null }>;
  incidents: Array<{ id: string; type: string; created_at: string }>;
};

export default function SettlementOperations({ canWrite }: { canWrite: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/settlements", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

  const selectedPartner = useMemo(() => {
    const partners = new Set((data?.unbatched ?? []).filter((e) => selected.includes(e.id)).map((e) => e.merchant_id));
    return partners.size === 1 ? [...partners][0] : null;
  }, [data, selected]);

  async function mutate(body: Record<string, unknown>) {
    setBusy(true); setMessage(null);
    const res = await fetch("/api/admin/settlements", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await res.json();
    setMessage(res.ok ? "Saved" : result.error ?? "Operation failed");
    if (res.ok) { setSelected([]); await load(); }
    setBusy(false);
  }

  if (!data) return <div className="p-6 text-sm text-slate-500">Loading settlements…</div>;
  return (
    <div className="space-y-6 p-6">
      {message && <p className="rounded-md bg-slate-100 p-3 text-sm">{message}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        {data.balances.map((row) => (
          <Card key={`${row.partner_id}:${row.currency}`}>
            <CardHeader><CardTitle className="text-sm">{row.partner_id}</CardTitle></CardHeader>
            <CardContent className="text-sm">
              <p>Pending: ${Number(row.pending_amount).toFixed(2)}</p>
              <p>In settlement: ${Number(row.batched_amount).toFixed(2)}</p>
              <p>Paid: ${Number(row.paid_amount).toFixed(2)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Unbatched payables</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.unbatched.map((entry) => (
            <label key={entry.id} className="flex items-center gap-3 rounded border p-3 text-sm">
              <input type="checkbox" checked={selected.includes(entry.id)}
                onChange={(e) => setSelected((old) => e.target.checked ? [...old, entry.id] : old.filter((id) => id !== entry.id))} />
              <span className="flex-1">{entry.merchant_id}</span>
              <span>${Number(entry.payable_amount).toFixed(2)} {entry.currency}</span>
            </label>
          ))}
          {canWrite && selected.length > 0 && (
            <Button disabled={busy || !selectedPartner} onClick={() => void mutate({
              action: "create_batch", partner_id: selectedPartner, entry_ids: selected, currency: "cUSD",
            })}>Create batch</Button>
          )}
          {selected.length > 0 && !selectedPartner && <p className="text-xs text-red-600">Select entries for one partner only.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Batch operations</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.batches.map((batch) => <BatchRow key={batch.id} batch={batch} canWrite={canWrite} busy={busy} mutate={mutate} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Reconciliation incidents</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.incidents.map((incident) => (
            <div key={incident.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
              <span className="flex-1">{incident.type} · {new Date(incident.created_at).toLocaleString()}</span>
              {canWrite && <Button variant="outline" disabled={busy} onClick={() => {
                const notes = prompt("Resolution notes");
                if (notes) void mutate({ action: "resolve_incident", incident_id: incident.id, notes });
              }}>Resolve</Button>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function BatchRow({ batch, canWrite, busy, mutate }: {
  batch: Data["batches"][number]; canWrite: boolean; busy: boolean;
  mutate: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const next = batch.state === "draft" ? "approved" : batch.state === "approved" ? "processing" : batch.state === "failed" ? "processing" : null;
  return (
    <div className="rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs">{batch.id}</span>
        <span className="capitalize">{batch.state}</span>
        <span>{batch.item_count} items</span>
        <span className="font-semibold">${Number(batch.total_payable_amount).toFixed(2)}</span>
      </div>
      {batch.payment_reference && <p className="mt-1 text-xs">Payment: {batch.payment_reference}</p>}
      {batch.failure_reason && <p className="mt-1 text-xs text-red-600">{batch.failure_reason}</p>}
      {canWrite && <div className="mt-3 flex flex-wrap gap-2">
        {next && <Button disabled={busy} onClick={() => void mutate({ action: "transition", batch_id: batch.id, state: next })}>{next}</Button>}
        {["draft","approved"].includes(batch.state) && <Button variant="outline" disabled={busy} onClick={() => void mutate({ action: "transition", batch_id: batch.id, state: "cancelled" })}>cancel</Button>}
        {batch.state === "processing" && <>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Payment reference" className="w-56" />
          <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Payment evidence / confirmation note" className="w-72" />
          <Button disabled={busy || !reference.trim() || !evidence.trim()} onClick={() => void mutate({
            action: "transition", batch_id: batch.id, state: "paid",
            payment_reference: reference.trim(),
            payment_evidence: { recorded_manually: true, note: evidence.trim() },
          })}>mark paid</Button>
          <Button variant="outline" disabled={busy} onClick={() => {
            const reason = prompt("Failure reason");
            if (reason) void mutate({ action: "failure", batch_id: batch.id, reason });
          }}>failed</Button>
        </>}
      </div>}
    </div>
  );
}
