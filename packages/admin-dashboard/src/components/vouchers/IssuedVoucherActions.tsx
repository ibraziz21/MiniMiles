"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
export function CopyVoucherCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-2 rounded-control bg-[#F2F3FF] p-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-muted">Voucher code</p>
          <p className="mt-1 break-all font-mono text-base font-semibold tracking-wide">
            {code}
          </p>
        </div>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setError(false);
            } catch {
              setError(true);
            }
          }}
          aria-label="Copy voucher code"
          className="flex min-h-11 items-center gap-2 rounded-control bg-[#EAEDFF] px-3 text-sm text-primary focus-visible:ring-2 focus-visible:ring-primary"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {copied && (
        <span role="status" className="sr-only">
          Voucher code copied
        </span>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          Couldn’t copy. Select the code to copy it manually.
        </p>
      )}
    </div>
  );
}
export function RevokeIssuedVoucher({
  id,
  fundId,
  allowed,
  disabledReason,
  title,
  code,
  merchant,
  member,
}: {
  id: string;
  fundId: string | null;
  allowed: boolean;
  disabledReason: string;
  title?: string;
  code?: string;
  merchant?: string;
  member?: string;
}) {
  const router = useRouter(),
    lock = useRef(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [saved, setSaved] = useState(false);
  async function revoke() {
    if (!fundId || !allowed || !confirmed || !reason || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/voucher-funds/${fundId}/vouchers/${id}/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: [reason, note.trim()].filter(Boolean).join(": "),
          }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Could not revoke this voucher.");
        return;
      }
      setSaved(true);
      setOpen(false);
      router.refresh();
    } catch {
      setError(
        "Connection lost. Refresh to check voucher status before retrying."
      );
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <section className="rounded-card bg-white p-5 shadow-sm">
      {saved ? (
        <p role="status" className="text-sm font-medium text-primary">
          Voucher revoked
        </p>
      ) : (
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (!busy) setOpen(value);
          }}
        >
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="min-h-12 w-full text-danger"
              disabled={!allowed}
            >
              Revoke voucher
            </Button>
          </DialogTrigger>
          {!allowed && (
            <p className="mt-3 text-sm text-ink-muted">{disabledReason}</p>
          )}
          <DialogContent
            hideClose
            className="bottom-0 top-auto max-h-[92dvh] max-w-lg translate-y-0 overflow-y-auto rounded-b-none border-0 p-5 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-sheet"
          >
            <div
              className="mx-auto mb-5 h-1 w-10 rounded-full bg-[#BDCAC6]"
              aria-hidden="true"
            />
            <DialogTitle className="text-xl">Revoke voucher</DialogTitle>
            <DialogDescription className="mt-4 rounded-card bg-[#F2F3FF] p-4 leading-6">
              The voucher will be deactivated immediately and can no longer be
              redeemed.
            </DialogDescription>
            {title && (
              <div className="mt-4 rounded-card bg-[#F2F3FF] p-4">
                <p className="font-semibold">{title}</p>
                <p className="mt-1 break-all text-sm text-primary">{code}</p>
                <p className="mt-3 text-sm text-ink-muted">{merchant}</p>
                <p className="mt-1 break-all text-sm">{member}</p>
              </div>
            )}
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void revoke();
              }}
            >
              <label className="block text-sm font-medium">
                Reason for revocation <span className="text-danger">*</span>
                <select
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                  className="mt-2 min-h-12 w-full rounded-control border-0 bg-[#F2F3FF] px-3 text-base focus-visible:outline-primary"
                >
                  <option value="">Select reason</option>
                  <option>Verified fraud</option>
                  <option>Issuance error</option>
                  <option>Legal requirement</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Additional notes{" "}
                <span className="font-normal text-ink-muted">(optional)</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  rows={2}
                  disabled={busy}
                  className="mt-2 w-full rounded-control border-0 bg-[#F2F3FF] p-3 text-base focus-visible:outline-primary"
                  placeholder="Ticket reference or context…"
                />
              </label>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={busy}
                  className="h-5 w-5 shrink-0 accent-[#005C55]"
                />
                I am authorized to revoke this voucher.
              </label>
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="destructive"
                className="min-h-12 w-full"
                disabled={!allowed || !confirmed || !reason || busy}
              >
                {busy ? "Revoking…" : "Revoke voucher"}
              </Button>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-12 w-full bg-[#EAEDFF]"
                  disabled={busy}
                >
                  Cancel
                </Button>
              </DialogClose>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
