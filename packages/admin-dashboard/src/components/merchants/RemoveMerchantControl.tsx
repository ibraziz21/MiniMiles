"use client";
/* eslint-disable @next/next/no-img-element -- Merchant-hosted media uses dynamic public asset URLs. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Store, MapPin, CreditCard, MoreHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

export function RemoveMerchantControl({
  id,
  name,
  imageUrl,
  location,
}: {
  id: string;
  name: string;
  imageUrl?: string | null;
  location?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [preset, setPreset] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/merchants/${id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationName, reason }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not archive merchant.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value);
          setError(null);
          setConfirmationName("");
          setReason("");
          setPreset("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" aria-label={`Archive ${name}`}>
          Archive merchant
        </Button>
      </DialogTrigger>
      <DialogContent
        className="bottom-0 top-auto max-h-[90dvh] translate-y-0 overflow-y-auto rounded-b-none sm:bottom-auto sm:top-1/2 sm:max-w-lg sm:-translate-y-1/2 sm:rounded-sheet [&>button]:min-h-11 [&>button]:min-w-11"
        hideClose={busy}
      >
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[#BDCAC6] sm:hidden" />
        <DialogTitle>Archive merchant</DialogTitle>
        <div className="mt-5 flex items-center gap-3 rounded-control bg-[#F2F3FF] p-3">
          {imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */ <img
              src={imageUrl}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 rounded-control object-cover"
            />
          ) : (
            <Store className="h-6 w-6 text-primary" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="font-semibold">{name}</p>
            <p className="truncate text-sm text-ink-muted">{location}</p>
          </div>
        </div>
        <DialogDescription className="mt-4 rounded-control bg-[#EAEDFF] p-4">
          This archives the merchant and hides it from public discovery and the
          default merchant list. Transaction history and existing records are
          retained. Subscription billing is unchanged.
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          <fieldset disabled={busy} className="space-y-2">
            <legend className="mb-3 text-sm font-medium">
              Reason for archiving
            </legend>
            {[
              { value: "Closed / relocated", icon: Store },
              { value: "Merchant request", icon: MapPin },
              { value: "Non-payment", icon: CreditCard },
              { value: "Other", icon: MoreHorizontal },
            ].map(({ value, icon: Icon }) => (
              <label
                key={value}
                className="flex min-h-14 cursor-pointer items-center gap-3 rounded-control bg-[#F2F3FF] px-4 py-3 text-sm"
              >
                <Icon className="h-5 w-5 text-ink-muted" aria-hidden="true" />
                <span className="flex-1">{value}</span>
                <input
                  type="radio"
                  name="archiveReason"
                  value={value}
                  required
                  checked={preset === value}
                  onChange={() => {
                    setPreset(value);
                    setReason(value === "Other" ? "" : value);
                  }}
                  className="h-5 w-5 accent-[#005C55]"
                />
              </label>
            ))}
          </fieldset>
          {preset === "Other" && (
            <label className="block text-sm">
              Details
              <Input
                aria-label="Reason for archiving details"
                className="mt-2 h-11 text-base"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={3}
                maxLength={1000}
                required
                disabled={busy}
              />
            </label>
          )}
          <label className="block text-sm">
            Type “{name}” to confirm
            <Input
              className="mt-1 h-11 text-base"
              value={confirmationName}
              onChange={(e) => setConfirmationName(e.target.value)}
              required
              disabled={busy}
              autoComplete="off"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2">
            <Button
              type="button"
              variant="secondary"
              className="w-full bg-[#F2F3FF]"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="w-full"
              variant="destructive"
              disabled={
                busy ||
                confirmationName.trim() !== name ||
                reason.trim().length < 3
              }
            >
              {busy ? "Archiving…" : "Archive merchant"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
