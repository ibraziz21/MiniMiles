import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * One row in a grouped settings list (My Akiba ID, Account). Groups share a
 * single bordered container with `divide-y` between rows — the same
 * container pattern ActivityFeed already uses — rather than each row being
 * its own card, so a 4-7 row group reads as one coherent list, not a stack
 * of separate cards.
 *
 * Renders as `<a>` when `href` is given, `<button>` otherwise. Either way it
 * keeps a `min-h-11` touch target and a real `focus-visible` ring — this is
 * the primitive the earlier design audit's "no shared form/button primitive"
 * gap called for.
 */
export function SettingsRow({
  icon,
  label,
  description,
  trailing,
  href,
  onClick,
  variant = "default",
  showChevron = true,
}: {
  icon: ReactNode;
  label: string;
  description?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: "default" | "danger";
  showChevron?: boolean;
}) {
  const content = (
    <>
      <span
        className={clsx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          variant === "danger" ? "bg-red-50" : "bg-akiba-tint",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span
          className={clsx(
            "block truncate text-sm font-medium",
            variant === "danger" ? "text-red-600" : "text-akiba-ink",
          )}
        >
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-xs text-akiba-muted">{description}</span>
        )}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
      {showChevron && (
        <ChevronRight className="h-4 w-4 shrink-0 text-akiba-muted/50" aria-hidden="true" />
      )}
    </>
  );

  const className =
    "flex min-h-11 w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-akiba-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-akiba-teal";

  if (href) {
    return (
      <a href={href} className={className}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}
