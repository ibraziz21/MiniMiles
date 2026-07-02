"use client";

import Image from "next/image";
import { akibaMilesSymbol, usdtSymbol } from "@/lib/svg";

type TokenAmountProps = {
  amount: number | string;
  isUsdt?: boolean;
  symbolSize?: number;   // px, default 16
  textClass?: string;    // tailwind classes for the number
  gap?: string;          // tailwind gap class, default "gap-1"
};

/**
 * Renders: [symbol] [amount]
 * Always symbol-first, no trailing "Miles" / "USDT" text.
 */
export function TokenAmount({
  amount,
  isUsdt = false,
  symbolSize = 16,
  textClass = "",
  gap = "gap-1",
}: TokenAmountProps) {
  return (
    <span className={`inline-flex items-center ${gap}`}>
      <Image
        src={isUsdt ? usdtSymbol : akibaMilesSymbol}
        alt={isUsdt ? "USDT" : "Miles"}
        width={symbolSize}
        height={symbolSize}
        className="shrink-0"
        style={{ width: symbolSize, height: symbolSize }}
      />
      <span className={textClass}>{amount}</span>
    </span>
  );
}
