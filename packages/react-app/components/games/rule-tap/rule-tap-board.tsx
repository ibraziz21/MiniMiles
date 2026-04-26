"use client";

import { Circle, Diamond, Star, Square } from "@phosphor-icons/react";
import type { RuleTapTile } from "@/lib/games/types";

const colorClass = {
  blue:  "bg-[#DDF8FF] text-[#238D9D] border-[#238D9D33]",
  green: "bg-[#E7FBEF] text-[#138A45] border-[#138A4533]",
  red:   "bg-[#FFECEC] text-[#C43D3D] border-[#C43D3D33]",
  gold:  "bg-[#FFF6D8] text-[#B7791F] border-[#B7791F33]",
};

export function RuleTapBoard({
  activeTiles,
  feedback,
  onTap,
  disabled,
}: {
  activeTiles: RuleTapTile[];
  feedback: Record<number, "good" | "bad">;
  onTap: (index: number) => void;
  disabled?: boolean;
}) {
  const tilesByIndex = new Map(activeTiles.map((tile) => [tile.index, tile]));

  return (
    <div className="grid grid-cols-3 gap-3 px-4">
      {Array.from({ length: 9 }, (_, index) => {
        const tile = tilesByIndex.get(index);
        const flash = feedback[index];
        return (
          <button
            key={index}
            type="button"
            disabled={disabled}
            onClick={() => onTap(index)}
            className={[
              "aspect-square rounded-2xl border-2 shadow-sm transition-all duration-100 select-none",
              "active:scale-90",
              tile ? colorClass[tile.color] : "border-[#E0E0E0] bg-white",
              flash === "good"
                ? "scale-110 ring-4 ring-[#31C76A80] border-[#31C76A]"
                : "",
              flash === "bad"
                ? "scale-90 ring-4 ring-[#E5535380] border-[#E55353]"
                : "",
              disabled && !flash ? "opacity-50" : "",
            ].join(" ")}
            aria-label={`Tile ${index + 1}`}
          >
            <div className="flex h-full items-center justify-center">
              {tile ? <TileIcon kind={tile.kind} /> : <span className="h-2 w-2 rounded-full bg-[#E0E0E0]" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TileIcon({ kind }: { kind: RuleTapTile["kind"] }) {
  const props = { size: 34, weight: "duotone" as const };
  if (kind === "star")    return <Star    {...props} />;
  if (kind === "circle")  return <Circle  {...props} />;
  if (kind === "square")  return <Square  {...props} />;
  return                         <Diamond {...props} />;
}
