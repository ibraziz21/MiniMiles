"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const COMING_SOON_PROVIDERS = new Set(["mpesa_b2c", "celo"]);

interface ProviderRow {
  provider_name: string;
  is_enabled: boolean;
  is_paused: boolean;
  pause_reason: string | null;
  per_payout_limit: number | string;
  daily_limit: number | string;
  dual_approval_threshold: number | string;
  supported_currencies: string[];
}
interface QueueRow {
  batch_id: string;
  partner_id: string;
  currency: string;
  item_count: number;
  total_payable_amount: number | string;
  approved_at: string | null;
}
interface InstructionRow {
  instruction_id: string;
  batch_id: string;
  instruction_state: string;
  batch_state: string;
  provider_name: string;
  amount: number | string;
  currency: string;
  provider_reference: string | null;
  destination_display_name: string | null;
  failure_code: string | null;
  failure_reason: string | null;
}
interface IncidentRow {
  id: string;
  type: string;
  data: Record<string, unknown> | null;
  created_at: string;
}
interface StatusPayload {
  providers: ProviderRow[];
  queue: QueueRow[];
  instructions: InstructionRow[];
  incidents: IncidentRow[];
}
interface DestinationRow {
  id: string;
  partner_id: string;
  destination_type: string;
  display_name: string;
  currency: string;
  destination_summary: string | null;
  is_active: boolean;
  is_approved: boolean;
  approved_at: string | null;
  verified_at: string | null;
  created_at: string;
}

interface ConfirmForm {
  instructionId: string;
  providerRef: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  paymentDate: string;
  evidenceNote: string;
}

const EMPTY_CONFIRM: Omit<ConfirmForm, "instructionId"> = {
  providerRef: "",
  amount: "",
  currency: "",
  paymentMethod: "bank_transfer",
  paymentDate: new Date().toISOString().slice(0, 10),
  evidenceNote: "",
};

