"use client";

export function MemoryStats({
  score,
  moves,
  matches,
  remainingMs,
}: {
  score: number;
  moves: number;
  matches: number;
  remainingMs: number;
}) {
  const totalMs = 60_000;
  const pct = Math.max(0, remainingMs / totalMs);
  const seconds = Math.ceil(remainingMs / 1000);
  const isLow = seconds <= 10;
  const timerColor = isLow ? "bg-red-400" : seconds <= 20 ? "bg-yellow-400" : "bg-purple-400";

  // Efficiency: perfect is 1 move per pair, so ≤ matches*2 moves is good
  const isEfficient = moves > 0 && moves <= matches * 2 + 2;

  return (
    <div className="mx-4 space-y-2">
      {/* Timer bar */}
      <div className="h-2 w-full rounded-full bg-[#EDE8F8] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-150 ${timerColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 rounded-2xl bg-[#3B1F6E] p-3">
        <StatBox label="Score" value={score} highlight />
        <StatBox label="Moves" value={moves} />
        <StatBox label="Pairs" value={`${matches}/8`} accent />
        <StatBox label="Time" value={`${seconds}s`} urgent={isLow} />
      </div>

      {/* Efficiency hint */}
      {isEfficient && matches > 0 && (
        <div className="flex items-center justify-center gap-1.5 rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-600 mx-auto w-fit">
          <span>⚡</span> Sharp memory
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  highlight,
  accent,
  urgent,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
  accent?: boolean;
  urgent?: boolean;
}) {
  const valueColor = urgent
    ? "text-red-300"
    : highlight
      ? "text-yellow-300"
      : accent
        ? "text-purple-200"
        : "text-white";

  return (
    <div className="rounded-xl bg-white/10 px-1.5 py-2.5 text-center">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">{label}</p>
      <p className={`mt-0.5 text-base font-bold ${valueColor}`}>{value}</p>
    </div>
  );
}
