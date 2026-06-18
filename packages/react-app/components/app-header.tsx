// components/app-header.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import truncateEthAddress from "truncate-eth-address";
import { Fire } from "@phosphor-icons/react";
import { useWeb3 } from "@/contexts/useWeb3";
import { akibaMilesSymbolAlt, GearSvg } from "@/lib/svg";
import { ActiveStreaksSheet } from "@/components/active-streaks-sheet";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const BALANCE_REFRESH_EVENT = "akiba:miles:refresh";

/**
 * Shared top bar for the main tab pages (Home, Games, Earn).
 * Self-contained: owns balance, profile name, and the streaks sheet —
 * render `<AppHeader />` with no props for a consistent header everywhere.
 */
export default function AppHeader() {
  const web3 = useWeb3() as any;
  const { address, getUserAddress, getakibaMilesBalance } = web3;

  const [balance, setBalance] = useState("0");
  const [displayName, setDisplayName] = useState("");
  const [streakSheetOpen, setStreakSheetOpen] = useState(false);
  const [streakSummary, setStreakSummary] = useState({
    activeCount: 0,
    claimableCount: 0,
    urgentCount: 0,
  });

  useEffect(() => {
    getUserAddress?.();
  }, [getUserAddress]);

  /* ── balance + auto-refresh ───────────────────────────── */
  const refreshBalance = useCallback(async () => {
    if (!address) return;
    try {
      const b = await getakibaMilesBalance();
      setBalance(b);
    } catch {
      // swallow
    }
  }, [address, getakibaMilesBalance]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  useEffect(() => {
    const handler = () => {
      void refreshBalance();
      window.setTimeout(() => void refreshBalance(), 1500);
      window.setTimeout(() => void refreshBalance(), 4500);
    };
    window.addEventListener(BALANCE_REFRESH_EVENT, handler);
    return () => window.removeEventListener(BALANCE_REFRESH_EVENT, handler);
  }, [refreshBalance]);

  /* ── username for avatar / greeting ───────────────────── */
  useEffect(() => {
    if (!address) {
      setDisplayName("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("users")
          .select("username")
          .eq("user_address", address.toLowerCase())
          .maybeSingle();
        if (cancelled) return;
        setDisplayName(
          data?.username ? String(data.username) : truncateEthAddress(address)
        );
      } catch {
        if (!cancelled) setDisplayName(truncateEthAddress(address));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const initials =
    displayName && displayName.trim()
      ? displayName
          .trim()
          .split(" ")
          .map((w) => w[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()
      : "?";

  const { activeCount, claimableCount, urgentCount } = streakSummary;
  const hasActivity = claimableCount > 0 || activeCount > 0;
  const isUrgent = urgentCount > 0;
  const isClaimable = claimableCount > 0;
  const badgeCount = claimableCount > 0 ? claimableCount : activeCount;

  return (
    <>
      <ActiveStreaksSheet
        open={streakSheetOpen}
        onOpenChange={setStreakSheetOpen}
        onSummaryChange={setStreakSummary}
        userAddress={address ?? undefined}
      />

      <div className="px-4 pt-4 flex items-center justify-between gap-2">
        {/* Left: avatar + name */}
        <Link
          href="/profile"
          aria-label="View profile"
          className="flex items-center gap-2 min-w-0"
        >
          <div className="w-9 h-9 rounded-full bg-[#238D9D] flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">{initials}</span>
          </div>
          <span className="text-base font-medium truncate max-w-[34vw]">
            {displayName}
          </span>
        </Link>

        {/* Right: balance + streaks + settings */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href="/history"
            aria-label="Total AkibaMiles — view history"
            className="flex items-center gap-1.5 rounded-full bg-[#238D9D]/10 px-3 py-1.5 active:scale-[0.98]"
          >
            <Image src={akibaMilesSymbolAlt} width={18} height={18} alt="" />
            <span className="text-sm font-bold text-[#238D9D] tabular-nums">
              {Number(balance).toLocaleString()}
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setStreakSheetOpen(true)}
            aria-label="View active streaks"
            className="relative inline-flex items-center justify-center rounded-lg p-1.5 hover:bg-black/5 active:scale-[0.98]"
          >
            {(isUrgent || isClaimable) && (
              <span
                className={[
                  "absolute inset-0 rounded-lg animate-ping opacity-30",
                  isUrgent ? "bg-amber-400" : "bg-[#238D9D]",
                ].join(" ")}
                style={{ animationDuration: isUrgent ? "1s" : "2s" }}
              />
            )}
            <Fire
              size={24}
              weight="duotone"
              color={
                isUrgent
                  ? "#D97706"
                  : isClaimable
                  ? "#238D9D"
                  : activeCount > 0
                  ? "#238D9D"
                  : "#9CA3AF"
              }
            />
            {hasActivity && (
              <span
                className={[
                  "absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-white",
                  isUrgent ? "bg-amber-500" : "bg-[#238D9D]",
                ].join(" ")}
              >
                {badgeCount}
              </span>
            )}
          </button>

          <Link
            href="/settings"
            aria-label="Settings"
            className="inline-flex items-center justify-center p-1.5"
          >
            <Image src={GearSvg} alt="" />
          </Link>
        </div>
      </div>
    </>
  );
}
