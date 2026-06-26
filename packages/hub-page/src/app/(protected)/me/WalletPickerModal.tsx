"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet, CheckCircle2, Loader2 } from "lucide-react";

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

  async function confirm() {
    if (!chosen) return;
    setSaving(true);
    setError(null);

    const res = await fetch("/api/me/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ecosystem: "minipay", address: chosen }),
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
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-1 flex items-center gap-2">
          <Wallet className="h-5 w-5 text-akiba-teal" />
          <h2 className="font-sterling text-xl font-semibold text-akiba-ink">
            Choose your wallet
          </h2>
        </div>
        <p className="mb-5 text-sm text-akiba-muted">
          We found {options.length} wallets linked to this email. Pick which one to use for this Hub account.
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
                onClick={() => setChosen(opt.user_address)}
                className={`w-full rounded-xl border px-4 py-3.5 text-left transition ${
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
          <p className="mt-3 text-sm text-red-500">{error}</p>
        )}

        <button
          onClick={confirm}
          disabled={!chosen || saving}
          className="mt-5 w-full rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white transition hover:bg-[#1E7E8D] disabled:opacity-40"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </span>
          ) : (
            "Use this wallet"
          )}
        </button>
      </div>
    </div>
  );
}
