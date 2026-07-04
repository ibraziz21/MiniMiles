import {
  CalendarCheck,
  Handshake,
  Gift,
  QrCode,
  Award,
  ArrowUpRight,
} from "lucide-react";
import { MilesIcon } from "@/components/MilesIcon";
import type { ActivityItem, ActivityKind } from "@/lib/akiba/activity";

const KIND_ICON: Record<ActivityKind, React.ReactNode> = {
  daily_quest: <CalendarCheck className="h-4 w-4 text-akiba-teal" />,
  partner_quest: <Handshake className="h-4 w-4 text-akiba-teal" />,
  bonus: <Award className="h-4 w-4 text-amber-500" />,
  voucher_grant: <Gift className="h-4 w-4 text-purple-500" />,
  voucher_redeem: <QrCode className="h-4 w-4 text-emerald-600" />,
};

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

export function ActivityFeed({
  items,
  emptyHint = "Complete quests or shop at a merchant to start earning.",
}: {
  items: ActivityItem[];
  emptyHint?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-akiba-line bg-akiba-card px-6 py-8 text-center">
        <MilesIcon className="mx-auto mb-3 h-8 w-8 opacity-20" />
        <p className="text-sm font-medium text-akiba-ink">No activity yet</p>
        <p className="mt-1 text-xs text-akiba-muted">{emptyHint}</p>
        <a
          href="/"
          className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-akiba-teal"
        >
          Explore opportunities <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-akiba-line overflow-hidden rounded-2xl border border-akiba-line bg-white">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-akiba-tint">
            {KIND_ICON[item.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-akiba-ink">{item.title}</p>
            <p className="truncate text-xs text-akiba-muted">
              {item.detail ? `${item.detail} · ` : ""}
              {relativeTime(item.ts)}
            </p>
          </div>
          {item.miles !== null && item.miles > 0 && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-akiba-tint px-2.5 py-1 text-xs font-semibold text-akiba-teal">
              +{item.miles.toLocaleString("en-KE")}
              <MilesIcon className="h-3 w-3" />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
