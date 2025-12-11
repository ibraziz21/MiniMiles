// src/app/badges/[key]/page.tsx
"use client";

import { useRouter, useParams, useSearchParams } from "next/navigation";
import Image from "next/image";
import { BADGE_BY_KEY, BadgeKey, type BadgeDef } from "@/lib/prosperityBadges";
import closeIcon from "@/public/svg/close-pass.svg";
import lockIcon from "@/public/svg/lock-icon.svg";
import checkIcon from "@/public/svg/check-icon.svg";

export default function BadgeDetailPage() {
  const router = useRouter();
  const params = useParams<{ key: BadgeKey }>();
  const searchParams = useSearchParams();

  const keyParam: BadgeKey | undefined = Array.isArray(params.key) ? params.key[0] : params.key;
  const badge: BadgeDef | undefined = keyParam
    ? BADGE_BY_KEY[keyParam]
    : undefined;

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

  // NEW: read "steps" (number of tiers completed), fallback to legacy "progress"
  const raw =
    searchParams.get("steps") ?? searchParams.get("progress") ?? "0";

  let steps = Number(raw);
  if (!Number.isFinite(steps) || steps < 0) steps = 0;

  const maxSteps = badge.tiers.length;
  if (steps > maxSteps) steps = maxSteps;

  // "Completed" = all tiers done
  const isCompleted = steps >= maxSteps;

  return (
    <main className="h-screen bg-white font-sterling">
      <div className="mx-auto flex h-full w-full max-w-[420px] flex-col px-6 pt-6 pb-8 overflow-y-auto">
        {/* Top area: icon, heading, close */}
        <div className="flex w-full items-start gap-4">
          {/* Icon box 58x58 */}
          <div className="flex h-[58px] w-[58px] items-center justify-center rounded-[8px] border border-[#E5E7EB]">
            <Image
              src={
                isCompleted || steps > 0
                  ? badge.activeIcon
                  : badge.inactiveIcon
              }
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

          {/* Close (uses router.back) */}
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-[58px] w-[24px] items-start justify-end p-[3px]"
          >
            <Image
              src={closeIcon}
              alt="Close"
              width={18}
              height={18}
              className="mt-1"
            />
          </button>
        </div>

        {/* Divider */}
        <div className="mt-4 h-px w-full bg-[#E5E7EB]" />

        {/* Completed pill (only if all tiers done) */}
        {isCompleted && (
          <div className="mt-4 flex w-full items-center justify-center rounded-full bg-[#D1FAE5] px-4 py-2">
            <Image
              src={checkIcon}
              alt=""
              width={16}
              height={16}
              className="mr-2 h-4 w-4"
            />
            <span className="text-sm font-medium text-[#065F46]">
              Completed
            </span>
          </div>
        )}

        {/* Description */}
        <p className="mt-4 text-[16px] leading-[22px] tracking-[-0.26px] text-[#4B5563]">
          {badge.detailDescription}
        </p>

        {/* Progress header – interpret as "tiers completed" */}
        <div className="mt-4 flex h-[44px] w-full items-center justify-between rounded-[16px] border border-[#D9D9D966] px-3">
          <span className="text-[14px] font-normal text-[#4B5563]">
            Your Progress:
          </span>
          <span className="text-[14px] font-semibold text-[#111827]">
            {steps}/{badge.tiers.length}{" "}
            <span className="font-normal text-[#6B7280]">
              tiers completed
            </span>
          </span>
        </div>

        {/* Tier list */}
        <div className="mt-4 flex w-full flex-col gap-2 pb-2">
          {badge.tiers.map((tier) => {
            // If you prefer: use index instead of thresholds to decide "done".
            // Because `steps` is count of tiers completed, not metric.
            const tierIndex = badge.tiers.findIndex((t) => t.id === tier.id);
            const tierDone = tierIndex > -1 && tierIndex < steps;

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

                {/* RIGHT: text side – always white */}
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
