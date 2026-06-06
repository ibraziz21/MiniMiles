"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle, Wallet } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import truncateEthAddress from "truncate-eth-address";
import { normalizeEvmAddress } from "@/lib/prosperity-pass-linking";

type LinkedWalletRequest = {
  id: string;
  primaryWallet: string;
  safeAddress: string;
  linkedWallet: string;
  status:
    | "created"
    | "signature_verified"
    | "safe_approved"
    | "linked"
    | "failed"
    | "expired";
  signatureMessage: string | null;
  lastError: string | null;
};

type ApiResponse = {
  request: LinkedWalletRequest | null;
  error?: string;
};

export default function ProsperityPassLinkPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const resolvedParams = React.use(params);
  const requestId = resolvedParams.requestId;

  const [request, setRequest] = useState<LinkedWalletRequest | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [signing, setSigning] = useState(false);

  const loadRequest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prosperity-pass/linked-wallets/${requestId}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.request) throw new Error(json.error ?? "Link request not found");
      setRequest(json.request);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not load link request");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => { void loadRequest(); }, [loadRequest]);

  const connectWallet = async (): Promise<string | null> => {
    setConnecting(true);
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error("Open this page in your external wallet browser (MetaMask, Coinbase Wallet, etc.)");
      const [addr] = await ethereum.request({ method: "eth_requestAccounts" });
      const normalized = normalizeEvmAddress(addr);
      if (!normalized) throw new Error("Invalid wallet address");
      setAccount(normalized);
      return normalized;
    } catch (err: any) {
      toast.error(err?.message ?? "Could not connect wallet");
      return null;
    } finally {
      setConnecting(false);
    }
  };

  const signAndVerify = async () => {
    if (!request?.signatureMessage) return;

    setSigning(true);
    try {
      const signer = account ?? (await connectWallet());
      if (!signer) return;

      if (signer !== request.linkedWallet) {
        throw new Error(
          `Wrong wallet connected. Switch to ${truncateEthAddress(request.linkedWallet)} and try again.`
        );
      }

      const ethereum = (window as any).ethereum;
      const signature = await ethereum.request({
        method: "personal_sign",
        params: [stringToHex(request.signatureMessage), signer],
      });

      const res = await fetch(
        `/api/prosperity-pass/linked-wallets/${request.id}/verify-signature`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature }),
        }
      );
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.request) throw new Error(json.error ?? "Verification failed");

      setRequest(json.request);
      toast.success("Wallet linked successfully!");
    } catch (err: any) {
      toast.error(err?.shortMessage ?? err?.message ?? "Signing failed");
    } finally {
      setSigning(false);
    }
  };

  const isDone =
    request?.status === "linked" ||
    request?.status === "signature_verified" ||
    request?.status === "safe_approved";

  const isInactive =
    request?.status === "expired" || request?.status === "failed";

  const connectedMatches =
    account && request ? account === request.linkedWallet : false;

  return (
    <main className="min-h-screen bg-onboarding px-4 py-8 pb-24 font-sterling">
      <Toaster richColors />

      <div className="mx-auto max-w-md space-y-4">
        <div>
          <h1 className="text-2xl font-medium text-gray-900">Link your wallet</h1>
          <p className="mt-1 text-sm leading-6 text-gray-500">
            Sign one message to prove you own this wallet. No gas, no transaction.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          {loading ? (
            <div className="h-8 w-8 rounded-full border-2 border-[#238D9D] border-t-transparent animate-spin" />
          ) : !request ? (
            <p className="text-sm text-gray-500">Link request not found.</p>
          ) : isDone ? (
            <DoneState linkedWallet={request.linkedWallet} />
          ) : isInactive ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {request.lastError ?? "This link request is no longer active. Start a new one from your profile."}
            </p>
          ) : (
            <div className="space-y-4">
              {/* Requested wallet */}
              <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#238D9D]/10 text-[#238D9D]">
                  <Wallet size={18} weight="duotone" />
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide">Wallet to link</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">
                    {truncateEthAddress(request.linkedWallet)}
                  </p>
                </div>
              </div>

              {/* Connect button */}
              {!account ? (
                <button
                  type="button"
                  onClick={connectWallet}
                  disabled={connecting}
                  className="w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {connecting ? "Connecting…" : "Connect wallet"}
                </button>
              ) : (
                <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                  <span className="text-xs text-gray-500">Connected</span>
                  <span className="text-xs font-bold text-gray-900">{truncateEthAddress(account)}</span>
                </div>
              )}

              {/* Wrong wallet warning */}
              {account && !connectedMatches && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                  Switch to {truncateEthAddress(request.linkedWallet)} in your wallet and reconnect.
                </p>
              )}

              {/* Sign button */}
              <button
                type="button"
                onClick={signAndVerify}
                disabled={signing || !connectedMatches}
                className="w-full rounded-xl bg-[#238D9D] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {signing ? "Signing…" : "Sign to verify ownership"}
              </button>

              <p className="text-center text-[11px] text-gray-400">
                This signs a message only — no funds move.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function DoneState({ linkedWallet }: { linkedWallet: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle size={20} weight="fill" className="text-[#238D9D]" />
        <p className="text-sm font-bold text-gray-900">Wallet linked</p>
      </div>
      <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
        <span className="text-xs text-gray-500">Linked wallet</span>
        <span className="text-xs font-bold text-gray-900">{truncateEthAddress(linkedWallet)}</span>
      </div>
      <p className="text-xs leading-5 text-gray-500">
        You can close this page. Your wallet is now linked to your AkibaMiles profile.
      </p>
    </div>
  );
}

function stringToHex(value: string): `0x${string}` {
  const encoded = new TextEncoder().encode(value);
  return `0x${Array.from(encoded).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
