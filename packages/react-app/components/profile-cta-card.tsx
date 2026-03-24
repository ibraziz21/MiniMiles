"use client";

import Image from "next/image";
import { akibaMilesSymbol } from "@/lib/svg";

type Props = {
  completion: number;
  profileName?: string | null;
  milestone50Claimed: boolean;
  milestone100Claimed: boolean;
  onOpenProfile: () => void;
};

function clampCompletion(value: number) {
  return Math.max(0, Math.min(100, value));
}

export default function ProfileCtaCard({
  completion,
  profileName,
  milestone50Claimed,
  milestone100Claimed,
  onOpenProfile,
}: Props) {
  const safeCompletion = clampCompletion(completion);

  let title = "Complete profile";
  let body = "Unlock profile rewards";
  let buttonLabel = "Open";
  let rewardAmount: 50 | 100 | null = null;

  if (safeCompletion < 50) {
    body = `${safeCompletion}% done • unlock at 50%`;
    buttonLabel = "Complete";
    rewardAmount = 50;
  } else if (!milestone50Claimed) {
    title = "Claim 50";
    body = `${safeCompletion}% complete • reward ready`;
    buttonLabel = "Claim";
    rewardAmount = 50;
  } else if (safeCompletion < 100) {
    title = "Finish profile";
    body = `${safeCompletion}% done • unlock at 100%`;
    buttonLabel = "Finish";
    rewardAmount = 100;
  } else if (!milestone100Claimed) {
    title = "Claim 100";
    body = "Profile complete • reward ready";
    buttonLabel = "Claim";
    rewardAmount = 100;
  } else {
    title = "Profile updated";
    body = "Manage your Akiba identity";
    buttonLabel = "View";
  }

  return (
    <button
      type="button"
      onClick={onOpenProfile}
      className="mx-4 mt-3 flex w-auto items-center justify-between gap-3 rounded-2xl border border-[#238D9D]/12 bg-[#F7FBFC] px-4 py-3 text-left transition-colors hover:bg-[#F0F8FA]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#238D9D]/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#238D9D]">
            Profile
          </span>
          <span className="text-xs font-medium text-[#238D9D]">
            {safeCompletion}%
          </span>
        </div>
        <p className="mt-1 text-sm font-semibold text-[#16343A]">
          {profileName ? `${profileName} · ${title}` : title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#68848A]">
          <span>{body}</span>
          {rewardAmount ? (
            <span className="inline-flex items-center gap-1 text-[#238D9D]">
              <Image
                src={akibaMilesSymbol}
                alt=""
                width={12}
                height={12}
                className="h-3 w-3"
              />
              <span className="font-semibold">{rewardAmount}</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="ml-4 flex flex-shrink-0 items-center gap-3">
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#D8EDF1]">
          <div
            className="h-full rounded-full bg-[#238D9D]"
            style={{ width: `${safeCompletion}%` }}
          />
        </div>
        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#238D9D] shadow-sm">
          {buttonLabel}
        </span>
      </div>
    </button>
  );
}
