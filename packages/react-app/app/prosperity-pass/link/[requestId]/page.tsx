"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { CheckCircle, LinkSimple, Wallet } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import truncateEthAddress from "truncate-eth-address";
import {
  CELO_MAINNET_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID_HEX,
  SUPERCHAIN_MODULE_LINK_ABI,
  celoTxUrl,
  normalizeEvmAddress,
} from "@/lib/prosperity-pass-linking";

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
  safeApprovalTxHash: string | null;
  finalTxHash: string | null;
  lastError: string | null;
  moduleAddress: `0x${string}`;
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
  const [finalizing, setFinalizing] = useState(false);

  const loadRequest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prosperity-pass/linked-wallets/${requestId}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.request) {
        throw new Error(json.error ?? "Link request not found");
      }
      setRequest(json.request);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not load link request");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    void loadRequest();
  }, [loadRequest]);

  const connectExternalWallet = async () => {
    setConnecting(true);
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error("Open this page in your external wallet browser");
      const [addr] = await ethereum.request({ method: "eth_requestAccounts" });
      const normalized = normalizeEvmAddress(addr);
      if (!normalized) throw new Error("Invalid connected wallet");
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
      const signer = account ?? (await connectExternalWallet());
      if (!signer) return;
      if (signer !== request.linkedWallet) {
        throw new Error("Connect the external wallet requested for this link");
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
      if (!res.ok || !json.request) {
        throw new Error(json.error ?? "Could not verify signature");
      }

      setRequest(json.request);
      toast.success("External wallet verified");
    } catch (err: any) {
      toast.error(err?.shortMessage ?? err?.message ?? "Signature failed");
    } finally {
      setSigning(false);
    }
  };

  const completeOnChainLink = async () => {
    if (!request) return;

    setFinalizing(true);
    try {
      const signerAddress = account ?? (await connectExternalWallet());
      if (!signerAddress) return;
      if (signerAddress !== request.linkedWallet) {
        throw new Error("Connect the external wallet requested for this link");
      }

      await ensureCelo();

      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const module = new ethers.Contract(
        request.moduleAddress,
        SUPERCHAIN_MODULE_LINK_ABI,
        signer
      );

      const tx = await module.addOwnerWithThreshold(
        request.safeAddress,
        request.linkedWallet
      );
      toast.info("Final transaction submitted. Waiting for confirmation...");

      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error("Final transaction failed");
      }

      const res = await fetch(
        `/api/prosperity-pass/linked-wallets/${request.id}/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: tx.hash }),
        }
      );
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.request) {
        throw new Error(json.error ?? "Could not finalize linked wallet");
      }

      setRequest(json.request);
      toast.success("External wallet linked");
    } catch (err: any) {
      toast.error(err?.shortMessage ?? err?.message ?? "Final transaction failed");
    } finally {
      setFinalizing(false);
    }
  };

  const connectedMatches =
    account && request ? account === request.linkedWallet : false;

  return (
    <main className="min-h-screen bg-onboarding px-4 py-8 pb-24 font-sterling">
      <Toaster richColors />

      <div className="mx-auto max-w-md">
        <div className="mb-6">
          <h1 className="text-2xl font-medium text-gray-900">
            Link external wallet
          </h1>
          <p className="mt-1 text-sm leading-6 text-gray-500">
            Complete this request from the wallet you want to add to your
            Prosperity Pass.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          {loading ? (
            <div className="h-9 w-9 rounded-full border-2 border-[#238D9D] border-t-transparent animate-spin" />
          ) : !request ? (
            <p className="text-sm text-gray-500">Link request not found.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#238D9D]/10 text-[#238D9D]">
                  <Wallet size={20} weight="duotone" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-400 uppercase tracking-wide">
                    Requested wallet
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-gray-900">
                    {truncateEthAddress(request.linkedWallet)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Status: {statusLabel(request.status)}
                  </p>
                </div>
              </div>

              {request.status === "linked" ? (
                <div className="rounded-2xl border border-[#238D9D]/20 bg-[#CFF2E5] p-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={18} weight="fill" className="text-[#238D9D]" />
                    <p className="text-sm font-bold text-gray-900">
                      Wallet linked
                    </p>
                  </div>
                  {request.finalTxHash && (
                    <TxLink hash={request.finalTxHash} label="Final tx" />
                  )}
                </div>
              ) : request.status === "expired" || request.status === "failed" ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {request.lastError ?? "This link request is no longer active."}
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={connectExternalWallet}
                    disabled={connecting}
                    className="w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {connecting
                      ? "Connecting..."
                      : account
                        ? `Connected ${truncateEthAddress(account)}`
                        : "Connect external wallet"}
                  </button>

                  {account && !connectedMatches && (
                    <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                      This request is for {truncateEthAddress(request.linkedWallet)}.
                      Switch wallets before continuing.
                    </p>
                  )}

                  {request.status === "created" && (
                    <button
                      type="button"
                      onClick={signAndVerify}
                      disabled={signing || !connectedMatches}
                      className="w-full rounded-xl bg-[#238D9D] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {signing ? "Signing..." : "Sign and verify wallet"}
                    </button>
                  )}

                  {request.status === "signature_verified" && (
                    <div className="rounded-xl bg-gray-50 px-3 py-3">
                      <p className="text-sm font-bold text-gray-900">
                        Waiting for pass approval
                      </p>
                      <p className="mt-1 text-xs leading-5 text-gray-500">
                        Return to your AkibaMiles profile in MiniPay and approve
                        this wallet from the Prosperity Pass.
                      </p>
                      <button
                        type="button"
                        onClick={loadRequest}
                        className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-bold text-gray-700"
                      >
                        Refresh status
                      </button>
                    </div>
                  )}

                  {request.status === "safe_approved" && (
                    <div className="space-y-3">
                      <p className="rounded-xl bg-[#238D9D]/10 px-3 py-2 text-xs leading-5 text-[#238D9D]">
                        Final step: this transaction adds the EOA as a Safe owner.
                      </p>
                    <button
                      type="button"
                      onClick={completeOnChainLink}
                      disabled={finalizing || !connectedMatches}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#238D9D] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                    >
                      <LinkSimple size={16} />
                      {finalizing ? "Completing..." : "Complete on-chain link"}
                    </button>
                    </div>
                  )}
                </>
              )}

              {request.safeApprovalTxHash && (
                <TxLink hash={request.safeApprovalTxHash} label="Safe approval tx" />
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function statusLabel(status: LinkedWalletRequest["status"]) {
  if (status === "signature_verified") return "external wallet verified";
  if (status === "safe_approved") return "pass approved";
  return status.replaceAll("_", " ");
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  const url = celoTxUrl(hash);
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#238D9D]"
    >
      <span>{label}</span>
      <span>{truncateEthAddress(hash)}</span>
    </a>
  );
}

function stringToHex(value: string): `0x${string}` {
  const encoded = new TextEncoder().encode(value);
  return `0x${Array.from(encoded)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function ensureCelo() {
  const ethereum = (window as any).ethereum;
  if (!ethereum) throw new Error("Wallet provider not found");

  const chainId = await ethereum.request({ method: "eth_chainId" });
  if (Number(chainId) === CELO_MAINNET_CHAIN_ID || chainId === CELO_MAINNET_CHAIN_ID_HEX) {
    return;
  }

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CELO_MAINNET_CHAIN_ID_HEX }],
    });
  } catch (err: any) {
    if (err?.code !== 4902) throw err;

    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CELO_MAINNET_CHAIN_ID_HEX,
          chainName: "Celo",
          nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
          rpcUrls: ["https://forno.celo.org"],
          blockExplorerUrls: ["https://celoscan.io"],
        },
      ],
    });
  }
}
