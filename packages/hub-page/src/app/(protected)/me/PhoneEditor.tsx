"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Phone, Loader2 } from "lucide-react";
import { SettingsRow } from "@/components/akiba/SettingsRow";
import { EditSheet } from "@/components/akiba/EditSheet";

/**
 * Phone as a first-class identity field. Verification (SMS/OTP) isn't built
 * yet — no provider is wired up anywhere in this codebase — so saving here
 * only records the number and always marks it unverified; there's no code
 * step. The row's badge and sheet copy are explicit about that so it never
 * reads as a broken "verify" flow.
 */
export function PhoneEditor({ initialPhone }: { initialPhone: string | null }) {
  const router = useRouter();
  const inputId = useId();
  const [saved, setSaved] = useState(initialPhone);
  const [draft, setDraft] = useState(initialPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Could not save phone number");
        return;
      }
      setSaved(trimmed);
      close();
      router.refresh();
    } catch {
      setError("Could not save phone number");
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditSheet
      title="Phone number"
      trigger={(open) => (
        <SettingsRow
          icon={<Phone className="h-4 w-4 text-akiba-teal" aria-hidden="true" />}
          label="Phone number"
          description={
            saved ? (
              <span className="flex items-center gap-1.5">
                {saved}
                <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                  Unverified
                </span>
              </span>
            ) : (
              "Add a phone number"
            )
          }
          onClick={open}
        />
      )}
    >
      {(close) => (
        <form onSubmit={(e) => save(e, close)} className="space-y-3 pb-2">
          <p className="text-xs text-akiba-muted">
            We&apos;ll use this for order updates and, soon, automatic reward
            matching. Verification is coming soon — for now this is saved as
            unverified.
          </p>
          <div>
            <label htmlFor={inputId} className="sr-only">Phone number</label>
            <input
              id={inputId}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. 0712 345 678"
              className="w-full rounded-xl border border-akiba-line bg-white px-4 py-2.5 text-sm text-akiba-ink placeholder:text-akiba-muted/50 focus:border-akiba-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={saving || !draft.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-akiba-teal py-2.5 text-sm font-semibold text-white transition hover:bg-akiba-tealDark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save phone number"}
          </button>
        </form>
      )}
    </EditSheet>
  );
}
