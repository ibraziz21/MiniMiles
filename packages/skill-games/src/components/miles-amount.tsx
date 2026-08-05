import type { ReactNode } from "react";

/**
 * Renders an AkibaMiles amount in the canonical format: [icon] {value}
 * The host supplies its own icon element (an `<Image>` for React's SVG
 * asset, an inline `<svg>` component for Pass) — this package must not
 * reach into app-private `@/...` asset imports, and must not assume the
 * icon is image-file-backed.
 */
export function MilesAmount({
  value,
  icon,
  className = "",
}: {
  value: string | number;
  icon: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {icon}
      <span>{value}</span>
    </span>
  );
}
