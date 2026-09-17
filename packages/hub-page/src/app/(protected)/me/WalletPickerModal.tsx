"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet, CheckCircle2, Loader2 } from "lucide-react";
import { useDialogA11y } from "@/hooks/useDialogA11y";

type WalletOption = {
  user_address: string;
  username: string | null;
  full_name: string | null;
  phone: string | null;
  created_at: string;
};

export function WalletPickerModal({ options }: { options: WalletOption[] }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  // No onClose — this dialog is mandatory (a member with multiple legacy
  // wallets must pick one before /me can render their balance), so Escape
  // intentionally does nothing. Focus trap + initial focus + scroll lock
  // still apply.
  const dialogRef = useDialogA11y<HTMLDivElement>(true);

  async function confirm() {
    if (!chosen) return;
    setSaving(true);
    setError(null);

    const res = await fetch("/api/me/wallets/select-legacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: chosen }),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Failed to save. Please try again.");
      setSaving(false);
      return;
    }

    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl focus:outline-none"
      >
        <div className="mb-1 flex items-center gap-2">
          <Wallet className="h-5 w-5 text-akiba-teal" />
          <h2 id={titleId} className="font-sterling text-xl font-semibold text-akiba-ink">
            Which account is yours?
          </h2>
        </div>
        <p className="mb-5 text-sm text-akiba-muted">
          We found {options.length} accounts linked to this email. Pick the one to use going forward.
        </p>

        <div className="space-y-3">
          {options.map((opt) => {
            const selected = chosen === opt.user_address;
            const label = opt.full_name ?? opt.username ?? opt.phone ?? null;
            const date = new Date(opt.created_at).toLocaleDateString("en-KE", {
              day: "numeric", month: "short", year: "numeric",
            });

            return (
              <button
                key={opt.user_address}
                type="button"
                onClick={() => setChosen(opt.user_address)}
                aria-pressed={selected}
                className={`w-full rounded-xl border px-4 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal ${
                  selected
                    ? "border-akiba-teal bg-akiba-tint"
                    : "border-akiba-line bg-akiba-card hover:border-akiba-teal/40"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    {label && (
                      <p className="truncate text-sm font-semibold text-akiba-ink">{label}</p>
                    )}
                    <p className="font-mono text-xs text-akiba-muted">
                      {opt.user_address.slice(0, 10)}…{opt.user_address.slice(-6)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-akiba-muted">Joined {date}</p>
                  </div>
                  {selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-akiba-teal" />}
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>
        )}

        <button
          type="button"
          onClick={confirm}
          disabled={!chosen || saving}
          className="mt-5 w-full rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white transition hover:bg-akiba-tealDark disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </span>
          ) : (
            "Continue with this account"
          )}
        </button>
      </div>
    </div>
  );
}
