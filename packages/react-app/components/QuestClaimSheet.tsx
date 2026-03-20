"use client";

import type { FC } from "react";
import Image from "next/image";
import { CheckCircle2, Info, AlertTriangle } from "lucide-react";
import { ResponsiveOverlay } from "@/components/ui/responsive-overlay";

type BaseProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export type QuestClaimSheetQuest = {
  id: string;
  title: string;
  description: string;
  reward_points: number;
};

type ClaimSheetProps = BaseProps & {
  quest: QuestClaimSheetQuest | null;
  iconSrc: any; // svg or image import
  onClaim: () => void;
  claiming?: boolean;
  hint?: string;
};

export const QuestClaimSheet: FC<ClaimSheetProps> = ({
  open,
  onOpenChange,
  quest,
  iconSrc,
  onClaim,
  claiming = false,
  hint,
}) => {
  if (!quest) return null;

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={onOpenChange}
      mobileSheetClassName="
        bg-white font-sterling max-h-[90vh] overflow-auto p-0
      "
      desktopDialogClassName="
        bg-white font-sterling
      "
    >
      <div className="px-6 pt-6 pb-8">
        {/* drag handle (mobile only) */}
        <div className="mb-6 flex justify-center md:hidden">
          <div className="h-1 w-16 rounded-full bg-[#E5E7EB]" />
        </div>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-[#238D9D1A] flex items-center justify-center">
            <Image src={iconSrc} alt="" className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h2 className="text-[20px] leading-[26px] tracking-[-0.26px] font-semibold text-black">
              {quest.title}
            </h2>
            <p className="mt-1 text-[14px] leading-[20px] tracking-[-0.26px] text-[#6B7280]">
              {hint ?? "Complete this challenge to claim your Miles."}
            </p>
          </div>
        </div>

        <p className="mt-4 text-[15px] leading-[21px] tracking-[-0.26px] text-[#4B5563]">
          {quest.description}
        </p>

        <div className="mt-5 rounded-[20px] border border-[#E5E7EB] bg-white px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="text-[14px] text-[#6B7280]">Reward</span>
            <span className="text-[16px] font-semibold text-black">
              {quest.reward_points} AkibaMiles
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={claiming}
          onClick={onClaim}
          className="
            mt-6
            flex h-14 w-full items-center justify-center
            rounded-[16px]
            bg-[#238D9D]
            text-base font-medium text-white
            disabled:opacity-60 disabled:cursor-not-allowed
          "
        >
          {claiming ? "Claiming…" : "Claim Miles"}
        </button>
      </div>
    </ResponsiveOverlay>
  );
};

/* ──────────────────────────────────────────────────────────────── */
/*  Loading sheet                                                  */
/* ──────────────────────────────────────────────────────────────── */

type LoadingProps = BaseProps & {
  message?: string;
  title?: string;
};

export const QuestClaimLoadingSheet: FC<LoadingProps> = ({
  open,
  onOpenChange,
  title = "Claiming reward",
  message = "This usually takes a few seconds.",
}) => {
  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={onOpenChange}
      mobileSheetClassName="bg-white font-sterling max-h-[90vh] overflow-auto p-0"
      desktopDialogClassName="bg-white font-sterling"
    >
      <div className="px-6 pt-6 pb-8">
        {/* drag handle (mobile only) */}
        <div className="mb-6 flex justify-center md:hidden">
          <div className="h-1 w-16 rounded-full bg-[#E5E7EB]" />
        </div>

        <h2 className="text-[22px] leading-[28px] tracking-[-0.26px] font-semibold text-black">
          {title}
        </h2>
        <p className="mt-2 text-[16px] leading-[22px] tracking-[-0.26px] text-[#4B5563]">
          {message}
        </p>

        <div className="mt-6 flex justify-center">
          <div
            className="
              h-12 w-12
              rounded-full
              border-4
              border-[#238D9D]
              border-t-transparent
              animate-spin
            "
          />
        </div>
      </div>
    </ResponsiveOverlay>
  );
};

/* ──────────────────────────────────────────────────────────────── */
/*  Result sheet (success / already / error)                        */
/* ──────────────────────────────────────────────────────────────── */

type ResultVariant = "success" | "already" | "error";

type ResultProps = BaseProps & {
  variant: ResultVariant;
  title: string;
  message: string;
  lines?: string[];
  onContinue?: () => void;
};

export const QuestClaimResultSheet: FC<ResultProps> = ({
  open,
  onOpenChange,
  variant,
  title,
  message,
  lines = [],
  onContinue,
}) => {
  const handleContinue = () => {
    onContinue?.();
    onOpenChange(false);
  };

  const Icon =
    variant === "success"
      ? CheckCircle2
      : variant === "already"
      ? Info
      : AlertTriangle;

  const iconClass =
    variant === "success"
      ? "text-[#238D9D]"
      : variant === "already"
      ? "text-[#238D9D]"
      : "text-[#F59E0B]";

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={onOpenChange}
      mobileSheetClassName="bg-white font-sterling max-h-[90vh] overflow-auto p-0"
      desktopDialogClassName="bg-white font-sterling"
    >
      <div className="px-6 pt-6 pb-8">
        {/* drag handle (mobile only) */}
        <div className="mb-6 flex justify-center md:hidden">
          <div className="h-1 w-16 rounded-full bg-[#E5E7EB]" />
        </div>

        {/* Desktop: center header a bit nicer */}
        <div className="flex items-start gap-3 md:flex-col md:items-center md:text-center">
          <Icon className={`h-12 w-12 ${iconClass}`} />

          <div className="flex-1 md:flex-none">
            <h2 className="text-[22px] leading-[28px] tracking-[-0.26px] font-semibold text-black">
              {title}
            </h2>

            <p className="mt-2 text-[16px] leading-[22px] tracking-[-0.26px] text-[#4B5563] whitespace-pre-line">
              {message}
            </p>
          </div>
        </div>

        {lines.length > 0 && (
          <div className="mt-4 rounded-[24px] border border-[#E5E7EB] bg-white overflow-hidden text-left">
            {lines.map((line, idx) => (
              <div
                key={`${line}-${idx}`}
                className="
                  flex items-center justify-between
                  px-4 py-3
                  border-b border-[#E5E7EB33]
                  last:border-b-0
                "
              >
                <span className="text-[16px] leading-[22px] text-[#4B5563]">
                  {line}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleContinue}
          className="
            mt-6
            flex h-14 w-full items-center justify-center
            rounded-[16px]
            bg-[#238D9D1A]
            text-base font-medium text-[#238D9D]
          "
        >
          Continue
        </button>
      </div>
    </ResponsiveOverlay>
  );
};
