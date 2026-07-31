"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, ExternalLink, RefreshCw, Loader2 } from "lucide-react";

type Props = {
  minipayAddress: string | null;  // auto-resolved from users table
  hasMultiple: boolean;            // user has >1 address → show switch option
  userId: string;
  /** "sheet" — rendered inside a bottom sheet: no outer margin or heading */
  variant?: "default" | "sheet";
};

export function LinkedWallets({ minipayAddress, hasMultiple, userId, variant = "default" }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Linking now proves ownership with a signed challenge
  // (production-readiness-security-spec.md §3.2) instead of accepting a
  // bare pasted address — the wallet the user connects is the one that
  // signs, so there is no separate "enter an address" step.
  async function linkBase() {
    if (!window.ethereum) {
      setError("No wallet detected. Open in Base App or install a compatible wallet.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No account returned by wallet");

      const chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      const chainId = parseInt(chainIdHex, 16);

      const challengeRes = await fetch("/api/me/wallets/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ecosystem: "base", address, chainId }),
      });
      if (!challengeRes.ok) {
        const data = await challengeRes.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to start wallet verification");
      }
      const { challengeId, message } = (await challengeRes.json()) as { challengeId: string; message: string };

      const signature = (await window.ethereum.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;

      const verifyRes = await fetch("/api/me/wallets/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, signature }),
      });
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to verify wallet signature");
      }

      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function switchWallet() {
    setSwitching(true);
    // Clear the saved minipay choice so the picker re-appears on next load
    await fetch("/api/me/wallets/clear-minipay", { method: "POST" });
    router.refresh();
  }

  return (
    <div className={variant === "sheet" ? "" : "mt-6"}>
      {variant !== "sheet" && (
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">
          Linked wallets
        </h2>
      )}
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
                onClick={linkBase}
                disabled={saving}
                className="flex items-center gap-1 rounded-lg border border-akiba-teal/30 bg-akiba-tint px-3 py-1.5 text-xs font-semibold text-akiba-teal transition hover:bg-akiba-teal hover:text-white disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {saving ? "Verifying…" : "Connect & verify"}
              </button>
            </div>
          </div>

          {error && (
            <div className="border-t border-akiba-line px-4 py-3">
              <p className="text-xs text-red-500">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
