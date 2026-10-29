"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";

export function RemoveMerchantControl({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/merchants/${id}/archive`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationName, reason }),
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "Could not remove merchant."); return; }
      setOpen(false);
      router.refresh();
    } catch { setError("Network error. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!busy) { setOpen(value); setError(null); setConfirmationName(""); setReason(""); } }}>
      <DialogTrigger asChild><Button variant="outline" aria-label={`Remove ${name}`}>Remove</Button></DialogTrigger>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg" hideClose={busy}>
        <DialogTitle>Remove {name}?</DialogTitle>
        <DialogDescription className="mt-2">This archives the merchant and hides it from public discovery and the default merchant list. Transaction history and existing records are retained. Subscription billing is unchanged.</DialogDescription>
        <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void remove(); }}>
          <label className="block text-sm">Reason for removal
            <Input className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={1000} required disabled={busy} />
          </label>
          <label className="block text-sm">Type “{name}” to confirm
            <Input className="mt-1" value={confirmationName} onChange={(e) => setConfirmationName(e.target.value)} required disabled={busy} autoComplete="off" />
          </label>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={busy || confirmationName.trim() !== name || reason.trim().length < 3}>{busy ? "Removing…" : "Remove merchant"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
