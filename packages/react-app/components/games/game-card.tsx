import type React from "react";
import Link from "next/link";
import { ArrowRight, Lightning, Brain, Trophy } from "@phosphor-icons/react";
import type { GameConfig } from "@/lib/games/types";
import { MilesAmount } from "./miles-amount";

// Visual identity per game type
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

export function SkillGameCard({ config }: { config: GameConfig }) {
  const theme = GAME_THEMES[config.type] ?? DEFAULT_THEME;

  return (
    <Link href={config.route} className="block rounded-2xl overflow-hidden shadow-md active:scale-[0.99] transition-transform">
      {/* Colorful top art band */}
      <div className={`relative bg-gradient-to-r ${theme.gradient} px-5 pt-5 pb-6`}>
        {/* Decorative circles */}
        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute right-12 bottom-0 h-12 w-12 rounded-full bg-white/10" />

        <div className="relative z-10 flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white/90">
              <span className="h-1.5 w-1.5 rounded-full bg-[#4EFFA0] animate-pulse" />
              Skill Game · {config.durationSeconds}s
            </div>
            <h2 className="mt-2 text-2xl font-bold text-white">{config.name}</h2>
            <p className="mt-1 font-poppins text-sm text-white/75">{config.description}</p>
          </div>
          <div className={`rounded-2xl ${theme.iconBg} p-3`}>
            {theme.icon}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="bg-white border border-[#F0F0F0] px-5 py-4 flex items-center justify-between">
        <div className="flex gap-4">
          <div className="flex items-center gap-1.5 text-sm text-[#525252]">
            Entry:&nbsp;<MilesAmount value={config.entryCostMiles} size={14} />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-[#525252]">
            <Trophy size={14} className="text-amber-500 flex-shrink-0" />
            Up to&nbsp;<MilesAmount value={config.maxRewardMiles} size={14} />
            {config.maxRewardStable ? ` + $${config.maxRewardStable}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1 text-sm font-semibold text-[#238D9D]">
          <span>Play</span>
          <ArrowRight size={16} />
        </div>
      </div>
    </Link>
  );
}
