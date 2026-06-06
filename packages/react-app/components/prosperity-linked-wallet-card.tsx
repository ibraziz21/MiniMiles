"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  CheckCircle,
  Copy,
  ShareNetwork,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
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
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const completionUrl = useMemo(() => {
    if (!request || typeof window === "undefined") return "";
    return `${window.location.origin}/prosperity-pass/link/${request.id}`;
  }, [request]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prosperity-pass/linked-wallets", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok) throw new Error(json.error ?? "Could not load status");
      setRequest(json.request);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not load external wallet status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const createRequest = async () => {
    const linked = normalizeEvmAddress(externalWallet);
    if (!linked) { toast.error("Enter a valid EVM wallet address"); return; }

    setCreating(true);
    try {
      const res = await fetch("/api/prosperity-pass/linked-wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedWallet: linked }),
      });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.request) throw new Error(json.error ?? "Could not start link request");
      setRequest(json.request);
      setExternalWallet("");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not start link request");
    } finally {
      setCreating(false);
    }
  };

  const cancelRequest = async () => {
    if (!request) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/prosperity-pass/linked-wallets/${request.id}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Could not cancel request");
      }
      setRequest(null);
      setExternalWallet("");
      toast.success("Link request cancelled");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not cancel request");
    } finally {
      setCancelling(false);
    }
  };

  const shareLink = async () => {
    if (!completionUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "AkibaMiles — link your EVM wallet",
          text: "Open this link in your external wallet browser to verify and link it.",
          url: completionUrl,
        });
        return;
      } catch (err: any) {
        if (err?.name === "AbortError") return;
      }
    }
    await copyText(completionUrl);
    toast.success("Link copied");
  };

  const copyLink = async () => {
    await copyText(completionUrl);
    toast.success("Link copied");
  };

  // A request is "active" if it still needs action
  const isPending =
    request &&
    request.status !== "linked" &&
    request.status !== "failed" &&
    request.status !== "expired";

  const isLinked = request?.status === "linked";

  // signature_verified counts as linked in the simplified flow
  const isVerified =
    request?.status === "signature_verified" || isLinked;

  return (
    <div className="mx-4 mt-4 bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">
            External wallet
          </p>
          <h2 className="text-sm font-bold text-gray-900">
            Link an EVM wallet
          </h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            Track partner campaign activity from another wallet.
            Optional — does not affect your profile score.
          </p>
        </div>
        <div className="h-9 w-9 flex-shrink-0 rounded-full bg-[#238D9D]/10 text-[#238D9D] flex items-center justify-center">
          <Wallet size={18} weight="duotone" />
        </div>
      </div>

      {loading ? (
        <div className="mt-5 h-8 w-8 rounded-full border-2 border-[#238D9D] border-t-transparent animate-spin" />
      ) : isLinked ? (
        <LinkedState request={request!} onUnlink={cancelRequest} unlinking={cancelling} />
      ) : isVerified ? (
        <VerifiedState request={request!} onCancel={cancelRequest} cancelling={cancelling} />
      ) : isPending ? (
        <PendingState
          request={request!}
          completionUrl={completionUrl}
          onCopyLink={copyLink}
          onShare={shareLink}
          onCancel={cancelRequest}
          cancelling={cancelling}
          onRefresh={loadStatus}
        />
      ) : (
        <EnterState
          value={externalWallet}
          onChange={setExternalWallet}
          onSubmit={createRequest}
          submitting={creating}
          lastRequest={request}
        />
      )}
    </div>
  );
}

/* ── States ─────────────────────────────────────────────────── */

function EnterState({
  value,
  onChange,
  onSubmit,
  submitting,
  lastRequest,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  lastRequest: LinkedWalletRequest | null;
}) {
  return (
    <div className="mt-4 space-y-3">
      {lastRequest?.status === "failed" && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
          {lastRequest.lastError ?? "Previous link request failed."}
        </p>
      )}
      {lastRequest?.status === "expired" && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Previous request expired — start a new one.
        </p>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0x external EVM wallet address"
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#238D9D]"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || !value.trim()}
        className="w-full rounded-xl bg-[#238D9D] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
      >
        {submitting ? "Starting…" : "Link wallet"}
      </button>
    </div>
  );
}

