// src/app/badges/[key]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Image from "next/image";

import {
  BADGE_BY_KEY,
  type BadgeKey,
  type BadgeDef,
  tiersCompletedFromValue,
  isBadgeCompletedFromValue,
} from "@/lib/prosperityBadges";

import closeIcon from "@/public/svg/close-pass.svg";
import lockIcon from "@/public/svg/lock-icon.svg";
import checkIcon from "@/public/svg/check-icon.svg";

import { useWeb3 } from "@/contexts/useWeb3";
import { fetchBadgeProgress } from "@/helpers/fetchBadgeProgress";

function parseNonNegativeNumber(raw: string | null | undefined): number {
  const n = Number(raw ?? "0");
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export default function BadgeDetailPage() {
  const router = useRouter();
  const params = useParams<{ key: BadgeKey }>();
  const searchParams = useSearchParams();

  const { address, getUserAddress } = useWeb3();

  // params.key is string | string[]
  const keyParam: BadgeKey | undefined = Array.isArray(params.key)
    ? (params.key[0] as BadgeKey)
    : (params.key as BadgeKey);

  const badge: BadgeDef | undefined = keyParam ? BADGE_BY_KEY[keyParam] : undefined;

  // Fallback if key is unknown
  if (!badge) {
    return (
      <main className="flex h-screen items-center justify-center bg-white font-sterling">
        <div className="text-center">
          <p className="mb-4 text-lg font-semibold">Badge not found</p>
          <button
            className="rounded-xl bg-[#238D9D] px-4 py-2 text-sm font-medium text-white"
            onClick={() => router.push("/")}
          >
            Go back home
          </button>
        </div>
      </main>
    );
  }

  // If query param exists, trust it (fast path).
  const hasQueryValue =
    searchParams.get("value") !== null || searchParams.get("progress") !== null;

  const initialValue = useMemo(() => {
    const v =
      parseNonNegativeNumber(searchParams.get("value")) ||
      parseNonNegativeNumber(searchParams.get("progress")) ||
      0;
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const [value, setValue] = useState<number>(initialValue);
  const [loading, setLoading] = useState<boolean>(!hasQueryValue);

  // Ensure we try to populate address (MiniPay) if not already set
  useEffect(() => {
    if (!address) {
      void getUserAddress();
    }
  }, [address, getUserAddress]);

  // If no ?value provided, fetch live metrics from our API and fill this badge's value.
  useEffect(() => {
    if (hasQueryValue) {
      setLoading(false);
      return;
    }
    if (!address) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const metrics = await fetchBadgeProgress(address as `0x${string}`);
        const next = metrics[badge.key] ?? 0;
        if (!cancelled) setValue(next);
      } catch {
        // swallow
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, badge.key, hasQueryValue]);

  const completedSteps = tiersCompletedFromValue(value, badge);
  const isCompleted = isBadgeCompletedFromValue(value, badge);

  const handleClose = () => {
    // router.back() can be a no-op when there is no history (deep link / fresh load)
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  return (
    <main className="h-screen bg-white font-sterling">
      <div className="mx-auto flex h-full w-full max-w-[420px] flex-col px-6 pt-6 pb-8 overflow-y-auto">
        {/* Top area: icon, heading, close */}
        <div className="flex w-full items-start gap-4">
          {/* Icon box 58x58 */}
          <div className="flex h-[58px] w-[58px] items-center justify-center rounded-[8px] border border-[#E5E7EB]">
            <Image
              src={isCompleted || value > 0 ? badge.activeIcon : badge.inactiveIcon}
              alt={badge.title}
              width={38}
              height={38}
              className="h-[38px] w-[38px]"
            />
          </div>

          {/* Title */}
          <div className="flex-1">
            <h1 className="text-[22px] leading-[28px] tracking-[-0.26px] font-semibold text-black">
              {badge.title}
            </h1>
          </div>

          {/* Close */}
          <button
            type="button"
            onClick={handleClose}
            className="flex h-[58px] w-[24px] items-start justify-end p-[3px]"
          >
            <Image src={closeIcon} alt="Close" width={18} height={18} className="mt-1" />
          </button>
        </div>

        {/* Divider */}
        <div className="mt-4 h-px w-full bg-[#E5E7EB]" />

        {/* Completed pill */}
        {isCompleted && (
          <div className="mt-4 flex w-full items-center justify-center rounded-full bg-[#D1FAE5] px-4 py-2">
            <Image src={checkIcon} alt="" width={16} height={16} className="mr-2 h-4 w-4" />
            <span className="text-sm font-medium text-[#065F46]">Completed</span>
          </div>
        )}

        {/* Description */}
        <p className="mt-4 text-[16px] leading-[22px] tracking-[-0.26px] text-[#4B5563]">
          {badge.detailDescription}
        </p>

        {/* Progress header – show EXACT metric */}
        <div className="mt-4 flex h-[44px] w-full items-center justify-between rounded-[16px] border border-[#D9D9D966] px-3">
          <span className="text-[14px] font-normal text-[#4B5563]">
            Your Progress:
          </span>

          <span className="text-[14px] font-semibold text-[#111827]">
            {loading ? "Loading…" : value.toLocaleString("en-US")}{" "}
            <span className="font-normal text-[#6B7280]">{badge.unitLabel}</span>
          </span>
        </div>

        {/* Tier completion summary */}
        <div className="mt-2 text-[13px] text-[#6B7280]">
          {completedSteps}/{badge.tiers.length} tiers completed
        </div>

        {/* Tier list */}
        <div className="mt-4 flex w-full flex-col gap-2 pb-2">
          {badge.tiers.map((tier) => {
            const tierDone = value >= tier.threshold;

            return (
              <div
                key={tier.id}
                className={`
                  flex min-h-[88px] w-full items-stretch
                  rounded-[16px] border overflow-hidden
                  bg-white
                  ${tierDone ? "border-[#A7F3D0]" : "border-[#E5E7EB]"}
                `}
              >
                {/* LEFT: icon column */}
                <div
                  className={`
                    flex h-full w-[48px] flex-shrink-0 items-center justify-center
                    px-3
                    ${tierDone ? "bg-[#CFF2E5]" : "bg-[#8080801A]"}
                  `}
                >
                  <Image
                    src={tierDone ? checkIcon : lockIcon}
                    alt={tierDone ? "Completed" : "Locked"}
                    width={18}
                    height={18}
                    className="h-[18px] w-[18px]"
                  />
                </div>

                {/* RIGHT: text side */}
                <div className="flex flex-1 flex-col justify-center bg-white px-3 py-3">
                  <p className="text-[12px] leading-[16px] font-medium text-[#9CA3AF]">
                    {tier.label} • {tier.usersCompletedLabel}
                  </p>
                  <p className="mt-1 text-[16px] leading-[22px] font-medium text-[#111827]">
                    {tier.requirement}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
