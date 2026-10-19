"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { RESOLUTION_REASONS, type ReportAction } from "@/lib/discoveryReports";

export function DiscoveryReportActions({ reportId, hasPhoto }: { reportId: string; hasPhoto: boolean }) {
  const router = useRouter();
  const [action, setAction] = useState<ReportAction>("hide_visit");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  async function resolve() {
    if (!reason || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/discovery-reports/${reportId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "Could not resolve this report."); return; }
      router.refresh();
    } catch { setError("Connection lost. Refresh the queue to check whether this report was resolved before retrying."); }
    finally { setBusy(false); setConfirming(false); }
  }
  return <div className="space-y-3 border-t border-border pt-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium">Action
        <select name="action" disabled={busy} value={action} onChange={e => { setAction(e.target.value as ReportAction); setReason(""); }} className="min-h-11 w-full rounded-control border border-border bg-surface px-3 focus-visible:outline-primary">
          <option value="hide_visit">Hide entire visit and its photos</option>
          {hasPhoto && <option value="hide_photo">Hide reported photo only</option>}
          <option value="dismiss">Dismiss report; keep content unchanged</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">Resolution reason
        <select name="reason" disabled={busy} value={reason} onChange={e => setReason(e.target.value)} className="min-h-11 w-full rounded-control border border-border bg-surface px-3 focus-visible:outline-primary">
          <option value="">Choose a reason</option>
          {RESOLUTION_REASONS[action].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
        </select>
      </label>
    </div>
    <p className="text-sm text-ink-muted">{action === "hide_visit" ? "Removes this visit and all its photos from public discovery. Other reports remain available for review." : action === "hide_photo" ? "Removes the reported photo from public discovery. Visit text and other photos remain visible." : "Records your decision without changing the content."}</p>
    <Button disabled={busy || !reason} variant={action === "dismiss" ? "outline" : "destructive"} onClick={() => setConfirming(true)}>{busy ? "Saving decision…" : action === "dismiss" ? "Dismiss report" : action === "hide_photo" ? "Hide photo and resolve" : "Hide visit and resolve"}</Button>
    <ConfirmActionDialog open={confirming} onOpenChange={setConfirming} title={action === "dismiss" ? "Dismiss this report?" : "Hide reported content?"} description={action === "dismiss" ? "Your decision will be recorded. Content will remain unchanged." : "This content will be hidden from public discovery and your decision recorded. Existing signed image links can remain valid for up to five minutes."} confirmLabel={action === "dismiss" ? "Dismiss report" : "Hide and resolve"} variant={action === "dismiss" ? "default" : "destructive"} onConfirm={resolve} />
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}
