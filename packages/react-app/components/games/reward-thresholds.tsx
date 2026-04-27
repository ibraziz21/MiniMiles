import type { RewardThreshold } from "@/lib/games/types";
import { MilesAmount } from "./miles-amount";

export function RewardThresholds({ thresholds }: { thresholds: RewardThreshold[] }) {
  return (
    <div className="space-y-2">
      {thresholds.map((threshold) => (
        <div
          key={`${threshold.label}-${threshold.minScore}`}
          className="flex items-center justify-between rounded-xl border border-[#238D9D1F] bg-white p-3 text-sm"
        >
          <div>
            <p className="font-medium">{threshold.label}</p>
            <p className="text-xs text-[#817E7E]">{threshold.minScore}+ score</p>
          </div>
          <p className="font-semibold text-[#238D9D] flex items-center gap-1">
            <MilesAmount value={threshold.miles} size={14} />
            {threshold.stable ? ` + $${threshold.stable.toFixed(2)}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}
