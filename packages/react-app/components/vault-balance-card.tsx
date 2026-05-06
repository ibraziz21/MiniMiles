"use client";

import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight, TrendingUp } from "lucide-react";
import { akibaMilesSymbol, usdtSymbol } from "@/lib/svg";

interface VaultPosition {
  balance: string;
  milesPerDay: number;
  lifetimeMilesEarned?: number;
}

interface VaultBalanceCardProps {
  /** Re-fetch trigger — increment to force a refresh after a deposit/withdraw */
  refreshKey?: number;
  /** Hide action buttons (e.g. when already on the deposit page) */
  hideActions?: boolean;
}

export function VaultBalanceCard({ refreshKey = 0, hideActions = false }: VaultBalanceCardProps) {
  const [position, setPosition] = useState<VaultPosition | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPosition = useCallback(() => {
    setLoading(true);
    fetch("/api/vault/position")
      .then((r) => r.json())
      .then((data) => {
        if (data.balance !== undefined) {
          setPosition({
            balance: data.balance,
            milesPerDay: data.milesPerDay ?? 0,
            lifetimeMilesEarned: data.lifetimeMilesEarned ?? 0,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPosition();
  }, [fetchPosition, refreshKey]);

  const balance = position ? parseFloat(position.balance).toFixed(2) : "—";
  const milesPerDay = position?.milesPerDay ?? 0;
  const lifetimeMilesEarned = position?.lifetimeMilesEarned ?? 0;
  const hasDeposit = position ? parseFloat(position.balance) > 0 : false;

  return (
    <div className="rounded-2xl border border-[#238D9D]/20 bg-gradient-to-br from-[#238D9D] to-[#1b6b76] p-5 text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium opacity-80">Your Vault Balance</p>
        <div className="flex items-center gap-1 bg-white/15 rounded-full px-2.5 py-1">
          <TrendingUp className="h-3 w-3" />
          <span className="text-[11px] font-medium">Earning daily</span>
        </div>
      </div>

      {/* Balance */}
      <div className="flex items-end gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Image src={usdtSymbol} width={28} height={28} alt="USDT" className="opacity-90" />
          <span className="text-3xl font-bold leading-none">
            {loading ? <span className="opacity-50 text-xl">…</span> : balance}
          </span>
          <span className="text-sm opacity-70 mb-0.5">USDT</span>
        </div>
      </div>

      {lifetimeMilesEarned > 0 && (
        <p className="-mt-2 mb-4 text-xs font-medium text-white/75">
          {lifetimeMilesEarned.toLocaleString()} AkibaMiles earned lifetime
        </p>
      )}

      {/* Daily miles rate */}
      <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2 mb-4">
        <Image src={akibaMilesSymbol} width={16} height={16} alt="Miles" />
        <span className="text-sm">
          {loading ? (
            <span className="opacity-50">Calculating…</span>
          ) : hasDeposit ? (
            <span>
              <span className="font-semibold">{milesPerDay.toLocaleString()}</span>
              <span className="opacity-80"> AkibaMiles / day</span>
            </span>
          ) : (
            <span className="opacity-70">Deposit USDT to start earning</span>
          )}
        </span>
      </div>

      {/* Actions */}
      {!hideActions && (
        <div className="flex gap-2">
          <Link
            href="/vaults"
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-white text-[#238D9D] py-2.5 text-sm font-semibold hover:bg-white/90 transition-colors"
          >
            Deposit
            <ChevronRight className="h-4 w-4" />
          </Link>
          {hasDeposit && (
            <Link
              href="/vaults/withdraw"
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-white/15 text-white py-2.5 text-sm font-semibold hover:bg-white/25 transition-colors"
            >
              Withdraw
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
