"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import {
  ArrowSquareOut,
  CheckCircle,
  Copy,
  LinkSimple,
  ShareNetwork,
  Wallet,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import truncateEthAddress from "truncate-eth-address";
import {
  CELO_MAINNET_CHAIN_ID,
  CELO_MAINNET_CHAIN_ID_HEX,
  SAFE_EXEC_ABI,
  SUPERCHAIN_MODULE_LINK_ABI,
  celoTxUrl,
  makePrevalidatedSafeSignature,
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
  signatureVerifiedAt: string | null;
  safeApprovalTxHash: string | null;
  safeApprovedAt: string | null;
  finalTxHash: string | null;
  linkedAt: string | null;
  expiresAt: string;
  lastError: string | null;
  moduleAddress: `0x${string}`;
  chainId: number;
};

type ApiResponse = {
  request: LinkedWalletRequest | null;
  error?: string;
};

export default function ProsperityLinkedWalletCard({
  primaryAddress,
}: {
  primaryAddress: string;
}) {
  const [request, setRequest] = useState<LinkedWalletRequest | null>(null);
  const [externalWallet, setExternalWallet] = useState("");
  const [signature, setSignature] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [approving, setApproving] = useState(false);

  const completionUrl = useMemo(() => {
    if (!request || typeof window === "undefined") return "";
    return `${window.location.origin}/prosperity-pass/link/${request.id}`;
  }, [request]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prosperity-pass/linked-wallets", {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok) throw new Error(json.error ?? "Could not load status");
      setRequest(json.request);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not load external wallet status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const copy = async (value: string, label: string) => {
    const copied = await copyText(value);
    if (copied) {
      toast.success(`${label} copied`);
    } else {
      toast.error(`Copy failed. Long-press the ${label.toLowerCase()} field to copy it.`);
    }
  };

  const shareLink = async () => {
    if (!completionUrl) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "AkibaMiles Prosperity Pass wallet link",
          text: "Open this link in your external wallet browser to link it to your Prosperity Pass.",
          url: completionUrl,
        });
        return;
      } catch (err: any) {
        if (err?.name === "AbortError") return;
      }
    }

    await copy(completionUrl, "Link");
  };

  const createRequest = async () => {
    const linkedWallet = normalizeEvmAddress(externalWallet);
    if (!linkedWallet) {
      toast.error("Enter a valid EVM wallet address");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/prosperity-pass/linked-wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedWallet }),
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.request) {
        throw new Error(json.error ?? "Could not start link request");
      }
      setRequest(json.request);
      setSignature("");
      toast.success("External wallet request created");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not start link request");
    } finally {
      setCreating(false);
    }
  };

  const verifySignature = async () => {
    if (!request) return;
    if (!signature.trim()) {
      toast.error("Paste the external wallet signature first");
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch(
        `/api/prosperity-pass/linked-wallets/${request.id}/verify-signature`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: signature.trim() }),
        }
      );
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.request) {
        throw new Error(json.error ?? "Signature verification failed");
      }
      setRequest(json.request);
      toast.success("External wallet verified");
    } catch (err: any) {
      toast.error(err?.message ?? "Signature verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const approveFromPassSafe = async () => {
    if (!request) return;
    if (!(window as any).ethereum) {
      toast.error("Wallet provider not found");
      return;
    }

    setApproving(true);
    try {
      await ensureCelo();

      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const signerAddress = normalizeEvmAddress(await signer.getAddress());
      const primaryWallet = normalizeEvmAddress(primaryAddress);

      if (!signerAddress || !primaryWallet || signerAddress !== primaryWallet) {
        throw new Error("Approve with the MiniPay wallet that owns this Prosperity Pass");
      }

      const safe = new ethers.Contract(request.safeAddress, SAFE_EXEC_ABI, signer);
      const isOwner = await safe.isOwner(signerAddress);
      if (!isOwner) {
        throw new Error("Connected wallet is not an owner of this Prosperity Pass Safe");
      }

      const threshold = Number(await safe.getThreshold());
      if (threshold !== 1) {
        throw new Error("This v1 flow only supports Prosperity Pass Safes with threshold 1");
      }

      const moduleInterface = new ethers.Interface(SUPERCHAIN_MODULE_LINK_ABI as any);
      const data = moduleInterface.encodeFunctionData("populateAddOwner", [
        request.safeAddress,
        request.linkedWallet,
      ]);
      const signatures = makePrevalidatedSafeSignature(signerAddress);

      const tx = await safe.execTransaction(
        request.moduleAddress,
        0,
        data,
        0,
        0,
        0,
        0,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        signatures
      );

      toast.info("Approval submitted. Waiting for confirmation...");
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error("Safe approval transaction failed");
      }

      const res = await fetch(
        `/api/prosperity-pass/linked-wallets/${request.id}/safe-approval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash: tx.hash }),
        }
      );
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.request) {
        throw new Error(json.error ?? "Could not confirm Safe approval");
      }

      setRequest(json.request);
      toast.success("Pass approval complete. Open the link in the external wallet to finish.");
    } catch (err: any) {
      toast.error(err?.shortMessage ?? err?.message ?? "Safe approval failed");
    } finally {
      setApproving(false);
    }
  };

  const activeRequest =
    request && request.status !== "failed" && request.status !== "expired";

  return (
    <div className="mx-4 mt-4 bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">
            External wallet
          </p>
          <h2 className="text-sm font-bold text-gray-900">
            Link an EVM wallet to Prosperity Pass
          </h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            Track partner campaign activity from another wallet while keeping this
            Prosperity Pass as your main account.
          </p>
        </div>
        <div className="h-9 w-9 flex-shrink-0 rounded-full bg-[#238D9D]/10 text-[#238D9D] flex items-center justify-center">
          <Wallet size={18} weight="duotone" />
        </div>
      </div>

      {loading ? (
        <div className="mt-5 h-9 w-9 rounded-full border-2 border-[#238D9D] border-t-transparent animate-spin" />
      ) : request?.status === "linked" ? (
        <LinkedState request={request} />
      ) : (
        <div className="mt-4 space-y-4">
          {!activeRequest && (
            <div className="space-y-3">
              {request?.status === "failed" && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                  {request.lastError ?? "Previous link request failed."}
                </p>
              )}
              {request?.status === "expired" && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Previous link request expired. Start a new one when ready.
                </p>
              )}
              <input
                value={externalWallet}
                onChange={(e) => setExternalWallet(e.target.value)}
                placeholder="0x external EVM wallet"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#238D9D]"
              />
              <button
                type="button"
                onClick={createRequest}
                disabled={creating}
                className="w-full rounded-xl bg-[#238D9D] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {creating ? "Starting..." : "Start wallet link"}
              </button>
            </div>
          )}

          {activeRequest && request.status === "created" && (
            <StepBlock
              step="1"
              title="Verify the external wallet"
              body="Open this request in the external wallet browser, or paste a signature created by that wallet."
            >
              <CompletionLinkActions
                completionUrl={completionUrl}
                onCopy={() => copy(completionUrl, "Link")}
                onShare={shareLink}
              />
              <textarea
                readOnly
                value={request.signatureMessage ?? ""}
                className="h-36 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 outline-none"
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => copy(request.signatureMessage ?? "", "Message")}
                  className="flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700"
                >
                  <Copy size={14} /> Copy message
                </button>
                <WalletAppLink completionUrl={completionUrl} wallet="metamask" compact />
              </div>
              <textarea
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Paste signature from the external wallet"
                className="h-20 w-full resize-none rounded-xl border border-gray-200 p-3 text-xs text-gray-900 outline-none focus:border-[#238D9D]"
              />
              <button
                type="button"
                onClick={verifySignature}
                disabled={verifying}
                className="w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {verifying ? "Verifying..." : "Verify pasted signature"}
              </button>
            </StepBlock>
          )}

          {activeRequest && request.status === "signature_verified" && (
            <StepBlock
              step="2"
              title="Approve from Prosperity Pass"
              body="This stages the EOA for linking. It will not appear in Safe owners until the external wallet completes the final transaction."
            >
              <SummaryRow label="External wallet" value={request.linkedWallet} />
              <SummaryRow label="Pass Safe" value={request.safeAddress} />
              <button
                type="button"
                onClick={approveFromPassSafe}
                disabled={approving}
                className="w-full rounded-xl bg-[#238D9D] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {approving ? "Approving..." : "Approve wallet, then finish with EOA"}
              </button>
            </StepBlock>
          )}

          {activeRequest && request.status === "safe_approved" && (
            <StepBlock
              step="3"
              title="Final step: add EOA as Safe owner"
              body="Open the link page in the external wallet and submit the final transaction. This is the step that makes getOwners show the EOA."
            >
              <CompletionLinkActions
                completionUrl={completionUrl}
                onCopy={() => copy(completionUrl, "Link")}
                onShare={shareLink}
                primary
              />
              <button
                type="button"
                onClick={loadStatus}
                className="w-full rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-bold text-gray-700"
              >
                Refresh status
              </button>
              {request.safeApprovalTxHash && (
                <TxLink hash={request.safeApprovalTxHash} label="Safe approval tx" />
              )}
            </StepBlock>
          )}
        </div>
      )}
    </div>
  );
}

function StepBlock({
  step,
  title,
  body,
  children,
}: {
  step: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#238D9D] text-xs font-bold text-white">
          {step}
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">{title}</p>
          <p className="mt-0.5 text-xs leading-5 text-gray-500">{body}</p>
        </div>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function CompletionLinkActions({
  completionUrl,
  onCopy,
  onShare,
  primary = false,
}: {
  completionUrl: string;
  onCopy: () => void;
  onShare: () => void;
  primary?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">
        External wallet link
      </p>
      <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2">
        <LinkSimple size={15} className="flex-shrink-0 text-[#238D9D]" />
        <input
          readOnly
          value={completionUrl}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent text-xs font-medium text-gray-700 outline-none"
        />
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700"
        >
          <Copy size={14} /> Copy link
        </button>
        <button
          type="button"
          onClick={onShare}
          className="flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700"
        >
          <ShareNetwork size={14} /> Share link
        </button>
        <WalletAppLink completionUrl={completionUrl} wallet="metamask" primary={primary} />
        <WalletAppLink completionUrl={completionUrl} wallet="coinbase" primary={primary} />
        <a
          href={getChromeIntentLink(completionUrl)}
          className="flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700"
        >
          <ArrowSquareOut size={14} /> Open in Chrome
        </a>
        <a
          href={completionUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700"
        >
          <ArrowSquareOut size={14} /> Open here
        </a>
      </div>
    </div>
  );
}

function WalletAppLink({
  completionUrl,
  wallet,
  compact = false,
  primary = false,
}: {
  completionUrl: string;
  wallet: "metamask" | "coinbase";
  compact?: boolean;
  primary?: boolean;
}) {
  const deeplink =
    wallet === "metamask"
      ? getMetaMaskDappLink(completionUrl)
      : getCoinbaseDappLink(completionUrl);
  const label = wallet === "metamask" ? "MetaMask" : "Coinbase Wallet";

  return (
    <a
      href={deeplink}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${
        primary
          ? "bg-gray-900 text-white"
          : compact
            ? "bg-[#238D9D]/10 text-[#238D9D]"
            : "bg-gray-100 text-gray-700"
      }`}
    >
      <Wallet size={14} /> {compact ? "Open wallet page" : `Open in ${label}`}
    </a>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-bold text-gray-900">{truncateEthAddress(value)}</span>
    </div>
  );
}

