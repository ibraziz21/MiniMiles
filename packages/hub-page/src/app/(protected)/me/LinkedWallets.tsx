"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import clsx from "clsx";

type Props = {
  minipayAddress: string | null;  // auto-resolved from users table
  hasMultiple: boolean;            // user has >1 address → show switch option
  userId: string;
};

export function LinkedWallets({ minipayAddress, hasMultiple, userId }: Props) {
  const router = useRouter();
  const [linking, setLinking] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function linkBase() {
    if (!input.match(/^0x[0-9a-fA-F]{40}$/)) {
      setError("Enter a valid EVM address (0x…)");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/me/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ecosystem: "base", address: input }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to link wallet");
      return;
    }
    setLinking(false);
    setInput("");
    router.refresh();
  }

  async function switchWallet() {
    setSwitching(true);
    // Clear the saved minipay choice so the picker re-appears on next load
    await fetch("/api/me/wallets/clear-minipay", { method: "POST" });
    router.refresh();
  }

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">
        Linked wallets
      </h2>
      <div className="space-y-3">

        {/* MiniPay slot — auto-imported from users table */}
        <div className="rounded-2xl border border-akiba-line bg-white">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-akiba-tint text-lg">
                📱
              </span>
              <div>
                <p className="text-sm font-semibold text-akiba-ink">MiniPay</p>
                {minipayAddress ? (
                  <p className="font-mono text-xs text-akiba-muted">
                    {minipayAddress.slice(0, 10)}…{minipayAddress.slice(-6)}
                  </p>
                ) : (
                  <p className="text-xs text-akiba-muted">Celo stablecoin wallet</p>
                )}
              </div>
            </div>

            {minipayAddress ? (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-600">Connected</span>
                {hasMultiple && (
                  <button
                    onClick={switchWallet}
                    disabled={switching}
                    className="ml-1 flex items-center gap-1 rounded-lg border border-akiba-line px-2.5 py-1.5 text-xs text-akiba-muted transition hover:border-akiba-teal/40 hover:text-akiba-teal"
                    title="Switch to a different wallet"
                  >
                    {switching
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <RefreshCw className="h-3 w-3" />}
                    Switch
                  </button>
                )}
              </div>
            ) : (
              <a
                href="https://minipay.opera.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-akiba-muted hover:text-akiba-teal"
              >
                Get MiniPay <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>

        {/* Base slot — manually linkable */}
        <div className="rounded-2xl border border-akiba-line bg-white">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-lg">
                🔵
              </span>
              <div>
                <p className="text-sm font-semibold text-akiba-ink">Base App</p>
                <p className="text-xs text-akiba-muted">Base L2 wallet</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="https://www.base.org/getstarted"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-akiba-muted hover:text-akiba-teal"
              >
                Set up <ExternalLink className="h-3 w-3" />
              </a>
              <button
                onClick={() => { setLinking((v) => !v); setError(null); setInput(""); }}
                className={clsx(
                  "flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                  linking
                    ? "border-akiba-teal bg-akiba-teal text-white"
                    : "border-akiba-teal/30 bg-akiba-tint text-akiba-teal hover:bg-akiba-teal hover:text-white"
                )}
              >
                <Plus className="h-3.5 w-3.5" /> Link
              </button>
            </div>
          </div>

          {linking && (
            <div className="border-t border-akiba-line px-4 py-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="0x… (Base address)"
                  className="flex-1 rounded-xl border border-akiba-line bg-akiba-card px-3 py-2 font-mono text-xs text-akiba-ink placeholder:text-akiba-muted/40 focus:border-akiba-teal focus:outline-none"
                />
                <button
                  onClick={linkBase}
                  disabled={saving || !input}
                  className="rounded-xl bg-akiba-teal px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1E7E8D] disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
              {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
