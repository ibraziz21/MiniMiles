import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface DetailHeaderProps {
  backHref: string;
  backLabel: string;
  title: string;
  subtitle?: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
}

export function DetailHeader({ backHref, backLabel, title, subtitle, badges, actions }: DetailHeaderProps) {
  return (
    <div className="space-y-3">
      <Link
        href={backHref}
        className="inline-flex min-h-[32px] items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {backLabel}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-ink">{title}</h2>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {badges && <div className="flex flex-wrap items-center gap-2">{badges}</div>}
    </div>
  );
}
