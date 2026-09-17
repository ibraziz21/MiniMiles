"use client";

import type React from "react";
import { Drop, Key, Leaf, Lightning, Moon, Sparkle, Star, Sun } from "@phosphor-icons/react";

const icons: Record<string, React.ReactNode> = {
  sun:   <Sun       size={28} weight="duotone" />,
  bolt:  <Lightning size={28} weight="duotone" />,
  leaf:  <Leaf      size={28} weight="duotone" />,
  gem:   <Star      size={28} weight="duotone" />,
  wave:  <Drop      size={28} weight="duotone" />,
  key:   <Key       size={28} weight="duotone" />,
  moon:  <Moon      size={28} weight="duotone" />,
  spark: <Sparkle   size={28} weight="duotone" />,
};

// Screen-reader-facing names — independent of the `value` keys above (which
// don't all match their rendered icon, e.g. "gem" renders a Star) so the
// announced word always matches what's actually drawn on the card.
const SYMBOL_LABELS: Record<string, string> = {
  sun:   "sun",
  bolt:  "lightning bolt",
  leaf:  "leaf",
  gem:   "star",
  wave:  "water drop",
  key:   "key",
  moon:  "moon",
  spark: "sparkle",
};

export function MemoryCard({
  value,
  visible,
  matched,
  onClick,
  disabled,
}: {
  value: string;
  visible: boolean;
  matched: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const symbolLabel = SYMBOL_LABELS[value] ?? value;
  const label = matched
    ? `Matched card: ${symbolLabel}`
    : visible
      ? `Revealed card: ${symbolLabel}`
      : "Hidden card";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || matched}
      className={[
        "aspect-square rounded-2xl [perspective:700px] transition-transform duration-100 motion-reduce:transition-none",
        !matched && !disabled ? "active:scale-90" : "",
        matched ? "scale-95" : "",
      ].join(" ")}
      aria-label={label}
      aria-pressed={visible}
    >
      <div
        className={[
          "relative h-full w-full rounded-2xl transition-transform duration-300 motion-reduce:transition-none [transform-style:preserve-3d]",
          visible ? "[transform:rotateY(180deg)]" : "",
        ].join(" ")}
        aria-hidden="true"
      >
        {/* Back face — hidden state */}
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-[#5B35A040] bg-gradient-to-br from-[#3B1F6E] to-[#7B4CC0] text-white [backface-visibility:hidden]">
          <span className="text-base font-bold text-white/60">?</span>
        </div>

        {/* Front face — revealed / matched */}
        <div
          className={[
            "absolute inset-0 flex items-center justify-center rounded-2xl border-2 [backface-visibility:hidden] [transform:rotateY(180deg)]",
            matched
              ? "bg-[#F0FFF6] border-[#138A4566] text-[#138A45] ring-2 ring-[#31C76A60]"
              : "bg-[#F5F0FF] border-[#7B4CC033] text-[#5B35A0]",
          ].join(" ")}
        >
          {icons[value]}
        </div>
      </div>
    </button>
  );
}
