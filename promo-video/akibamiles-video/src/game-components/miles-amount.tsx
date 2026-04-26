import { Img, staticFile } from "remotion";
import { akibaMilesSymbol, akibaMilesSymbolAlt } from "../shims/svg-lib";

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
  const cleanSrc = typeof src === "string" ? src.replace(/^\//, "") : src;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <Img src={staticFile(cleanSrc)} style={{ width: size, height: size }} />
      <span>{value}</span>
    </span>
  );
}
