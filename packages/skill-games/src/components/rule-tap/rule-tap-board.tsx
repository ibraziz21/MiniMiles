"use client";

import { Circle, Diamond, Star, Square } from "@phosphor-icons/react";
import type { RuleTapTile } from "../../core/types";

const colorClass = {
  blue:  "bg-[#DDF8FF] text-[#238D9D] border-[#238D9D33]",
  green: "bg-[#E7FBEF] text-[#138A45] border-[#138A4533]",
  red:   "bg-[#FFECEC] text-[#C43D3D] border-[#C43D3D33]",
  gold:  "bg-[#FFF6D8] text-[#B7791F] border-[#B7791F33]",
};

// The entire rule ("tap blue circles, avoid red squares") is defined in
// terms of color + shape — a bare "Tile 4" label made the game's actual
// mechanic undetectable to a screen reader despite the tiles being real,
// keyboard-focusable buttons.
const COLOR_LABELS: Record<RuleTapTile["color"], string> = {
  blue: "blue", green: "green", red: "red", gold: "gold",
};
const KIND_LABELS: Record<RuleTapTile["kind"], string> = {
  star: "star", circle: "circle", square: "square", diamond: "diamond",
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
        const label = tile
          ? `${COLOR_LABELS[tile.color]} ${KIND_LABELS[tile.kind]} tile`
          : "Empty tile";
        return (
          <button
            key={index}
            type="button"
            disabled={disabled}
            onClick={() => onTap(index)}
            className={[
              "aspect-square touch-manipulation select-none rounded-2xl border-2 shadow-sm transition-[transform,box-shadow] duration-100 motion-reduce:transition-none",
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
            aria-label={label}
          >
            <div className="flex h-full items-center justify-center" aria-hidden="true">
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
