import Image from "next/image";
import { akibaMilesSymbol, akibaMilesSymbolAlt } from "@/lib/svg";

/**
 * Renders an AkibaMiles amount in the canonical format: [icon] {value}
 * Use `alt` variant on dark/teal backgrounds (white circle icon).
 */
export function MilesAmount({
  value,
  size = 14,
  variant = "default",
  className = "",
}: {
  value: string | number;
  size?: number;
  variant?: "default" | "alt";
  className?: string;
}) {
  const src = variant === "alt" ? akibaMilesSymbolAlt : akibaMilesSymbol;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <Image src={src} width={size} height={size} alt="AkibaMiles" />
      <span>{value}</span>
    </span>
  );
}
