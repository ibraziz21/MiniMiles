import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "warning" | "danger" | "success";
  /** Tint the whole card (border + background), not just the value text — for metrics that are themselves an alert (e.g. a non-zero review queue), not just a number with a color. */
  tintCard?: boolean;
  icon?: LucideIcon;
  href?: string;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  neutral: "text-ink",
  warning: "text-warning",
  danger: "text-danger",
  success: "text-success",
};

const TONE_CARD_CLASS: Partial<Record<NonNullable<MetricCardProps["tone"]>, string>> = {
  warning: "border-warning/30 bg-warning/5",
  danger: "border-danger/30 bg-danger/5",
};

const TONE_ICON_CLASS: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  neutral: "bg-surface-subtle text-primary",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  success: "bg-success/10 text-success",
};

export function MetricCard({ label, value, sub, tone = "neutral", tintCard = false, icon: Icon, href, className }: MetricCardProps) {
  const content = (
    <Card className={cn("h-full border-border bg-surface", tintCard && TONE_CARD_CLASS[tone], className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-ink-muted">{label}</CardTitle>
        {Icon && (
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-control", TONE_ICON_CLASS[tone])}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </CardHeader>
      <CardContent>
        <p className={cn("text-2xl font-bold tabular-nums", TONE_CLASS[tone])}>{value}</p>
        {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
      </CardContent>
    </Card>
  );

  if (!href) return content;

  return (
    <a href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-card">
      {content}
    </a>
  );
}
