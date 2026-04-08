"use client";

import { useState } from "react";
import { X, QrCode, ArrowLeft } from "@phosphor-icons/react";
import {
  AKIBA_TOKEN_SYMBOL,
  GameSession,
  RewardClass,
  SessionStatus,
  REWARD_META,
  TIER_META,
  ClawVoucher,
} from "@/lib/clawTypes";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatUnits } from "viem";

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<SessionStatus, string> = {
  [SessionStatus.None]:     "—",
  [SessionStatus.Pending]:  "Pending",
  [SessionStatus.Settled]:  "Settled",
  [SessionStatus.Claimed]:  "Claimed",
  [SessionStatus.Burned]:   "Burned",
  [SessionStatus.Refunded]: "Refunded",
};

const STATUS_COLOR: Record<SessionStatus, string> = {
  [SessionStatus.None]:     "#9CA3AF",
  [SessionStatus.Pending]:  "#06B6D4",
  [SessionStatus.Settled]:  "#F59E0B",
  [SessionStatus.Claimed]:  "#22C55E",
  [SessionStatus.Burned]:   "#9CA3AF",
  [SessionStatus.Refunded]: "#EF4444",
};

function timeAgo(ts: bigint): string {
  const diff = Math.floor(Date.now() / 1000) - Number(ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function rewardLabel(session: GameSession): string {
  const rc = session.rewardClass;
  if (rc === RewardClass.None || rc === RewardClass.Lose) return REWARD_META[rc].label;
  if (rc === RewardClass.Common)
    return `${parseFloat(formatUnits(session.rewardAmount, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${AKIBA_TOKEN_SYMBOL}`;
  if (rc === RewardClass.Epic)
    return `$${parseFloat(formatUnits(session.rewardAmount, 6)).toFixed(2)} USDT`;
  if (rc === RewardClass.Rare)     return "20% Voucher";
  if (rc === RewardClass.Legendary) return "100% Voucher";
  return "—";
}

// ── Voucher QR ─────────────────────────────────────────────────────────────

function VoucherQR({ voucher }: { voucher: ClawVoucher }) {
  const payload = JSON.stringify({
    type: "claw_voucher",
    voucherId: voucher.voucherId.toString(),
    owner: voucher.owner,
    discountBps: voucher.discountBps,
    expiresAt: Number(voucher.expiresAt),
  });

  // Simple QR placeholder — real implementation would use a QR library
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <div className="w-40 h-40 bg-gray-100 rounded-2xl flex items-center justify-center border border-gray-200">
        <span className="text-gray-300"><QrCode size={64} /></span>
      </div>
      <p className="text-[10px] text-gray-400 font-mono break-all px-4 text-center">
        {payload}
      </p>
      <p className="text-xs text-gray-400">
        Expires:{" "}
        {new Date(Number(voucher.expiresAt) * 1000).toLocaleDateString("en-KE", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </p>
    </div>
  );
}

// ── Session list item ───────────────────────────────────────────────────────

function SessionItem({
  session,
  urgent,
  onClick,
}: {
  session: GameSession;
  urgent: boolean;
  onClick: () => void;
}) {
  const tierMeta   = TIER_META[session.tierId] ?? TIER_META[0];
  const rewardMeta = REWARD_META[session.rewardClass];

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
    >
      {/* Tier dot */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-lg"
        style={{ background: `${tierMeta.accent}18` }}
      >
        {rewardMeta.emoji}
      </div>

      <div className="flex-1 min-w-0 text-left">
        <p className="text-sm font-semibold text-gray-800 truncate">
          {tierMeta.name} · #{session.sessionId.toString()}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">{timeAgo(session.createdAt)}</p>
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        <span
          className="text-[10px] font-semibold rounded-full px-2 py-0.5"
          style={{
            color: STATUS_COLOR[session.status],
            background: `${STATUS_COLOR[session.status]}18`,
          }}
        >
          {STATUS_LABEL[session.status]}
        </span>
        {session.rewardClass !== RewardClass.None && (
          <span className="text-[10px] text-gray-400">{rewardLabel(session)}</span>
        )}
      </div>

      {urgent && (
        <div className="w-2 h-2 bg-red-400 rounded-full shrink-0" />
      )}
    </button>
  );
}

// ── Session detail ──────────────────────────────────────────────────────────

function SessionDetail({
  session,
  voucher,
  onBack,
}: {
  session: GameSession;
  voucher: ClawVoucher | null;
  onBack: () => void;
}) {
  const tierMeta   = TIER_META[session.tierId] ?? TIER_META[0];
  const rewardMeta = REWARD_META[session.rewardClass];

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <button onClick={onBack} className="text-gray-400">
          <span><ArrowLeft size={18} /></span>
        </button>
        <span className="font-semibold text-sm text-gray-700">
          Session #{session.sessionId.toString()}
        </span>
      </div>

      <div className="overflow-y-auto flex-1 pb-8 space-y-4 pt-4">
        {/* Status card */}
        <div className="mx-4 rounded-2xl p-4 border border-gray-100 bg-white space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Status</span>
            <span
              className="font-semibold"
              style={{ color: STATUS_COLOR[session.status] }}
            >
              {STATUS_LABEL[session.status]}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Tier</span>
            <span className="font-semibold" style={{ color: tierMeta.accent }}>
              {tierMeta.name}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Reward</span>
            <span className="font-semibold text-gray-700 flex items-center gap-1">
              {rewardMeta.emoji} {rewardLabel(session)}
            </span>
          </div>
          {session.rewardClass === RewardClass.Rare && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Burn fallback</span>
              <span className="font-semibold text-gray-700">
                {parseFloat(formatUnits(session.rewardAmount, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} {AKIBA_TOKEN_SYMBOL}
              </span>
            </div>
          )}
          {session.rewardClass === RewardClass.Legendary && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Burn fallback</span>
              <span className="font-semibold text-gray-700">
                ${parseFloat(formatUnits(session.rewardAmount, 6)).toFixed(2)} USDT
              </span>
            </div>
          )}
        </div>

        {/* Guidance */}
        <div className="mx-4 text-sm text-gray-500 leading-relaxed">
          {rewardMeta.description}
        </div>

        {/* Voucher QR */}
        {voucher && voucher.voucherStatus === "active" && (
          <div className="mx-4 rounded-2xl border border-cyan-100 bg-cyan-50 overflow-hidden">
            <p className="text-xs font-semibold text-cyan-600 px-4 pt-3 pb-1">
              Voucher QR Code
            </p>
            <VoucherQR voucher={voucher} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main sheet ──────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessions: GameSession[];
  vouchers: ClawVoucher[];
};

export function ClawSessionsList({ open, onOpenChange, sessions, vouchers }: Props) {
  const [detail, setDetail] = useState<GameSession | null>(null);

  const urgentStatuses = new Set([SessionStatus.Pending, SessionStatus.Settled]);

  const voucherMap = new Map(
    vouchers.map((v) => [v.voucherId.toString(), v])
  );

  // Map sessionId → voucher
  const sessionVoucherMap = new Map(
    vouchers.map((v) => [
      sessions.find((s) => s.voucherId === v.voucherId)?.sessionId?.toString() ?? "",
      v,
    ])
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[80vh] p-0 flex flex-col bg-white">
        <SheetHeader className="px-4 pt-4 pb-2 flex flex-row items-center justify-between shrink-0">
          <SheetTitle className="text-base font-bold">
            {detail ? "Session detail" : "My Sessions"}
          </SheetTitle>
          <button
            onClick={() => { setDetail(null); onOpenChange(false); }}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
          >
            <X size={15} weight="bold" />
          </button>
        </SheetHeader>

        {detail ? (
          <SessionDetail
            session={detail}
            voucher={sessionVoucherMap.get(detail.sessionId.toString()) ?? null}
            onBack={() => setDetail(null)}
          />
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <p className="text-4xl mb-3">🎰</p>
            <p className="font-semibold text-sm text-gray-600">No sessions yet</p>
            <p className="text-xs text-gray-400 mt-1">Pull the claw to start playing!</p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 divide-y divide-gray-50 pb-8">
            {sessions.map((s) => (
              <SessionItem
                key={s.sessionId.toString()}
                session={s}
                urgent={urgentStatuses.has(s.status)}
                onClick={() => setDetail(s)}
              />
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
