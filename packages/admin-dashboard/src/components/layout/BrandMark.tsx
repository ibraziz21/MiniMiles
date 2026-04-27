import * as React from "react";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/svg/minimiles-symbol.svg"
      alt=""
      className={cn("block h-8 w-8", className)}
      draggable={false}
    />
  );
}
