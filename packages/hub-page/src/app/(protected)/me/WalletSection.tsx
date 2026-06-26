"use client";

import { useState } from "react";
import { ExternalLink, Plus, CheckCircle2, Wallet } from "lucide-react";

type Wallet = { ecosystem: string; address: string; is_primary: boolean };

const ECOSYSTEMS = [
  {
    id: "minipay",
    label: "MiniPay",
    description: "Celo stablecoin wallet",
    deeplink: "https://minipay.opera.com",
    placeholder: "0x… (Celo address)",
  },
  {
    id: "base",
    label: "Base App",
    description: "Base L2 wallet",
    deeplink: "https://www.base.org/getstarted",
    placeholder: "0x… (Base address)",
  },
];

export function WalletSection({
  wallets,
  userId,
}: {
  wallets: Wallet[];
  userId: string;
}) {
  const [linking, setLinking] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localWallets, setLocalWallets] = useState<Wallet[]>(wallets);

  function isLinked(ecosystem: string) {
    return localWallets.some((w) => w.ecosystem === ecosystem);
  }

  function getWallet(ecosystem: string) {
    return localWallets.find((w) => w.ecosystem === ecosystem);
  }

  function shortAddress(addr: string) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }

  async function saveWallet(ecosystem: string) {
    if (!input.match(/^0x[0-9a-fA-F]{40}$/)) {
      setError("Enter a valid EVM address (0x…)");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/me/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ecosystem, address: input }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to link wallet");
      }
      setLocalWallets((prev) => [
        ...prev,
        { ecosystem, address: input, is_primary: false },
      ]);
      setLinking(null);
      setInput("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">
        Linked wallets
      </h2>
      <div className="space-y-3">
        {ECOSYSTEMS.map((eco) => {
          const wallet = getWallet(eco.id);
          const linked = !!wallet;
          const isOpen = linking === eco.id;

          return (
            <div
              key={eco.id}
              className="rounded-2xl border border-akiba-line bg-white"
            >
              <div className="flex items-center justify-between px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-akiba-tint">
                    <Wallet className="h-4 w-4 text-akiba-teal" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-akiba-ink">
                      {eco.label}
                    </p>
                    <p className="text-xs text-akiba-muted">
                      {linked ? shortAddress(wallet!.address) : eco.description}
                    </p>
                  </div>
                </div>

                {linked ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="text-xs font-medium text-emerald-600">
                      Connected
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <a
                      href={eco.deeplink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-akiba-muted transition hover:text-akiba-teal"
                    >
                      Set up <ExternalLink className="h-3 w-3" />
                    </a>
                    <button
                      onClick={() => {
                        setLinking(isOpen ? null : eco.id);
                        setInput("");
                        setError(null);
                      }}
                      className="flex items-center gap-1 rounded-lg border border-akiba-teal/30 bg-akiba-tint px-3 py-1.5 text-xs font-semibold text-akiba-teal transition hover:bg-akiba-teal hover:text-white"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Link
                    </button>
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="border-t border-akiba-line px-4 py-3">
                  <p className="mb-2 text-xs text-akiba-muted">
                    Paste your {eco.label} wallet address to link it.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={eco.placeholder}
                      className="flex-1 rounded-xl border border-akiba-line bg-akiba-card px-3 py-2 font-mono text-xs text-akiba-ink placeholder:text-akiba-muted/40 focus:border-akiba-teal focus:outline-none focus:ring-2 focus:ring-akiba-teal/20"
                    />
                    <button
                      onClick={() => saveWallet(eco.id)}
                      disabled={saving || !input}
                      className="rounded-xl bg-akiba-teal px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1E7E8D] disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                  {error && (
                    <p className="mt-2 text-xs text-red-500">{error}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
