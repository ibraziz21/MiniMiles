"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

export function AccountDeletionActions({ requestId, assignedToMe, completed }: { requestId: string; assignedToMe: boolean; completed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [inspected, setInspected] = useState(false);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  async function act(action: string) {
    setBusy(action); setMessage("");
    try {
      const response = await fetch(`/api/admin/account-deletions/${requestId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, confirmation }) });
      const result = await response.json();
      setBlockers(result.blockers ?? []);
      if (!response.ok || !result.ok) { setInspected(false); setMessage(result.error ?? "Cleanup is blocked. Review the checks below before retrying."); return; }
      if (action === "inspect") { setInspected(true); setMessage(result.blockers?.length ? "Some checks need attention before cleanup." : "Preflight passed. The server will recheck before deleting anything."); }
      else if (action === "assign") { setMessage("Assigned to you."); router.refresh(); }
      else if (action === "retry_email") { setMessage(result.delivered ? "Completion email sent." : "No email sent. It may not be due, may already be leased, or its destination may be unavailable. Check delivery status."); router.refresh(); }
      else { setInspected(false); setMessage(result.emailDelivered ? "Cleanup verified and completion email sent." : "Cleanup verified. Completion email is tracked separately below."); router.refresh(); }
    } catch { setInspected(false); setMessage("Connection lost. Refresh to check progress before retrying. Active runs remain leased for 15 minutes."); }
    finally { setBusy(null); setConfirm(false); setConfirmation(""); }
  }
  return <section aria-label="Deletion operations" className="space-y-4 rounded-panel border border-border bg-surface p-4 sm:p-5">
    <h2 className="text-lg font-semibold">{completed ? "Completion notice" : "Guided account cleanup"}</h2>
    {!completed && <p className="max-w-prose text-sm text-ink-muted">This closes the shared Akiba member account. Cleanup removes photos, credentials, wallet associations and supported member records, then verifies removal before recording completion. Merchant accounting or other unsupported histories stop the run for review.</p>}
    <div className="flex flex-wrap gap-2">
      {!completed && <>
        <Button variant="outline" disabled={busy !== null} onClick={() => act("assign")}>{busy === "assign" ? "Assigning…" : assignedToMe ? "Assigned to you" : "Assign to me"}</Button>
        <Button variant="outline" disabled={busy !== null} onClick={() => act("inspect")}>{busy === "inspect" ? "Checking…" : "Inspect cleanup checks"}</Button>
        <Button variant="destructive" disabled={busy !== null || !assignedToMe || !inspected || blockers.length > 0} onClick={() => setConfirm(true)}>Run verified cleanup</Button>
      </>}
      {completed && <Button variant="outline" disabled={busy !== null} onClick={() => act("retry_email")}>{busy === "retry_email" ? "Checking delivery…" : "Retry completion email"}</Button>}
    </div>
    {!completed && !assignedToMe && <p className="text-sm text-ink-muted">Assign this request to yourself before running cleanup.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {blockers.length > 0 && <div role="alert" className="space-y-2 text-sm"><p className="font-semibold">Checks requiring attention</p><ul className="list-disc space-y-1 pl-5">{blockers.map(code => <li key={code} className="break-words">{code.replaceAll("_", " ")}</li>)}</ul><p>Resolve these conditions, then inspect again. No completion has been recorded.</p></div>}
    <ConfirmActionDialog open={confirm} onOpenChange={setConfirm} title="Delete the entire shared Akiba account?" variant="destructive" confirmLabel="Delete and verify" confirmDisabled={confirmation !== "DELETE SHARED ACCOUNT"} onConfirm={() => act("run")} description={<div className="space-y-3"><p>This permanently removes supported member data and shared sign-in access. Account-bound rewards and wallet associations are lost. This action cannot be undone.</p><label className="grid gap-1 text-sm">Type DELETE SHARED ACCOUNT to confirm<input name="confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" spellCheck={false} className="min-h-11 w-full rounded-control border border-border bg-surface px-3 text-ink focus-visible:outline-primary" /></label>{confirmation !== "DELETE SHARED ACCOUNT" && <p className="text-sm text-ink-muted">The server will refuse cleanup unless this phrase matches exactly.</p>}</div>} />
  </section>;
}
