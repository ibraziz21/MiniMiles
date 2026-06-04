import type { RuleTapRule } from "@/lib/games/types";

export function RuleBanner({ rule }: { rule: RuleTapRule }) {
  return (
    <div className="mx-4 rounded-2xl bg-gradient-to-r from-[#238D9D] to-[#2CBDD4] px-4 py-3 text-center shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Current Rule</p>
      <h2 className="mt-0.5 text-lg font-bold text-white">{rule.instruction}</h2>
    </div>
  );
}