function PendingState({
  request,
  completionUrl,
  onCopyLink,
  onShare,
  onCancel,
  cancelling,
  onRefresh,
}: {
  request: LinkedWalletRequest;
  completionUrl: string;
  onCopyLink: () => void;
  onShare: () => void;
  onCancel: () => void;
  cancelling: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-4 space-y-3">
      {/* Wallet being linked */}
      <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
        <div>
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">Linking</p>
          <p className="text-sm font-bold text-gray-900 mt-0.5">
            {truncateEthAddress(request.linkedWallet)}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="flex items-center gap-1 rounded-lg bg-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50"
        >
          <X size={12} /> Cancel
        </button>
      </div>

      {/* Instruction */}
      <div className="rounded-xl border border-[#238D9D]/20 bg-[#238D9D]/5 px-3 py-3">
        <p className="text-xs font-semibold text-[#238D9D]">Open in your external wallet</p>
        <p className="mt-1 text-xs leading-5 text-gray-500">
          Share this link or open it directly in MetaMask, Coinbase Wallet, or any EVM wallet browser.
          You'll be asked to sign one message — no gas, no transaction.
        </p>
      </div>

      {/* Link display */}
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
        <input
          readOnly
          value={completionUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent text-xs font-medium text-gray-700 outline-none"
        />
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCopyLink}
          className="flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-3 py-2.5 text-xs font-bold text-gray-700"
        >
          <Copy size={14} /> Copy link
        </button>
        <button
          type="button"
          onClick={onShare}
          className="flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-3 py-2.5 text-xs font-bold text-white"
        >
          <ShareNetwork size={14} /> Share
        </button>
      </div>

      <WalletDeepLinks completionUrl={completionUrl} />

      <button
        type="button"
        onClick={onRefresh}
        className="flex items-center justify-center gap-2 w-full rounded-xl bg-gray-100 px-4 py-2.5 text-xs font-bold text-gray-600"
      >
        <ArrowCounterClockwise size={14} /> Refresh status
      </button>
    </div>
  );
}

function VerifiedState({
  request,
  onCancel,
  cancelling,
}: {
  request: LinkedWalletRequest;
  onCancel: () => void;
  cancelling: boolean;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-[#238D9D]/20 bg-[#CFF2E5] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <CheckCircle size={18} weight="fill" className="text-[#238D9D]" />
        <p className="text-sm font-bold text-gray-900">External wallet linked</p>
      </div>
      <SummaryRow label="Wallet" value={request.linkedWallet} />
      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        className="flex items-center justify-center gap-1.5 w-full rounded-xl bg-white/70 px-4 py-2 text-xs font-semibold text-gray-600 disabled:opacity-50"
      >
        <X size={12} /> {cancelling ? "Removing…" : "Remove linked wallet"}
      </button>
    </div>
  );
}

function LinkedState({
  request,
  onUnlink,
  unlinking,
}: {
  request: LinkedWalletRequest;
  onUnlink: () => void;
  unlinking: boolean;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-[#238D9D]/20 bg-[#CFF2E5] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <CheckCircle size={18} weight="fill" className="text-[#238D9D]" />
        <p className="text-sm font-bold text-gray-900">External wallet linked</p>
      </div>
      <SummaryRow label="Wallet" value={request.linkedWallet} />
      <button
        type="button"
        onClick={onUnlink}
        disabled={unlinking}
        className="flex items-center justify-center gap-1.5 w-full rounded-xl bg-white/70 px-4 py-2 text-xs font-semibold text-gray-600 disabled:opacity-50"
      >
        <X size={12} /> {unlinking ? "Removing…" : "Remove linked wallet"}
      </button>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────── */

function WalletDeepLinks({ completionUrl }: { completionUrl: string }) {
  const withoutProtocol = completionUrl.replace(/^https?:\/\//, "");
  const metamask = `https://metamask.app.link/dapp/${withoutProtocol}`;
  const coinbase = `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(completionUrl)}`;

  return (
    <div className="grid grid-cols-2 gap-2">
      <a
        href={metamask}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-xl bg-[#238D9D]/10 px-3 py-2.5 text-xs font-bold text-[#238D9D]"
      >
        Open in MetaMask
      </a>
      <a
        href={coinbase}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-xl bg-[#238D9D]/10 px-3 py-2.5 text-xs font-bold text-[#238D9D]"
      >
        Open in Coinbase
      </a>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-bold text-gray-900">{truncateEthAddress(value)}</span>
    </div>
  );
}

async function copyText(value: string): Promise<boolean> {
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const el = document.createElement("textarea");
    el.value = value;
    el.setAttribute("readonly", "true");
    el.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, el.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch { return false; }
}