export function SettlementConsole() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [destinations, setDestinations] = useState<DestinationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmForm, setConfirmForm] = useState<ConfirmForm | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, destRes] = await Promise.all([
        fetch("/api/admin/payout/provider/status"),
        fetch("/api/admin/settlement/destinations"),
      ]);
      if (statusRes.ok) setData((await statusRes.json()) as StatusPayload);
      if (destRes.ok) {
        const d = (await destRes.json()) as { destinations: DestinationRow[] };
        setDestinations(d.destinations ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function call(url: string, body?: unknown, key?: string) {
    setBusy(key ?? url);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json().catch(() => ({}));
      setMsg({ text: res.ok ? "Done" : (d.error ?? "Action failed"), ok: res.ok });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function submitManualConfirm() {
    if (!confirmForm) return;
    const { instructionId, providerRef, amount, currency, paymentMethod, paymentDate, evidenceNote } = confirmForm;
    if (!providerRef || !amount || !paymentMethod || !paymentDate || !evidenceNote) {
      setMsg({ text: "All fields are required", ok: false });
      return;
    }
    setBusy(`confirm-${instructionId}`);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/payout/${instructionId}/manual-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_reference: providerRef,
          confirmed_amount: parseFloat(amount),
          confirmed_currency: currency,
          payment_method: paymentMethod,
          payment_date: paymentDate,
          evidence_note: evidenceNote,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg({ text: `Confirmed. Receipt: ${d.receipt_number ?? "—"}`, ok: true });
        setConfirmForm(null);
        await load();
      } else {
        setMsg({ text: d.error ?? "Confirm failed", ok: false });
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading || !data) {
    return <div className="p-6 text-sm text-gray-500">Loading settlement console…</div>;
  }

  return (
    <div className="space-y-6 p-6">
      {msg && (
        <div className={`rounded-md px-4 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {msg.text}
        </div>
      )}

      {/* ── Provider Health ── */}
      <Card>
        <CardHeader><CardTitle>Provider Health</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-gray-400">
                <tr>
                  <th className="py-2">Provider</th>
                  <th>Status</th>
                  <th>Per-payout</th>
                  <th>Daily</th>
                  <th>Dual-approval ≥</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.providers.map((p) => {
                  const comingSoon = COMING_SOON_PROVIDERS.has(p.provider_name);
                  return (
                    <tr key={p.provider_name} className="border-b border-gray-100">
                      <td className="py-2 font-medium capitalize">
                        {p.provider_name.replace(/_/g, " ")}
                      </td>
                      <td>
                        {comingSoon ? (
                          <Badge variant="outline" className="text-gray-400">Coming soon</Badge>
                        ) : p.is_paused ? (
                          <Badge variant="destructive">Paused</Badge>
                        ) : p.is_enabled ? (
                          <Badge className="bg-green-600">Active</Badge>
                        ) : (
                          <Badge variant="outline">Disabled</Badge>
                        )}
                        {p.pause_reason && (
                          <span className="ml-2 text-xs text-gray-400">({p.pause_reason})</span>
                        )}
                      </td>
                      <td>{String(p.per_payout_limit)}</td>
                      <td>{String(p.daily_limit)}</td>
                      <td>{String(p.dual_approval_threshold)}</td>
                      <td>
                        {comingSoon ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : p.is_paused ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === `resume-${p.provider_name}`}
                            onClick={() => call(`/api/admin/payout/provider/${p.provider_name}/resume`, undefined, `resume-${p.provider_name}`)}
                          >
                            Resume
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy === `pause-${p.provider_name}`}
                            onClick={() => call(`/api/admin/payout/provider/${p.provider_name}/pause`, { reason: "manual pause from console" }, `pause-${p.provider_name}`)}
                          >
                            Pause
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Destination Approval Queue ── */}
      {destinations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Destination Approval Queue ({destinations.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-xs uppercase text-gray-400">
                  <tr>
                    <th className="py-2">Partner</th>
                    <th>Type</th>
                    <th>Display name</th>
                    <th>Summary</th>
                    <th>Verified</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {destinations.map((d) => (
                    <tr key={d.id} className="border-b border-gray-100">
                      <td className="py-2 font-mono text-xs">{d.partner_id.slice(0, 8)}</td>
                      <td className="capitalize">{d.destination_type.replace(/_/g, " ")}</td>
                      <td>{d.display_name}</td>
                      <td className="text-xs text-gray-500">{d.destination_summary ?? "—"}</td>
                      <td>
                        {d.verified_at ? (
                          <Badge className="bg-blue-600 text-xs">Verified</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Unverified</Badge>
                        )}
                      </td>
                      <td className="text-xs">{new Date(d.created_at).toLocaleDateString()}</td>
                      <td className="space-x-1">
                        {!d.verified_at && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === `verify-${d.id}`}
                            onClick={() => call(`/api/admin/settlement/destinations/${d.id}/verify`, undefined, `verify-${d.id}`)}
                          >
                            Verify
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={busy === `approve-${d.id}`}
                          onClick={() => call(`/api/admin/settlement/destinations/${d.id}/approve`, undefined, `approve-${d.id}`)}
                        >
                          Approve
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Pending Payout Queue ── */}
      <Card>
        <CardHeader><CardTitle>Pending Payout Queue</CardTitle></CardHeader>
        <CardContent>
          {data.queue.length === 0 ? (
            <p className="text-sm text-gray-400">No approved batches awaiting payout.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-gray-400">
                <tr>
                  <th className="py-2">Batch</th>
                  <th>Partner</th>
                  <th>Items</th>
                  <th>Amount</th>
                  <th>Currency</th>
                  <th>Approved</th>
                </tr>
              </thead>
              <tbody>
                {data.queue.map((q) => (
                  <tr key={q.batch_id} className="border-b border-gray-100">
                    <td className="py-2 font-mono text-xs">{q.batch_id.slice(0, 8)}</td>
                    <td className="font-mono text-xs">{q.partner_id.slice(0, 8)}</td>
                    <td>{q.item_count}</td>
                    <td>{String(q.total_payable_amount)}</td>
                    <td>{q.currency}</td>
                    <td className="text-xs">{q.approved_at ? new Date(q.approved_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── Active Instructions ── */}
      <Card>
        <CardHeader>
          <CardTitle>Active Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          {data.instructions.length === 0 ? (
            <p className="text-sm text-gray-400">No active instructions.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-gray-400">
                <tr>
                  <th className="py-2">Instruction</th>
                  <th>State</th>
                  <th>Provider</th>
                  <th>Amount</th>
                  <th>Destination</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.instructions.map((i) => (
                  <tr key={i.instruction_id} className="border-b border-gray-100">
                    <td className="py-2 font-mono text-xs">{i.instruction_id.slice(0, 8)}</td>
                    <td>
                      <Badge variant={i.instruction_state === "failed" ? "destructive" : undefined}>
                        {i.instruction_state}
                      </Badge>
                      {i.failure_code && (
                        <span className="ml-1 text-xs text-red-500">{i.failure_code}</span>
                      )}
                    </td>
                    <td>{i.provider_name}</td>
                    <td>{String(i.amount)} {i.currency}</td>
                    <td>{i.destination_display_name ?? "—"}</td>
                    <td className="space-x-1">
                      {(i.instruction_state === "failed" || i.instruction_state === "uncertain") && i.provider_name !== "manual" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === `retry-${i.instruction_id}`}
                          onClick={() => call(`/api/admin/payout/${i.instruction_id}/retry`, undefined, `retry-${i.instruction_id}`)}
                        >
                          Retry
                        </Button>
                      )}
                      {(i.instruction_state === "submitted" || i.instruction_state === "uncertain") && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === `confirm-${i.instruction_id}`}
                          onClick={() =>
                            setConfirmForm({
                              instructionId: i.instruction_id,
                              ...EMPTY_CONFIRM,
                              providerRef: i.provider_reference ?? "",
                              amount: String(i.amount),
                              currency: i.currency,
                            })
                          }
                        >
                          Manual confirm
                        </Button>
                      )}
                      {i.instruction_state === "confirmed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(`/api/admin/payout/${i.instruction_id}/receipt`, "_blank")}
                        >
                          Receipt
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── Manual Confirmation Form ── */}
      {confirmForm && (
        <Card className="border-2 border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle>Manual Confirmation — {confirmForm.instructionId.slice(0, 8)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-700">Payment reference *</label>
                <input
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  value={confirmForm.providerRef}
                  onChange={(e) => setConfirmForm({ ...confirmForm, providerRef: e.target.value })}
                  placeholder="e.g. TXN-12345"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">Payment method *</label>
                <select
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  value={confirmForm.paymentMethod}
                  onChange={(e) => setConfirmForm({ ...confirmForm, paymentMethod: e.target.value })}
                >
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="mobile_money">Mobile money</option>
                  <option value="crypto">Crypto</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">Payment date *</label>
                <input
                  type="date"
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  value={confirmForm.paymentDate}
                  onChange={(e) => setConfirmForm({ ...confirmForm, paymentDate: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">Confirmed amount *</label>
                <input
                  type="number"
                  step="0.000001"
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  value={confirmForm.amount}
                  onChange={(e) => setConfirmForm({ ...confirmForm, amount: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-700">Evidence note / receipt reference *</label>
                <textarea
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  rows={2}
                  value={confirmForm.evidenceNote}
                  onChange={(e) => setConfirmForm({ ...confirmForm, evidenceNote: e.target.value })}
                  placeholder="e.g. Bank receipt #123, approved by finance team on YYYY-MM-DD"
                />
              </div>
            </div>
            <div className="mt-4 flex space-x-2">
              <Button
                onClick={submitManualConfirm}
                disabled={busy === `confirm-${confirmForm.instructionId}`}
              >
                {busy === `confirm-${confirmForm.instructionId}` ? "Confirming…" : "Confirm payment"}
              </Button>
              <Button variant="outline" onClick={() => setConfirmForm(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Reconciliation Incidents ── */}
      <Card>
        <CardHeader><CardTitle>Reconciliation Incidents</CardTitle></CardHeader>
        <CardContent>
          {data.incidents.length === 0 ? (
            <p className="text-sm text-gray-400">No open payout incidents.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.incidents.map((inc) => (
                <li key={inc.id} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                  <span className="font-medium text-amber-900">{inc.type}</span>
                  <span className="ml-2 text-xs text-amber-700">
                    {new Date(inc.created_at).toLocaleString()}
                  </span>
                  {inc.data && (
                    <pre className="mt-1 text-xs text-amber-600 whitespace-pre-wrap">
                      {JSON.stringify(inc.data, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
