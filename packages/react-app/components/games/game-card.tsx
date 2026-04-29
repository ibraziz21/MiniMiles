import type React from "react";
import { Lightning, Brain, Trophy } from "@phosphor-icons/react";
import type { GameConfig } from "@/lib/games/types";

const GAME_THEMES: Record<string, {
  gradient: string;
  iconBg: string;
  icon: React.ReactNode;
}> = {
  rule_tap: {
    gradient: "from-[#0D7A8A] via-[#238D9D] to-[#1A9AAD]",
    iconBg: "bg-yellow-400/20",
    icon: <Lightning size={24} weight="fill" className="text-yellow-300" />,
  },
  memory_flip: {
    gradient: "from-[#3B1F6E] via-[#5B35A0] to-[#7B4CC0]",
    iconBg: "bg-purple-300/20",
    icon: <Brain size={24} weight="fill" className="text-purple-200" />,
  },
};

const DEFAULT_THEME = GAME_THEMES.rule_tap;

interface SkillGameCardProps {
  config:          GameConfig;
  plays:           number;
  isDailyCapped:   boolean;
  walletConnected: boolean;
  personalBest?:   number | null;
  onPlay:          () => void;
  onBuyPlays:      () => void;
}

export function SkillGameCard({
  config,
  plays,
  isDailyCapped,
  walletConnected,
  personalBest,
  onPlay,
  onBuyPlays,
}: SkillGameCardProps) {
  const theme = GAME_THEMES[config.type] ?? DEFAULT_THEME;

  let buttonLabel: string;
  let buttonAction: (() => void) | null;
  let buttonStyle: string;

  if (!walletConnected) {
    buttonLabel  = "Connect wallet";
    buttonAction = null;
    buttonStyle  = "bg-white/20 text-white/60 cursor-not-allowed";
  } else if (isDailyCapped) {
    buttonLabel  = "Come back tomorrow";
    buttonAction = null;
    buttonStyle  = "bg-white/20 text-white/60 cursor-not-allowed";
  } else if (plays <= 0) {
    buttonLabel  = "Buy plays";
    buttonAction = onBuyPlays;
    buttonStyle  = "bg-white text-[#0D7A8A] font-bold";
  } else {
    buttonLabel  = "Play";
    buttonAction = onPlay;
    buttonStyle  = "bg-white text-[#238D9D] font-bold";
  }

  return (
    <div className="rounded-2xl overflow-hidden shadow-md">
      <div className={`relative bg-gradient-to-r ${theme.gradient} px-5 pt-5 pb-5`}>
        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute right-12 bottom-0 h-12 w-12 rounded-full bg-white/10" />

        <div className="relative z-10">
          {/* Title row */}
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white/90 mb-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#4EFFA0] animate-pulse" />
                Skill Game · {config.durationSeconds}s
              </div>
              <h2 className="text-2xl font-bold text-white">{config.name}</h2>
            </div>
            <div className={`rounded-2xl ${theme.iconBg} p-3 flex-shrink-0`}>
              {theme.icon}
            </div>
          </div>

          {/* Info rows */}
          <div className="space-y-1 mb-4">
            <p className="text-sm text-white/80">1 play entry · Win up to {config.maxRewardMiles} AkibaMiles</p>
            {config.weeklyPrizeUsd > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-white/70">
                <Trophy size={13} weight="fill" className="text-yellow-300 flex-shrink-0" />
                <span>Weekly top 3 share ${config.weeklyPrizeUsd}</span>
              </div>
            )}
            {personalBest != null && personalBest > 0 && (
              <p className="text-sm text-white/60">Your best: {personalBest} pts</p>
            )}
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={buttonAction ?? undefined}
            disabled={!buttonAction}
            className={`w-full rounded-xl py-3 text-sm transition-all active:scale-[0.98] ${buttonStyle}`}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