function LinkedState({ request }: { request: LinkedWalletRequest }) {
  return (
    <div className="mt-4 rounded-2xl border border-[#238D9D]/20 bg-[#CFF2E5] p-3">
      <div className="flex items-center gap-2">
        <CheckCircle size={18} weight="fill" className="text-[#238D9D]" />
        <p className="text-sm font-bold text-gray-900">External wallet linked</p>
      </div>
      <div className="mt-3 space-y-2">
        <SummaryRow label="External wallet" value={request.linkedWallet} />
        <SummaryRow label="Pass Safe" value={request.safeAddress} />
        {request.finalTxHash && <TxLink hash={request.finalTxHash} label="Final add-owner tx" />}
      </div>
    </div>
  );
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  const url = celoTxUrl(hash);
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#238D9D]"
    >
      <span>{label}</span>
      <span>{truncateEthAddress(hash)}</span>
    </a>
  );
}

function getMetaMaskDappLink(url: string): string {
  const withoutProtocol = url.replace(/^https?:\/\//, "");
  return `https://metamask.app.link/dapp/${withoutProtocol}`;
}

function getCoinbaseDappLink(url: string): string {
  return `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`;
}

function getChromeIntentLink(url: string): string {
  const parsed = new URL(url);
  return `intent://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}#Intent;scheme=${parsed.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

async function copyText(value: string): Promise<boolean> {
  if (!value) return false;

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback for restricted wallet webviews.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
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
