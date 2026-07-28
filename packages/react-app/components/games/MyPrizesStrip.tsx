"use client";

// Cross-game "My Prizes" inbox for the games hub (games-hub-redesign-spec.md
// §3). A feed with deep links, not a unified claim flow — leaderboard
// action_needed entries get an inline claim/burn (mirrors LeaderboardWinSheet
// exactly), claw entries just deep-link into /claw which owns its own claim UI.
// Hidden entirely when the feed is empty.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import posthog from "posthog-js";
import { CaretRight } from "@phosphor-icons/react";
import { BurnVoucherSheet, type BurnableVoucher } from "@/components/vouchers/BurnVoucherSheet";
import type { PrizeFeedEntry } from "@/app/api/games/prize-feed/route";

const STATUS_DOT: Record<PrizeFeedEntry["status"], string> = {
  action_needed: "bg-amber-500",
  active: "bg-[#238D9D]",
  done: "bg-gray-300",
  expired: "bg-gray-200",
};

function burnMilesFor(entry: PrizeFeedEntry): number {
  const meta = entry.winMeta;
  if (!meta) return 0;
  return Math.round(meta.marketplace_miles * (meta.burn_pct ?? 0.8));
}

function PrizeRow({
  entry,
  expanded,
  onToggle,
  onClaim,
  onBurn,
}: {
  entry: PrizeFeedEntry;
  expanded: boolean;
  onToggle: () => void;
  onClaim: () => void;
  onBurn: () => void;
}) {
  const isActionable = entry.kind === "leaderboard_voucher" && entry.status === "action_needed";

  const inner = (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[entry.status]}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#0D2B30]">{entry.title}</p>
        <p className="truncate text-xs text-[#667579] font-poppins">{entry.subtitle}</p>
      </div>
      <CaretRight size={14} weight="bold" className="shrink-0 text-[#667579]" />
    </div>
  );

  const track = () => posthog.capture("prize_entry_tap", { kind: entry.kind, status: entry.status });

  if (isActionable) {
    return (
      <div>
        <button
          type="button"
          onClick={() => { track(); onToggle(); }}
          className="block w-full text-left active:bg-[#F7FAFA]"
        >
          {inner}
        </button>
        {expanded && (
          <div className="flex gap-2 px-4 pb-3">
            <button
              type="button"
              onClick={onClaim}
              className="h-10 flex-1 rounded-xl bg-[#238D9D] text-sm font-bold text-white active:scale-[0.98] transition-transform"
            >
              Claim voucher
            </button>
            <button
              type="button"
              onClick={onBurn}
              className="h-10 flex-1 rounded-xl border border-[#238D9D44] text-sm font-semibold text-[#238D9D] active:scale-[0.98] transition-transform"
            >
              Burn for {burnMilesFor(entry)} Miles
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!entry.cta) {
    return <div className="opacity-60">{inner}</div>;
  }

  return (
    <Link href={entry.cta.href} onClick={track} className="block active:bg-[#F7FAFA]">
      {inner}
    </Link>
  );
}

export function MyPrizesStrip() {
  const router = useRouter();
  const [feed, setFeed] = useState<PrizeFeedEntry[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [burnTarget, setBurnTarget] = useState<BurnableVoucher | null>(null);
  const [burnOpen, setBurnOpen] = useState(false);

  const loadFeed = useCallback(() => {
    fetch("/api/games/prize-feed")
      .then((r) => (r.ok ? r.json() : { feed: [] }))
      .then((d) => setFeed(d.feed ?? []))
      .catch(() => setFeed([]));
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  const actionNeededCount = (feed ?? []).filter((e) => e.status === "action_needed").length;

  useEffect(() => {
    if (feed && feed.length > 0) {
      posthog.capture("prize_strip_impression", { action_needed_count: actionNeededCount });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);

  const markSeen = useCallback((voucherId: string) => {
    fetch("/api/games/my-prizes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voucherIds: [voucherId] }),
    }).catch(() => { /* non-fatal */ });
  }, []);

  const handleClaim = (entry: PrizeFeedEntry) => {
    if (entry.voucherId) markSeen(entry.voucherId);
    setExpandedId(null);
    router.push("/vouchers");
  };

  const handleBurn = (entry: PrizeFeedEntry) => {
    if (!entry.winMeta || !entry.voucherId) return;
    setBurnTarget({
      id: entry.voucherId,
      merchantName: entry.merchant?.name ?? "the merchant",
      merchantCountry: entry.merchant?.country ?? null,
      label: entry.winMeta.label,
      marketplaceMiles: entry.winMeta.marketplace_miles,
      burnMiles: burnMilesFor(entry),
    });
    setBurnOpen(true);
  };

  if (!feed || feed.length === 0) return null;

  const visible = showAll ? feed : feed.slice(0, 2);

  return (
    <>
      <div className="mt-3 px-4">
        <div className="overflow-hidden rounded-xl border border-[#E5ECEE] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#F5F5F5] px-4 py-3">
            <p className="text-sm font-bold text-[#0D2B30]">My prizes</p>
            {actionNeededCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                {actionNeededCount} to claim
              </span>
            )}
          </div>

          <div className="divide-y divide-[#F5F5F5]">
            {visible.map((entry) => (
              <PrizeRow
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                onToggle={() => setExpandedId((id) => (id === entry.id ? null : entry.id))}
                onClaim={() => handleClaim(entry)}
                onBurn={() => handleBurn(entry)}
              />
            ))}
          </div>

          {feed.length > 2 && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="w-full border-t border-[#F5F5F5] py-2.5 text-center text-xs font-semibold text-[#238D9D]"
            >
              {showAll ? "Show less" : `See all (${feed.length})`}
            </button>
          )}
        </div>
      </div>

      <BurnVoucherSheet
        open={burnOpen}
        onOpenChange={(v) => {
          setBurnOpen(v);
          if (!v) {
            setBurnTarget(null);
            loadFeed(); // refetch so a burned entry flips to "done" without reload
          }
        }}
        voucher={burnTarget}
        onBurned={() => { if (burnTarget) markSeen(burnTarget.id); }}
      />
    </>
  );
}
